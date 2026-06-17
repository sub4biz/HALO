import { useEffect, useMemo, useState } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import { Ban, Loader2, Play, RotateCcw } from "lucide-react";

import {
  Button,
  Dialog,
  cn,
  toast,
} from "~/lib/ui";
import { trpc } from "~/trpc";
import type {
  LangfuseDiscovery,
  LangfuseImportStatus,
} from "../../../server/langfuse/types";
import { ConnectStep } from "./ConnectStep";
import { ImportProgressStep } from "./ImportProgressStep";
import { SelectStep } from "./SelectStep";
import {
  DEFAULT_LANGFUSE_URL,
  type DatePreset,
  type DialogStep,
} from "./shared";

export function LangfuseImportDialog({
  onImported,
  onOpenChange,
  open,
}: {
  onImported: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const utils = trpc.useUtils();
  const [step, setStep] = useState<DialogStep>("connect");
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeFacets, setActiveFacets] = useState<
    LangfuseDiscovery["facets"] | null
  >(null);
  const [connectionName, setConnectionName] = useState("Local Langfuse");
  const [baseUrl, setBaseUrl] = useState(DEFAULT_LANGFUSE_URL);
  const [publicKey, setPublicKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [datePreset, setDatePreset] = useState<DatePreset>("30d");
  const [environment, setEnvironment] = useState("");
  const [traceName, setTraceName] = useState("");
  const [tag, setTag] = useState("");
  const [userId, setUserId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [version, setVersion] = useState("");
  const [release, setRelease] = useState("");

  const connectionsQuery = trpc.langfuse.connections.list.useQuery(undefined, {
    enabled: open,
  });
  const jobsQuery = trpc.langfuse.imports.list.useQuery(
    { limit: 8 },
    { enabled: open },
  );
  const activeJobQuery = trpc.langfuse.imports.get.useQuery(
    { jobId: activeJobId ?? "" },
    {
      enabled: open && Boolean(activeJobId),
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        return status === "queued" || status === "running" ? 1_500 : false;
      },
    },
  );

  // Stable object so the preview query key only changes when a filter does.
  const previewFilters = useMemo(
    () =>
      buildFilters({
        datePreset,
        environment,
        release,
        sessionId,
        tag,
        traceName,
        userId,
        version,
      }),
    [datePreset, environment, release, sessionId, tag, traceName, userId, version],
  );
  const importPreview = trpc.langfuse.imports.preview.useQuery(
    { connectionId: connectionId ?? "", filters: previewFilters },
    {
      enabled: open && step === "select" && Boolean(connectionId),
      placeholderData: keepPreviousData,
      staleTime: 60_000,
    },
  );

  const saveAndDiscover = trpc.langfuse.connections.saveAndDiscover.useMutation({
    onError(error) {
      toast.error({
        title: "Could not connect to Langfuse",
        description: error.message,
      });
    },
    async onSuccess(result) {
      setConnectionId(result.connection.id);
      setActiveFacets(result.discovery.facets);
      setBaseUrl(result.connection.baseUrl);
      setConnectionName(result.connection.name);
      setPublicKey(result.connection.publicKey);
      setSecretKey("");
      resetFacetSelections();
      setStep("select");
      await utils.langfuse.connections.list.invalidate();
      toast.success({
        title: "Langfuse connected",
        description: `${result.discovery.traces.totalItems} traces discovered.`,
      });
    },
  });

  const startImport = trpc.langfuse.imports.start.useMutation({
    onError(error) {
      toast.error({
        title: "Could not start import",
        description: error.message,
      });
    },
    async onSuccess(job) {
      setActiveJobId(job.id);
      setStep("import");
      await utils.langfuse.imports.list.invalidate();
      toast.info({
        title: "Langfuse import queued",
        description: "The import will keep running if this dialog is closed.",
      });
    },
  });

  const cancelImport = trpc.langfuse.imports.cancel.useMutation({
    async onSuccess(job) {
      await utils.langfuse.imports.get.invalidate({ jobId: job.id });
      await utils.langfuse.imports.list.invalidate();
      toast.warning({
        title: "Import cancelled",
        description: "The current Langfuse import has been stopped.",
      });
    },
  });
  const deleteConnection = trpc.langfuse.connections.delete.useMutation({
    async onSuccess() {
      await utils.langfuse.connections.list.invalidate();
    },
  });

  trpc.live.importJob.useSubscription(
    { jobId: activeJobId ?? "" },
    {
      enabled: open && Boolean(activeJobId),
      onData(eventEnvelope) {
        const event = eventEnvelope.data;
        if (event.payload.type !== "import.job.updated") return;
        const snapshot = event.payload.job;
        utils.langfuse.imports.get.setData(
          { jobId: snapshot.id },
          (current) =>
            current
              ? {
                  ...current,
                  ...snapshot,
                  status: snapshot.status as LangfuseImportStatus,
                }
              : current,
        );
        void utils.langfuse.imports.list.invalidate();
        if (snapshot.status === "completed") {
          setStep("done");
          onImported();
        }
      },
    },
  );

  const latestJob = activeJobQuery.data;
  const discovery = useMemo(() => {
    const connection = connectionsQuery.data?.find((item) => item.id === connectionId);
    return activeFacets ?? connection?.discoveredFacets;
  }, [activeFacets, connectionId, connectionsQuery.data]);

  useEffect(() => {
    if (!open || activeJobId) return;
    const running = jobsQuery.data?.find((job) =>
      ["queued", "running"].includes(job.status),
    );
    if (running) {
      setActiveJobId(running.id);
      setStep("import");
    }
  }, [activeJobId, jobsQuery.data, open]);

  useEffect(() => {
    if (!latestJob || !activeJobId) return;
    if (latestJob.status === "completed") {
      setStep("done");
      onImported();
    }
  }, [activeJobId, latestJob, onImported]);

  // Closing the dialog after an import has finished resets the wizard, so the
  // next open starts fresh instead of replaying the previous run. A still
  // running import keeps its state so reopening returns to the progress view.
  useEffect(() => {
    if (open || step === "connect" || step === "select") return;
    const active =
      latestJob?.status === "queued" || latestJob?.status === "running";
    if (active) return;
    setActiveJobId(null);
    setStep("connect");
  }, [latestJob, open, step]);

  const connectWithCurrentValues = () => {
    saveAndDiscover.mutate({
      baseUrl,
      name: connectionName,
      publicKey,
      secretKey,
    });
  };

  const reconnectStored = (id: string) => {
    saveAndDiscover.mutate({ id });
  };

  const beginImport = () => {
    if (!connectionId) return;
    // Import exactly what the preview counted.
    startImport.mutate({ connectionId, filters: previewFilters });
  };

  const canStartImport =
    Boolean(connectionId) &&
    !startImport.isPending &&
    importPreview.data?.traces !== 0;
  const jobActive =
    latestJob?.status === "queued" || latestJob?.status === "running";
  const jobFailed =
    latestJob?.status === "failed" || latestJob?.status === "interrupted";
  // Which saved connection the in-flight "Use" click belongs to.
  const connectingId = saveAndDiscover.isPending
    ? ((saveAndDiscover.variables as { id?: string } | undefined)?.id ?? null)
    : null;

  return (
    <Dialog
      className="!w-[min(800px,92vw)] !max-w-[92vw] sm:!max-w-[800px] md:!w-[800px]"
      dialogDescription="Bring historical Langfuse traces into the local HALO timeline."
      dialogTitle="Import Data"
      maxWidth={800}
      footer={
        <div className="flex items-center justify-between gap-3 border-t border-subtle px-6 py-4">
          <StepRail
            failed={
              latestJob?.status === "failed" ||
              latestJob?.status === "interrupted"
            }
            step={step}
          />
          <div className="flex items-center gap-2">
            {step === "connect" ? (
              <Button onClick={() => onOpenChange(false)} variant="ghost">
                Close
              </Button>
            ) : null}
            {step === "select" ? (
              <>
                <Button onClick={() => setStep("connect")} variant="secondary">
                  Back
                </Button>
                <Button disabled={!canStartImport} onClick={beginImport}>
                  {startImport.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="mr-2 h-4 w-4" />
                  )}
                  Start import
                </Button>
              </>
            ) : null}
            {step === "import" || step === "done" ? (
              jobActive ? (
                <Button
                  disabled={cancelImport.isPending || !latestJob}
                  onClick={() => {
                    if (latestJob) cancelImport.mutate({ jobId: latestJob.id });
                  }}
                  variant="secondary"
                >
                  <Ban className="mr-2 h-4 w-4" />
                  Cancel import
                </Button>
              ) : (
                <>
                  <Button onClick={() => onOpenChange(false)} variant="ghost">
                    Close
                  </Button>
                  <Button
                    onClick={() => {
                      setActiveJobId(null);
                      setStep("select");
                    }}
                    variant={jobFailed ? "secondary" : "default"}
                  >
                    Start another import
                  </Button>
                  {jobFailed && latestJob ? (
                    <Button
                      disabled={startImport.isPending}
                      onClick={() =>
                        startImport.mutate({
                          connectionId: latestJob.connectionId,
                          filters: latestJob.filters,
                        })
                      }
                    >
                      <RotateCcw className="mr-2 h-4 w-4" />
                      Retry import
                    </Button>
                  ) : null}
                </>
              )
            ) : null}
          </div>
        </div>
      }
      hideConfirmButton
      onConfirm={() => undefined}
      onOpenChange={onOpenChange}
      open={open}
    >
      <div className="space-y-5">
        {saveAndDiscover.isPending ? (
          <div className="flex items-center gap-2.5 rounded-md border border-detail-brand/30 bg-detail-brand/5 px-3 py-2.5 text-sm text-detail-brand">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            Connecting to Langfuse and discovering your traces — this can take
            a few seconds…
          </div>
        ) : null}

        {step === "connect" ? (
          <ConnectStep
            baseUrl={baseUrl}
            connectingId={connectingId}
            connectionName={connectionName}
            connections={connectionsQuery.data ?? []}
            connectionsLoading={connectionsQuery.isLoading}
            isConnecting={saveAndDiscover.isPending}
            onBaseUrlChange={setBaseUrl}
            onConnect={connectWithCurrentValues}
            onConnectionNameChange={setConnectionName}
            onDeleteConnection={(id) => deleteConnection.mutate({ id })}
            onPublicKeyChange={setPublicKey}
            onReconnectStored={reconnectStored}
            onSecretKeyChange={setSecretKey}
            publicKey={publicKey}
            secretKey={secretKey}
          />
        ) : null}

        {step === "select" ? (
          <SelectStep
            datePreset={datePreset}
            discovery={discovery}
            environment={environment}
            preview={importPreview.data}
            previewError={importPreview.isError}
            previewFetching={importPreview.isFetching}
            previewLoading={importPreview.isLoading}
            onDatePresetChange={setDatePreset}
            onEnvironmentChange={setEnvironment}
            onReleaseChange={setRelease}
            onSessionIdChange={setSessionId}
            onTagChange={setTag}
            onTraceNameChange={setTraceName}
            onUserIdChange={setUserId}
            onVersionChange={setVersion}
            release={release}
            sessionId={sessionId}
            tag={tag}
            traceName={traceName}
            userId={userId}
            version={version}
          />
        ) : null}

        {step === "import" || step === "done" ? (
          <ImportProgressStep job={latestJob} />
        ) : null}
      </div>
    </Dialog>
  );

  function resetFacetSelections() {
    setDatePreset("30d");
    setEnvironment("");
    setTraceName("");
    setTag("");
    setUserId("");
    setSessionId("");
    setVersion("");
    setRelease("");
  }
}

function StepRail({ failed, step }: { failed?: boolean; step: DialogStep }) {
  const steps: DialogStep[] = ["connect", "select", "import", "done"];
  const activeIndex = steps.indexOf(step);
  return (
    <div className="hidden items-center gap-2 md:flex">
      {steps.map((item, index) => {
        const failedStep = failed && item === "import" && index <= activeIndex;
        return (
          <div className="flex items-center gap-2" key={item}>
            <span
              className={cn(
                "grid h-6 min-w-6 place-items-center rounded-full border text-[11px]",
                failedStep
                  ? "border-detail-failure bg-detail-failure/15 text-detail-failure"
                  : index <= activeIndex
                    ? "border-detail-brand bg-detail-brand/15 text-detail-brand"
                    : "border-subtle text-muted-foreground",
              )}
            >
              {index + 1}
            </span>
            <span className="text-xs capitalize text-muted-foreground">{item}</span>
            {index < steps.length - 1 ? (
              <span className="h-px w-5 bg-border/50" />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function buildFilters(input: {
  datePreset: DatePreset;
  environment: string;
  release: string;
  sessionId: string;
  tag: string;
  traceName: string;
  userId: string;
  version: string;
}) {
  const fromTimestamp = fromTimestampForPreset(input.datePreset);
  return {
    environment: input.environment || undefined,
    fromTimestamp,
    release: input.release || undefined,
    sessionId: input.sessionId || undefined,
    tag: input.tag || undefined,
    traceName: input.traceName || undefined,
    userId: input.userId || undefined,
    version: input.version || undefined,
  };
}

function fromTimestampForPreset(preset: DatePreset) {
  if (preset === "all") return undefined;
  const hours = preset === "24h" ? 24 : preset === "7d" ? 24 * 7 : 24 * 30;
  // Snap to a 5-minute boundary so the preview query key stays cacheable
  // instead of producing a new timestamp on every render.
  const snapMs = 5 * 60 * 1000;
  const now = Math.floor(Date.now() / snapMs) * snapMs;
  return new Date(now - hours * 60 * 60 * 1000).toISOString();
}
