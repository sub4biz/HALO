import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";

import { ensureSchema } from "../src/server/db/client";

const createSqlite = () => new Database(":memory:", { strict: true });
import {
  appendHaloRunTurns,
  buildRunnerMessages,
  createHaloRun,
  createHaloRunTurns,
  deleteHaloRun,
  addHaloRunEvent,
  getAssistantTurn,
  getHaloRun,
  getLatestAssistantTurn,
  listHaloRunEvents,
  listHaloRunTurns,
  updateHaloRun,
  updateHaloRunTurn,
} from "../src/server/halo/storage";
import { withDashboardRenderingInstruction } from "../src/server/halo/runQueue";

function setup() {
  const sqlite = createSqlite();
  ensureSchema(sqlite);
  const run = createHaloRun(sqlite, {
    filters: {},
    maxDepth: 1,
    maxParallel: 2,
    maxTurns: 8,
    model: "test-model",
    prompt: "Find the slow spans.",
    providerId: "p1",
    providerName: "Test",
    targetType: "trace_group",
    title: "Turns test",
  });
  return { run, sqlite };
}

describe("halo run turns", () => {
  test("createHaloRunTurns seeds the first user/assistant pair", () => {
    const { run, sqlite } = setup();
    expect(run.model).toBe("test-model");
    const turns = createHaloRunTurns(sqlite, run);
    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({
      content: "Find the slow spans.",
      role: "user",
      status: "completed",
      turnIndex: 0,
    });
    expect(turns[1]).toMatchObject({ role: "assistant", status: "pending", turnIndex: 1 });
  });

  test("appendHaloRunTurns adds a follow-up pair with sequential indexes", () => {
    const { run, sqlite } = setup();
    createHaloRunTurns(sqlite, run);
    const first = getAssistantTurn(sqlite, run.id, 1);
    updateHaloRunTurn(sqlite, first!.id, {
      content: "Answer one.",
      finishedAt: Date.now(),
      status: "completed",
    });

    const { assistantTurn, userTurn } = appendHaloRunTurns(
      sqlite,
      run,
      "What about retries?",
    );
    expect(userTurn).toMatchObject({ role: "user", turnIndex: 2 });
    expect(assistantTurn).toMatchObject({ role: "assistant", status: "pending", turnIndex: 3 });
    expect(getLatestAssistantTurn(sqlite, run.id)?.turnIndex).toBe(3);
  });

  test("buildRunnerMessages includes history up to the pending turn", () => {
    const { run, sqlite } = setup();
    createHaloRunTurns(sqlite, run);
    updateHaloRunTurn(sqlite, getAssistantTurn(sqlite, run.id, 1)!.id, {
      content: "Answer one.",
      status: "completed",
    });
    const { assistantTurn } = appendHaloRunTurns(sqlite, run, "What about retries?");

    const messages = buildRunnerMessages(sqlite, run, assistantTurn.turnIndex);
    expect(messages).toEqual([
      { content: "Find the slow spans.", role: "user" },
      { content: "Answer one.", role: "assistant" },
      { content: "What about retries?", role: "user" },
    ]);
  });

  test("withDashboardRenderingInstruction wraps only the first user message", () => {
    const messages = withDashboardRenderingInstruction([
      { content: "Find the slow spans.", role: "user" },
      { content: "Answer one.", role: "assistant" },
      { content: "What about retries?", role: "user" },
    ]);

    expect(messages[0]?.content).toContain("Dashboard rendering instruction:");
    expect(messages[0]?.content).toContain(
      "- Trace: [trace:<lowercase hex trace id>]",
    );
    expect(messages[0]?.content).toContain(
      "- Span: [span:<lowercase hex trace id>:<lowercase hex span id>]",
    );
    expect(messages[0]?.content.endsWith("Find the slow spans.")).toBe(true);
    expect(messages[1]).toEqual({ content: "Answer one.", role: "assistant" });
    expect(messages[2]).toEqual({ content: "What about retries?", role: "user" });
  });

  test("legacy runs synthesize a two-turn conversation and persist on append", () => {
    const { run, sqlite } = setup();
    const completed = updateHaloRun(sqlite, run.id, {
      finalAnswer: "Legacy answer.",
      finishedAt: Date.now(),
      status: "completed",
    });

    const synthesized = listHaloRunTurns(sqlite, completed);
    expect(synthesized).toHaveLength(2);
    expect(synthesized[0]).toMatchObject({ content: "Find the slow spans.", role: "user" });
    expect(synthesized[1]).toMatchObject({
      content: "Legacy answer.",
      role: "assistant",
      status: "completed",
    });

    const { assistantTurn } = appendHaloRunTurns(sqlite, completed, "Follow-up?");
    expect(assistantTurn.turnIndex).toBe(3);
    const persisted = listHaloRunTurns(sqlite, completed);
    expect(persisted).toHaveLength(4);
    expect(buildRunnerMessages(sqlite, completed, 3)).toEqual([
      { content: "Find the slow spans.", role: "user" },
      { content: "Legacy answer.", role: "assistant" },
      { content: "Follow-up?", role: "user" },
    ]);
  });

  test("failed assistant turns are skipped in runner history", () => {
    const { run, sqlite } = setup();
    createHaloRunTurns(sqlite, run);
    updateHaloRunTurn(sqlite, getAssistantTurn(sqlite, run.id, 1)!.id, {
      errorMessage: "boom",
      status: "failed",
    });
    const { assistantTurn } = appendHaloRunTurns(sqlite, run, "Try again please");
    expect(buildRunnerMessages(sqlite, run, assistantTurn.turnIndex)).toEqual([
      { content: "Find the slow spans.", role: "user" },
      { content: "Try again please", role: "user" },
    ]);
  });

  test("events carry turn indexes and deleteHaloRun cascades", () => {
    const { run, sqlite } = setup();
    createHaloRunTurns(sqlite, run);
    addHaloRunEvent(sqlite, {
      eventType: "delta",
      payload: { text_delta: "hi" },
      runId: run.id,
      turnIndex: 1,
    });
    expect(listHaloRunEvents(sqlite, run.id)[0]?.turnIndex).toBe(1);

    deleteHaloRun(sqlite, run.id);
    expect(getHaloRun(sqlite, run.id)).toBeNull();
    expect(listHaloRunEvents(sqlite, run.id)).toHaveLength(0);
    expect(
      sqlite
        .query<{ value: number }, [string]>(
          `SELECT count(*) AS value FROM halo_run_turns WHERE run_id = ?`,
        )
        .get(run.id)?.value,
    ).toBe(0);
  });
});
