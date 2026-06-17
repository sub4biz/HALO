import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Copy,
  DownloadCloud,
  Loader2,
  Palette,
  RefreshCcw,
  Trash2,
} from "lucide-react";

import {
  Button,
  Dialog,
  Input,
  ThemeToggle,
  cn,
  toast,
} from "~/lib/ui";
import { trpc } from "~/trpc";
import { WorkspaceNav } from "~/workspace/WorkspaceNav";
import { AppHeader } from "~/components/AppHeader";
import { StatusBadge } from "~/components/StatusBadge";
import { ModelProviderDialog } from "./ModelProviderDialog";
import { getDesktopAppMetadata } from "../desktop/desktopBridge";
import {
  APP_BUNDLE_ID,
  APP_RELEASE_URL,
  type DesktopAppMetadata,
} from "../../desktop/commands";

export function SettingsPage() {
  const utils = trpc.useUtils();
  const navigate = useNavigate();
  const engineQuery = trpc.halo.engine.status.useQuery();
  const providersQuery = trpc.halo.providers.list.useQuery();
  const telemetryInfoQuery = trpc.telemetry.info.useQuery();
  const [providerDialogOpen, setProviderDialogOpen] = useState(false);
  const [providerPendingDelete, setProviderPendingDelete] = useState<
    { id: string; name: string } | null
  >(null);
  const [clearTelemetryOpen, setClearTelemetryOpen] = useState(false);
  const [factoryResetOpen, setFactoryResetOpen] = useState(false);
  const [factoryResetText, setFactoryResetText] = useState("");
  const [desktopMetadata, setDesktopMetadata] =
    useState<DesktopAppMetadata | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getDesktopAppMetadata().then((metadata) => {
      if (!cancelled) setDesktopMetadata(metadata);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const invalidateWorkspaceData = useCallback(async () => {
    await Promise.all([
      utils.telemetry.info.invalidate(),
      utils.traces.facets.invalidate(),
      utils.traces.list.invalidate(),
      utils.traces.search.invalidate(),
      utils.traces.get.invalidate(),
      utils.traces.getSpans.invalidate(),
      utils.spans.list.invalidate(),
      utils.spans.facets.invalidate(),
      utils.sessions.facets.invalidate(),
      utils.sessions.list.invalidate(),
      utils.sessions.search.invalidate(),
      utils.sessions.get.invalidate(),
      utils.sessions.getSpans.invalidate(),
      utils.sessions.getTraces.invalidate(),
      utils.halo.engine.status.invalidate(),
      utils.halo.providers.list.invalidate(),
      utils.halo.runs.list.invalidate(),
      utils.langfuse.connections.list.invalidate(),
      utils.langfuse.imports.list.invalidate(),
      utils.phoenix.connections.list.invalidate(),
      utils.phoenix.imports.list.invalidate(),
      utils.fileImport.imports.list.invalidate(),
      utils.onboarding.get.invalidate(),
    ]);
  }, [utils]);

  const installMutation = trpc.halo.engine.installOrUpdate.useMutation({
    async onSuccess() {
      toast.success({ title: "HALO engine is ready" });
      await utils.halo.engine.status.invalidate();
    },
    onError(error) {
      toast.error({ title: "HALO install failed", description: error.message });
    },
  });
  const testProviderMutation = trpc.halo.providers.test.useMutation({
    async onSuccess() {
      toast.success({ title: "Provider connected" });
      await utils.halo.providers.list.invalidate();
    },
    onError(error) {
      toast.error({ title: "Provider test failed", description: error.message });
    },
  });
  const replayOnboardingMutation = trpc.onboarding.reset.useMutation({
    async onSuccess() {
      await utils.onboarding.get.invalidate();
      void navigate({ to: "/welcome" });
    },
  });
  const deleteProviderMutation = trpc.halo.providers.delete.useMutation({
    async onSuccess() {
      setProviderPendingDelete(null);
      await utils.halo.providers.list.invalidate();
    },
  });
  const clearTelemetryMutation = trpc.telemetry.clearData.useMutation({
    onError(error) {
      toast.error({
        title: "Could not clear telemetry data",
        description: error.message,
      });
    },
    async onSuccess(result) {
      setClearTelemetryOpen(false);
      await invalidateWorkspaceData();
      toast.success({
        title: "Telemetry data cleared",
        description: `${result.traceCount} traces and ${result.spanCount} spans removed.`,
      });
    },
  });
  const factoryResetMutation = trpc.telemetry.factoryReset.useMutation({
    onError(error) {
      toast.error({
        title: "Factory reset failed",
        description: error.message,
      });
    },
    async onSuccess(result) {
      setFactoryResetOpen(false);
      setFactoryResetText("");
      if (typeof window !== "undefined") {
        window.localStorage.clear();
      }
      await invalidateWorkspaceData();
      toast.success({
        title: "Factory reset complete",
        description: `${result.telemetry.traceCount} traces, ${result.haloRunCount} runs, and ${result.haloProviderCount} providers removed.`,
      });
      void navigate({ to: "/welcome" });
    },
  });

  const providers = providersQuery.data ?? [];
  const status = engineQuery.data;
  const telemetryInfo = telemetryInfoQuery.data;
  const metadata = desktopMetadata ?? {
    appDataDir: "Desktop shell unavailable in browser preview",
    bundleId: APP_BUNDLE_ID,
    channel: import.meta.env.DEV ? "dev" : "unknown",
    dbPath: telemetryInfo?.dbPath ?? "data/halo-canvas.sqlite",
    ingestUrl: "",
    liveUrl: "",
    releaseUrl: APP_RELEASE_URL,
    version: import.meta.env.DEV ? "dev" : "unknown",
  };

  return (
    <main className="h-screen overflow-hidden bg-background text-foreground">
      <AppHeader title="Settings" />
      <div className="grid h-full min-h-0 grid-cols-[14rem_minmax(0,1fr)] pt-14">
        <WorkspaceNav active="settings" />
        <section className="min-h-0 min-w-0 overflow-y-auto">
          <div className="mx-auto flex max-w-6xl flex-col gap-6 p-8">
            <div>
              <h1 className="text-2xl tracking-normal">Settings</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Configure the local HALO engine and model providers.
              </p>
            </div>
            <div className="space-y-5">
              <section className="rounded-xl border border-subtle bg-card">
                <div className="flex items-start justify-between gap-4 border-b border-subtle p-5">
                  <div>
                    <h2 className="text-lg font-medium">Model providers</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Keys are stored in the local SQLite database and masked in
                      the UI.
                    </p>
                  </div>
                  <Button onClick={() => setProviderDialogOpen(true)} size="sm">
                    Add Provider
                  </Button>
                </div>
                <div className="divide-y divide-subtle">
                  {providers.length === 0 ? (
                    <div className="p-5 text-sm text-muted-foreground">
                      No providers saved yet.
                    </div>
                  ) : (
                    providers.map((provider) => (
                      <div
                        className="flex items-center justify-between gap-4 p-5"
                        key={provider.id}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="truncate font-medium">{provider.name}</p>
                            <StatusBadge status={provider.lastStatus} />
                          </div>
                          <p className="mt-1 truncate text-xs text-muted-foreground">
                            {provider.baseUrl} · {provider.apiKeyMasked}
                          </p>
                          {provider.lastError ? (
                            <p className="mt-1 text-xs text-destructive">
                              {provider.lastError}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Button
                            disabled={testProviderMutation.isPending}
                            onClick={() => testProviderMutation.mutate({ id: provider.id })}
                            size="sm"
                            variant="outline"
                          >
                            Test
                          </Button>
                          <Button
                            aria-label={`Delete provider ${provider.name}`}
                            onClick={() =>
                              setProviderPendingDelete({
                                id: provider.id,
                                name: provider.name,
                              })
                            }
                            size="icon"
                            variant="ghost"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>

              <section className="rounded-xl border border-subtle bg-card">
                <div className="flex items-start gap-3 border-b border-subtle p-5">
                  <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-medium">Data Management</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Manage local telemetry, database details, and reset options.
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      disabled={replayOnboardingMutation.isPending}
                      onClick={() => replayOnboardingMutation.mutate()}
                      size="sm"
                      variant="outline"
                    >
                      Replay onboarding
                    </Button>
                    <ThemeToggle
                      trigger={
                        <Button size="sm" variant="outline">
                          <Palette className="mr-2 h-4 w-4" />
                          Theme
                        </Button>
                      }
                    />
                  </div>
                </div>
                <div className="divide-y divide-subtle">
                  <div className="px-5">
                    <DefinitionRow
                      copyable
                      label="Database path"
                      value={metadata.dbPath}
                    />
                    <DefinitionRow
                      label="Stored telemetry"
                      value={`${telemetryInfo?.traceCount ?? 0} traces · ${telemetryInfo?.spanCount ?? 0} spans`}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-4 p-5">
                    <div className="min-w-0">
                      <p className="font-medium">Clear telemetry data</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Removes traces, spans, search rows, ingest batches, and live telemetry history.
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Current database: {telemetryInfo?.traceCount ?? 0} traces ·{" "}
                        {telemetryInfo?.spanCount ?? 0} spans
                      </p>
                    </div>
                    <Button
                      disabled={clearTelemetryMutation.isPending}
                      onClick={() => setClearTelemetryOpen(true)}
                      size="sm"
                      variant="outline"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Clear telemetry
                    </Button>
                  </div>
                  <div className="flex items-center justify-between gap-4 p-5">
                    <div className="min-w-0">
                      <p className="font-medium text-destructive">Factory reset</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Removes telemetry, providers, import credentials, HALO runs, engine install data, and app settings.
                      </p>
                    </div>
                    <Button
                      disabled={factoryResetMutation.isPending}
                      onClick={() => setFactoryResetOpen(true)}
                      size="sm"
                      variant="destructive"
                    >
                      <RefreshCcw className="mr-2 h-4 w-4" />
                      Factory reset
                    </Button>
                  </div>
                </div>
              </section>

              <section className="rounded-xl border border-subtle bg-card">
                <div className="flex items-start justify-between gap-4 border-b border-subtle p-5">
                  <div>
                    <h2 className="text-lg font-medium">HALO Configuration</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Engine install, runtime checks, and desktop app details.
                    </p>
                  </div>
                  <StatusBadge status={status?.status ?? "not_installed"} />
                </div>
                <div className="divide-y divide-subtle px-5">
                  <DefinitionRow
                    copyable
                    label="Install path"
                    value={status?.installPath ?? "data/halo-engine"}
                  />
                  <DefinitionRow
                    copyable
                    label="Repo"
                    value={status?.repoUrl ?? "https://github.com/context-labs/HALO"}
                  />
                  <DefinitionRow label="Commit" value={status?.commitSha ?? "not installed"} />
                  <DefinitionRow label="Python" value={status?.checks.python ?? "missing"} />
                  <DefinitionRow label="uv" value={status?.checks.uv ?? "missing"} />
                  <DefinitionRow label="git" value={status?.checks.git ?? "missing"} />
                  <DefinitionRow label="Version" value={metadata.version} />
                  <DefinitionRow label="Channel" value={metadata.channel} />
                  <DefinitionRow label="Bundle ID" value={metadata.bundleId} />
                  <DefinitionRow
                    copyable
                    label="Release URL"
                    value={metadata.releaseUrl}
                  />
                  <DefinitionRow
                    copyable
                    label="App data folder"
                    value={metadata.appDataDir}
                  />
                </div>
                {status?.lastError ? (
                  <div className="mx-5 mb-4 rounded-md border border-destructive-border bg-destructive/5 p-3 text-sm text-destructive">
                    {status.lastError}
                  </div>
                ) : null}
                <div className="flex items-center justify-between gap-4 border-t border-subtle p-5">
                  <p className="text-sm text-muted-foreground">
                    Requires git, uv, and Python 3.12. The engine may still call
                    the configured model provider.
                  </p>
                  <Button
                    disabled={installMutation.isPending}
                    onClick={() => installMutation.mutate()}
                  >
                    {installMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <DownloadCloud className="mr-2 h-4 w-4" />
                    )}
                    Install / update HALO
                  </Button>
                </div>
              </section>
            </div>
          </div>
        </section>
      </div>

      <ModelProviderDialog
        onOpenChange={setProviderDialogOpen}
        open={providerDialogOpen}
      />

      <Dialog
        cancelTitle="Cancel"
        confirmButtonVariant="destructive"
        confirmTitle="Delete provider"
        dialogDescription={`This removes "${providerPendingDelete?.name ?? ""}" and its stored API key from the local database.`}
        dialogTitle="Delete this provider?"
        disabled={deleteProviderMutation.isPending}
        loading={deleteProviderMutation.isPending}
        onConfirm={() => {
          if (providerPendingDelete) {
            deleteProviderMutation.mutate({ id: providerPendingDelete.id });
          }
        }}
        onOpenChange={(open) => {
          if (!open) setProviderPendingDelete(null);
        }}
        open={Boolean(providerPendingDelete)}
      />
      <Dialog
        cancelTitle="Cancel"
        className="sm:!max-w-[520px] md:!w-[520px]"
        confirmButtonVariant="destructive"
        confirmTitle="Clear telemetry"
        dialogDescription="This removes local traces, spans, search rows, ingest batches, and live telemetry history. Saved providers, import credentials, and HALO runs stay intact."
        dialogTitle="Clear local telemetry data?"
        disabled={clearTelemetryMutation.isPending}
        loading={clearTelemetryMutation.isPending}
        onConfirm={() => clearTelemetryMutation.mutate()}
        onOpenChange={setClearTelemetryOpen}
        open={clearTelemetryOpen}
      >
        <div className="rounded-md border border-destructive-border bg-destructive/5 p-4 text-sm">
          <p className="font-medium text-foreground">This cannot be undone.</p>
          <p className="mt-1 text-muted-foreground">
            Current local database contains {telemetryInfo?.traceCount ?? 0} traces and{" "}
            {telemetryInfo?.spanCount ?? 0} spans.
          </p>
        </div>
      </Dialog>
      <Dialog
        cancelTitle="Cancel"
        className="sm:!max-w-[540px] md:!w-[540px]"
        confirmButtonVariant="destructive"
        confirmTitle="Factory reset"
        dialogDescription="This removes all local HALO data, including telemetry, providers, import credentials, analysis runs, engine install data, and app settings."
        dialogTitle="Factory reset HALO?"
        disabled={
          factoryResetMutation.isPending || factoryResetText.trim() !== "HALO"
        }
        loading={factoryResetMutation.isPending}
        onConfirm={() => factoryResetMutation.mutate()}
        onOpenChange={(open) => {
          setFactoryResetOpen(open);
          if (!open) setFactoryResetText("");
        }}
        open={factoryResetOpen}
      >
        <div className="space-y-4">
          <div className="rounded-md border border-destructive-border bg-destructive/5 p-4 text-sm">
            <p className="font-medium text-foreground">This cannot be undone.</p>
            <p className="mt-1 text-muted-foreground">
              Saved API keys, import credentials, HALO runs, local traces, and app-owned files will be removed.
            </p>
          </div>
          <Input
            label='Type "HALO" to confirm'
            onChange={(event) => setFactoryResetText(event.currentTarget.value)}
            placeholder="HALO"
            value={factoryResetText}
          />
        </div>
      </Dialog>
    </main>
  );
}

function DefinitionRow({
  copyable,
  label,
  value,
}: {
  copyable?: boolean;
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-4 py-3">
      <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate font-mono text-xs" title={value}>
          {value}
        </span>
        {copyable ? (
          <Button
            aria-label={`Copy ${label}`}
            className={cn("h-6 w-6 shrink-0 text-muted-foreground")}
            onClick={async () => {
              await navigator.clipboard.writeText(value);
              toast.success({ title: `${label} copied` });
            }}
            size="icon"
            variant="ghost"
          >
            <Copy className="h-3 w-3" />
          </Button>
        ) : null}
      </span>
    </div>
  );
}
