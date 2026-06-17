import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Bunqueue, type Job } from "bunqueue/client";
import type { DatabaseHandle } from "../db/client";
import type { LiveEventStore } from "../live/events";
import { exportHaloTraceJsonl, previewHaloRunExport } from "./exporter";
import { getHaloEngineStatus, installOrUpdateHaloEngine } from "./engine";
import { ensureHaloReportFile, outputDirForRun } from "./report";
import {
  addHaloRunEvent,
  appendHaloRunTurns,
  buildRunnerMessages,
  createHaloRun,
  createHaloRunTurns,
  deleteHaloRun,
  getAssistantTurn,
  getHaloProvider,
  getHaloRun,
  getLatestAssistantTurn,
  isHaloRunCancelled,
  listHaloRuns,
  markInterruptedHaloRuns,
  publishHaloRun,
  publishHaloRunEvent,
  updateHaloRun,
  updateHaloRunTurn,
} from "./storage";
import type { HaloRun, StartHaloRunInput } from "./types";

type HaloJobData = {
  runId: string;
  /** Assistant turn this job produces; absent on legacy/first-turn jobs (= 1). */
  turnIndex?: number;
};

type HaloJobResult = {
  runId: string;
  cancelled?: boolean;
};

export type HaloRunService = ReturnType<typeof createHaloRunService>;

const HALO_QUEUE_NAME = "halo-runs";
const HALO_ROUTE = "halo.run";
// Engine turns routinely run for minutes. bunqueue's default lock is 30s —
// if it expires mid-job, the post-handler ack throws "Invalid or expired
// lock token" as an unhandled rejection (observed killing the process,
// June 2026). The lock duration isn't configurable via BunqueueOptions, so
// renew aggressively instead: a fast worker heartbeat plus an explicit
// 10-minute extension on a 20s cadence while a turn runs.
const HALO_LOCK_EXTENSION_MS = 10 * 60 * 1000;
const HALO_LOCK_RENEW_INTERVAL_MS = 20_000;
const DASHBOARD_RENDERING_INSTRUCTION = `Dashboard rendering instruction:
When referencing dashboard identifiers in your answer, use these exact tag formats so the UI can link them:

- Trace: [trace:<lowercase hex trace id>]
- Span: [span:<lowercase hex trace id>:<lowercase hex span id>]

Only use these tags for identifiers that exist in the provided trace dataset. Do not use them for unrelated IDs. Do not include both a span link and its root trace link, only one is needed.`;

type RunnerMessage = { content: string; role: "assistant" | "user" };

export function createHaloRunService(options: {
  database: DatabaseHandle;
  live: LiveEventStore;
}) {
  const { database, live } = options;
  markInterruptedHaloRuns(database.sqlite);

  let queue: Bunqueue<HaloJobData, HaloJobResult>;
  queue = new Bunqueue<HaloJobData, HaloJobResult>(HALO_QUEUE_NAME, {
    concurrency: 1,
    dataPath: queueDataPath(database.path),
    heartbeatInterval: 2_000,
    defaultJobOptions: {
      durable: true,
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 200 },
    },
    dlq: {
      autoRetry: false,
      maxEntries: 500,
    },
    embedded: true,
    retry: {
      delay: 1_000,
      maxAttempts: 1,
      strategy: "jitter",
    },
    routes: {
      [HALO_ROUTE]: async (job) =>
        processHaloRun({
          database,
          job,
          live,
          queue,
        }),
    },
  });

  queue.on("failed", (job, error) => {
    const run = getHaloRun(database.sqlite, job.data.runId);
    if (!run || run.status === "cancelled") return;
    const failed = updateHaloRun(database.sqlite, run.id, {
      errorMessage: error.message,
      finishedAt: Date.now(),
      progress: Math.max(run.progress, 95),
      status: "failed",
    });
    settleActiveAssistantTurn(database, run.id, "failed", error.message);
    publishHaloRun(live, failed);
  });

  return {
    async cancel(runId: string) {
      const run = getHaloRun(database.sqlite, runId);
      if (!run) return null;
      const updated = updateHaloRun(database.sqlite, runId, {
        errorMessage: "HALO run cancelled by user.",
        finishedAt: Date.now(),
        status: "cancelled",
      });
      settleActiveAssistantTurn(database, runId, "cancelled", "HALO run cancelled by user.");
      addAndPublishEvent(database, live, updated, "cancelled", {
        error: "HALO run cancelled by user.",
      });
      publishHaloRun(live, updated);
      if (run.bunqueueJobId) queue.cancel(run.bunqueueJobId);
      return updated;
    },

    close(force?: boolean) {
      return queue.close(force);
    },

    /** Ask a follow-up on a finished run: appends turns and re-enqueues. */
    async continueRun(runId: string, message: string) {
      const run = getHaloRun(database.sqlite, runId);
      if (!run) return null;
      if (!["completed", "incomplete", "failed", "cancelled", "interrupted"].includes(run.status)) {
        throw new Error("Wait for the current HALO turn to finish first.");
      }
      const trimmed = message.trim();
      if (!trimmed) throw new Error("Follow-up message is empty.");
      const { assistantTurn } = appendHaloRunTurns(database.sqlite, run, trimmed);
      const queued = await queue.add(
        HALO_ROUTE,
        { runId, turnIndex: assistantTurn.turnIndex },
        {
          durable: true,
          jobId: `${runId}:turn:${assistantTurn.turnIndex}`,
          priority: 5,
        },
      );
      const updated = updateHaloRun(database.sqlite, runId, {
        bunqueueJobId: queued.id,
        errorMessage: null,
        finishedAt: null,
        progress: 0,
        status: "queued",
      });
      addAndPublishEvent(
        database,
        live,
        updated,
        "queued",
        { targetType: updated.targetType, turnIndex: assistantTurn.turnIndex },
        assistantTurn.turnIndex,
      );
      publishHaloRun(live, updated);
      return updated;
    },

    async delete(runId: string) {
      const run = getHaloRun(database.sqlite, runId);
      if (!run) return false;
      if (run.bunqueueJobId) queue.cancel(run.bunqueueJobId);
      deleteHaloRun(database.sqlite, runId);
      try {
        rmSync(outputDirForRun(database.path, runId), { force: true, recursive: true });
      } catch {
        // Leftover files are harmless; the run rows are gone.
      }
      return true;
    },

    get(runId: string) {
      return getHaloRun(database.sqlite, runId);
    },

    list(limit?: number) {
      return listHaloRuns(database.sqlite, limit);
    },

    preview(input: Pick<StartHaloRunInput, "filters" | "targetType">) {
      return previewHaloRunExport(database.sqlite, input);
    },

    async retry(runId: string) {
      const run = getHaloRun(database.sqlite, runId);
      if (!run) return null;
      // Re-run the most recent assistant turn (1 for legacy single-turn runs).
      const latestTurn = getLatestAssistantTurn(database.sqlite, runId);
      if (latestTurn) {
        updateHaloRunTurn(database.sqlite, latestTurn.id, {
          errorMessage: null,
          finishedAt: null,
          status: "pending",
        });
      }
      const queued = await queue.add(
        HALO_ROUTE,
        { runId, turnIndex: latestTurn?.turnIndex ?? 1 },
        {
          durable: true,
          jobId: `${runId}:${Date.now()}`,
          priority: 5,
        },
      );
      const updated = updateHaloRun(database.sqlite, runId, {
        bunqueueJobId: queued.id,
        errorMessage: null,
        finishedAt: null,
        progress: 0,
        startedAt: null,
        status: "queued",
      });
      publishHaloRun(live, updated);
      return updated;
    },

    async start(input: StartHaloRunInput): Promise<HaloRun> {
      const provider = getHaloProvider(database.sqlite, input.providerId);
      if (!provider) throw new Error("HALO model provider not found.");
      const run = createHaloRun(database.sqlite, {
        ...input,
        model: input.model.trim(),
        providerName: provider.name,
        title:
          input.title?.trim() ||
          `${input.targetType === "session_group" ? "Session" : "Trace"} analysis`,
      });
      createHaloRunTurns(database.sqlite, run);
      const queued = await queue.add(
        HALO_ROUTE,
        { runId: run.id },
        {
          durable: true,
          jobId: run.id,
          priority: 5,
        },
      );
      const updated = updateHaloRun(database.sqlite, run.id, {
        bunqueueJobId: queued.id,
        status: "queued",
      });
      addAndPublishEvent(database, live, updated, "queued", {
        targetType: updated.targetType,
      });
      publishHaloRun(live, updated);
      return updated;
    },
  };
}

async function processHaloRun(input: {
  database: DatabaseHandle;
  job: Job<HaloJobData>;
  live: LiveEventStore;
  queue: Bunqueue<HaloJobData, HaloJobResult>;
}): Promise<HaloJobResult> {
  // Belt and suspenders alongside the worker heartbeat: keep extending the
  // job lock for as long as the turn runs so the completion ack can't hit an
  // expired token.
  const lockRenewal = setInterval(() => {
    void renewJobLock(input.job);
  }, HALO_LOCK_RENEW_INTERVAL_MS);
  void renewJobLock(input.job);
  try {
    return await processHaloRunLocked(input);
  } finally {
    clearInterval(lockRenewal);
  }
}

async function processHaloRunLocked(input: {
  database: DatabaseHandle;
  job: Job<HaloJobData>;
  live: LiveEventStore;
  queue: Bunqueue<HaloJobData, HaloJobResult>;
}): Promise<HaloJobResult> {
  const { database, job, live, queue } = input;
  const runId = job.data.runId;
  let run = getHaloRun(database.sqlite, runId);
  if (!run || !["queued", "running", "exporting"].includes(run.status)) {
    return { cancelled: true, runId };
  }
  const provider = run.providerId
    ? getHaloProvider(database.sqlite, run.providerId)
    : null;
  if (!provider) throw new Error("HALO model provider not found.");

  let engine = await getHaloEngineStatus(database);
  if (engine.status !== "installed" || !engine.checks.importable) {
    run = updateHaloRun(database.sqlite, runId, {
      progress: 10,
      status: "running",
    });
    publishHaloRun(live, run);
    addAndPublishEvent(database, live, run, "installing_engine", {
      installPath: engine.defaultInstallPath,
      previousStatus: engine.status,
    });

    try {
      engine = await installOrUpdateHaloEngine(database);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not install the HALO engine automatically.";
      throw new Error(
        `HALO engine is not ready and automatic install failed: ${message}`,
      );
    }

    if (engine.status !== "installed" || !engine.checks.importable) {
      throw new Error(
        "HALO engine is not ready after automatic install. Check Settings for dependency status.",
      );
    }
  }

  const signal = queue.getSignal(job.id) ?? undefined;
  const outputDir = outputDirForRun(database.path, run.id);
  mkdirSync(outputDir, { recursive: true });

  const turnIndex = job.data.turnIndex ?? 1;
  // Follow-up turns reuse the run's original trace export when it still
  // exists; otherwise fall through to a fresh export.
  const reuseExport =
    turnIndex > 1 && Boolean(run.exportPath) && existsSync(run.exportPath ?? "");
  let tracePath = run.exportPath ?? "";

  if (!reuseExport) {
    run = updateHaloRun(database.sqlite, runId, {
      progress: 5,
      status: "exporting",
    });
    publishHaloRun(live, run);
    addAndPublishEvent(
      database,
      live,
      run,
      "exporting",
      { targetType: run.targetType },
      turnIndex,
    );

    if (isCancelled(database, runId, signal)) {
      await markCancelled(database, live, runId);
      return { cancelled: true, runId };
    }

    const exported = exportHaloTraceJsonl(database.sqlite, {
      filters: run.filters,
      outputDir,
      runId,
      targetType: run.targetType,
    });
    run = updateHaloRun(database.sqlite, runId, {
      exportPath: exported.path,
      progress: 18,
      sessionCount: exported.sessionCount,
      spanCount: exported.spanCount,
      traceCount: exported.traceCount,
    });
    publishHaloRun(live, run);
    addAndPublishEvent(
      database,
      live,
      run,
      "exported",
      {
        path: exported.path,
        sessionCount: exported.sessionCount,
        spanCount: exported.spanCount,
        traceCount: exported.traceCount,
        warnings: exported.warnings,
      },
      turnIndex,
    );

    if (exported.spanCount === 0 || exported.traceCount === 0) {
      run = updateHaloRun(database.sqlite, runId, {
        errorMessage: "No traces matched the selected HALO filters.",
        finishedAt: Date.now(),
        progress: 100,
        status: "failed",
      });
      settleActiveAssistantTurn(database, runId, "failed", run.errorMessage);
      publishHaloRun(live, run);
      addAndPublishEvent(
        database,
        live,
        run,
        "failed",
        { error: run.errorMessage },
        turnIndex,
      );
      return { runId };
    }
    tracePath = exported.path;
  }

  const turnSuffix = turnIndex > 1 ? `-turn-${turnIndex}` : "";
  const configPath = join(outputDir, `runner-config${turnSuffix}.json`);
  const resultPath = join(outputDir, `result${turnSuffix}.json`);
  const messages = withDashboardRenderingInstruction(
    buildRunnerMessages(database.sqlite, run, turnIndex),
  );
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        haloPath: engine.installPath,
        maxDepth: run.maxDepth,
        maxParallel: run.maxParallel,
        maxTurns: run.maxTurns,
        messages,
        model: run.model,
        prompt: run.prompt,
        provider: {
          apiKey: provider.apiKey,
          baseUrl: provider.baseUrl,
          headers: provider.headers,
        },
        runId,
        tracePath,
      },
      null,
      2,
    ),
    "utf8",
  );

  run = updateHaloRun(database.sqlite, runId, {
    progress: 25,
    resultPath,
    startedAt: Date.now(),
    status: "running",
  });
  const activeTurn = getAssistantTurn(database.sqlite, runId, turnIndex);
  if (activeTurn) {
    updateHaloRunTurn(database.sqlite, activeTurn.id, { status: "streaming" });
  }
  publishHaloRun(live, run);

  const terminal = await runPythonBridge({
    configPath,
    database,
    enginePath: engine.installPath,
    live,
    resultPath,
    run,
    signal,
    turnIndex,
  });
  if (terminal.cancelled) {
    await markCancelled(database, live, runId);
    return { cancelled: true, runId };
  }
  return { runId };
}

export function withDashboardRenderingInstruction(
  messages: RunnerMessage[],
): RunnerMessage[] {
  let wrappedFirstUser = false;
  return messages.map((message) => {
    if (wrappedFirstUser || message.role !== "user") return message;
    wrappedFirstUser = true;
    return {
      ...message,
      content: `${DASHBOARD_RENDERING_INSTRUCTION}\n\n${message.content}`,
    };
  });
}

async function runPythonBridge(input: {
  configPath: string;
  database: DatabaseHandle;
  enginePath: string;
  live: LiveEventStore;
  resultPath: string;
  run: HaloRun;
  signal: AbortSignal | undefined;
  turnIndex: number;
}) {
  const runnerPath = resolveHaloRunnerPath();
  const proc = Bun.spawn(["uv", "run", "python", runnerPath, input.configPath], {
    cwd: input.enginePath,
    env: process.env,
    stderr: "pipe",
    stdout: "pipe",
  });
  const abort = () => proc.kill();
  input.signal?.addEventListener("abort", abort, { once: true });

  let terminalSeen = false;
  let currentRun = input.run;
  let stdoutError: Error | null = null;
  const stdoutPromise = readJsonLines(proc.stdout, async (event) => {
    if (isCancelled(input.database, input.run.id, input.signal)) {
      proc.kill();
      return;
    }
    const eventType = String(event.type ?? "log");
    currentRun = getHaloRun(input.database.sqlite, input.run.id) ?? currentRun;
    addAndPublishEvent(
      input.database,
      input.live,
      currentRun,
      eventType,
      event,
      input.turnIndex,
    );

    if (eventType === "delta" || eventType === "agent_step") {
      const progress = Math.min(92, Math.max(currentRun.progress, eventType === "delta" ? 45 : 60));
      currentRun = updateHaloRun(input.database.sqlite, input.run.id, {
        progress,
      });
      publishHaloRun(input.live, currentRun);
      return;
    }

    if (eventType === "completed" || eventType === "incomplete") {
      terminalSeen = true;
      const finalAnswer =
        typeof event.finalAnswer === "string" ? event.finalAnswer : "";
      const finalAnswerSource =
        typeof event.finalAnswerSource === "string"
          ? event.finalAnswerSource
          : eventType;
      writeFileSync(
        input.resultPath,
        JSON.stringify({ event, finalAnswer, runId: input.run.id }, null, 2),
        "utf8",
      );
      currentRun = updateHaloRun(input.database.sqlite, input.run.id, {
        finalAnswer,
        finalAnswerSource,
        finishedAt: Date.now(),
        progress: 100,
        status: eventType === "completed" ? "completed" : "incomplete",
      });
      const turn = getAssistantTurn(
        input.database.sqlite,
        input.run.id,
        input.turnIndex,
      );
      if (turn) {
        updateHaloRunTurn(input.database.sqlite, turn.id, {
          content: finalAnswer,
          finishedAt: Date.now(),
          status: eventType === "completed" ? "completed" : "incomplete",
        });
      }
      publishHaloRun(input.live, currentRun);
      try {
        ensureHaloReportFile(input.database, input.run.id);
      } catch {
        // The report can still be materialized on demand from the UI.
      }
      return;
    }

    if (eventType === "failed") {
      terminalSeen = true;
      currentRun = updateHaloRun(input.database.sqlite, input.run.id, {
        errorMessage: typeof event.error === "string" ? event.error : "HALO run failed.",
        finishedAt: Date.now(),
        progress: 100,
        status: "failed",
      });
      settleActiveAssistantTurn(
        input.database,
        input.run.id,
        "failed",
        currentRun.errorMessage,
      );
      publishHaloRun(input.live, currentRun);
    }
  }).catch((error) => {
    stdoutError = error instanceof Error ? error : new Error(String(error));
  });

  const stderrPromise = new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  await stdoutPromise;
  input.signal?.removeEventListener("abort", abort);
  const stderr = await stderrPromise;

  if (isCancelled(input.database, input.run.id, input.signal)) {
    return { cancelled: true };
  }
  if (stdoutError) throw stdoutError;
  if (exitCode !== 0 && !terminalSeen) {
    const message = stderr.trim() || `HALO runner exited with ${exitCode}`;
    const failed = updateHaloRun(input.database.sqlite, input.run.id, {
      errorMessage: message,
      finishedAt: Date.now(),
      progress: 100,
      status: "failed",
    });
    settleActiveAssistantTurn(input.database, input.run.id, "failed", message);
    publishHaloRun(input.live, failed);
    addAndPublishEvent(
      input.database,
      input.live,
      failed,
      "failed",
      { error: message },
      input.turnIndex,
    );
  }
  return { cancelled: false };
}

function resolveHaloRunnerPath() {
  const candidates = haloRunnerPathCandidates();
  const runnerPath = candidates.find((candidate) => existsSync(candidate));
  if (!runnerPath) {
    throw new Error(
      `HALO local runner script was not found. Checked: ${candidates.join(", ")}`,
    );
  }
  return runnerPath;
}

export function haloRunnerPathCandidates(input: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  importMetaUrl?: string;
} = {}) {
  const env = input.env ?? process.env;
  const cwd = input.cwd ?? process.cwd();
  const importMetaUrl = input.importMetaUrl ?? import.meta.url;

  return [
    env.HALO_RUNNER_PATH,
    env.HALO_PROJECT_ROOT
      ? resolve(env.HALO_PROJECT_ROOT, "scripts/halo-local-runner.py")
      : undefined,
    fileURLToPath(new URL("../scripts/halo-local-runner.py", importMetaUrl)),
    fileURLToPath(new URL("./app/scripts/halo-local-runner.py", importMetaUrl)),
    fileURLToPath(new URL("./scripts/halo-local-runner.py", importMetaUrl)),
    fileURLToPath(new URL("../../../scripts/halo-local-runner.py", importMetaUrl)),
    resolve(cwd, "scripts/halo-local-runner.py"),
  ].filter(Boolean) as string[];
}

async function readJsonLines(
  stream: ReadableStream<Uint8Array> | null,
  onLine: (event: Record<string, unknown>) => Promise<void>,
) {
  if (!stream) return;
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) await onLine(JSON.parse(line) as Record<string, unknown>);
      newline = buffer.indexOf("\n");
    }
  }
  const trailing = buffer.trim();
  if (trailing) await onLine(JSON.parse(trailing) as Record<string, unknown>);
}

function addAndPublishEvent(
  database: DatabaseHandle,
  live: LiveEventStore,
  run: HaloRun,
  eventType: string,
  payload: Record<string, unknown>,
  turnIndex?: number,
) {
  const event = addHaloRunEvent(database.sqlite, {
    eventType,
    payload,
    runId: run.id,
    turnIndex: turnIndex ?? null,
  });
  publishHaloRunEvent(live, run, event);
  return event;
}

/**
 * Extend the job lock far beyond the queue's lock duration. Failures are
 * swallowed — a missed renewal must never be worse than the expiry it
 * prevents (regression guard for the June 2026 "Invalid or expired lock
 * token" crash during multi-minute engine turns).
 */
async function renewJobLock(job: Job<HaloJobData>) {
  const lockableJob = job as Job<HaloJobData> & { token?: string };
  if (!lockableJob.token) return;
  await job.extendLock(lockableJob.token, HALO_LOCK_EXTENSION_MS).catch(() => {});
}

/** Mark the in-flight assistant turn terminal when a run dies outside the happy path. */
function settleActiveAssistantTurn(
  database: DatabaseHandle,
  runId: string,
  status: "cancelled" | "failed",
  errorMessage: string | null,
) {
  const turn = getLatestAssistantTurn(database.sqlite, runId);
  if (!turn || (turn.status !== "pending" && turn.status !== "streaming")) return;
  updateHaloRunTurn(database.sqlite, turn.id, {
    errorMessage,
    finishedAt: Date.now(),
    status,
  });
}

async function markCancelled(
  database: DatabaseHandle,
  live: LiveEventStore,
  runId: string,
) {
  const cancelled = updateHaloRun(database.sqlite, runId, {
    errorMessage: "HALO run cancelled by user.",
    finishedAt: Date.now(),
    status: "cancelled",
  });
  settleActiveAssistantTurn(database, runId, "cancelled", "HALO run cancelled by user.");
  publishHaloRun(live, cancelled);
  addAndPublishEvent(database, live, cancelled, "cancelled", {
    error: "HALO run cancelled by user.",
  });
}

function isCancelled(
  database: DatabaseHandle,
  runId: string,
  signal: AbortSignal | undefined,
) {
  return signal?.aborted || isHaloRunCancelled(database.sqlite, runId);
}


function queueDataPath(databasePath: string) {
  return databasePath === ":memory:" ? ":memory:" : `${databasePath}.halo.bunqueue.sqlite`;
}
