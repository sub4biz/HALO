import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import { Activity, Layers3, Loader2, MessageSquare, Play } from "lucide-react";

import { Button, Dialog, Input, Textarea, cn, toast } from "~/lib/ui";
import { trpc } from "~/trpc";
import { FilterSelect } from "~/components/FilterSelect";
import { StatTile } from "~/components/StatTile";
import {
  startDateForRange,
  toFacetOptions,
  type DateRange,
} from "~/lib/format";
import { ModelProviderDialog } from "./ModelProviderDialog";
import { defaultModelForProvider, modelOptionsForProvider } from "./modelOptions";
import type { HaloRun, HaloRunTargetType } from "../../server/halo/types";
import type { FacetId, TelemetryFilters } from "../../server/telemetry/types";

type StatusFilter = "all" | "ok" | "error";
type SourceFilter = "all" | "local" | "langfuse" | "phoenix" | "file";
type ScopeFilter = "all" | "root" | "entrypoint";

const DEFAULT_PROMPT =
  "Analyze these traces. Identify the most important failures, latency bottlenecks, confusing tool behavior, and concrete improvements for the developer.";
const ADD_PROVIDER_OPTION_VALUE = "__add_provider__";

/** Exported so PrefetchAppData can warm the same cache keys. */
export const RUN_CONFIG_FACET_IDS: FacetId[] = [
  "agent_name",
  "llm_model_name",
  "service_name",
  "source",
  "status",
];

export type RunConfigInitialValues = {
  /** Initial telemetry filters; editable controls are seeded from these values. */
  dateRange?: DateRange;
  filters?: TelemetryFilters;
  maxDepth?: number;
  maxParallel?: number;
  maxTurns?: number;
  model?: string;
  prompt?: string;
  providerId?: string;
  targetType?: HaloRunTargetType;
  title?: string;
};

/** Configure and kick off a HALO run. Opens fresh or prefilled from "Re-run with changes". */
export function RunConfigDialog({
  initialValues,
  onOpenChange,
  onStarted,
  open,
}: {
  initialValues?: RunConfigInitialValues;
  onOpenChange: (open: boolean) => void;
  onStarted: (run: HaloRun) => void;
  open: boolean;
}) {
  const utils = trpc.useUtils();
  const [targetType, setTargetType] = useState<HaloRunTargetType>("session_group");
  const [dateRange, setDateRange] = useState<DateRange>("24h");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [searchText, setSearchText] = useState("");
  const [scope, setScope] = useState<ScopeFilter>("all");
  const [source, setSource] = useState<SourceFilter>("all");
  const [serviceName, setServiceName] = useState("all");
  const [agentName, setAgentName] = useState("all");
  const [modelName, setModelName] = useState("all");
  const [providerId, setProviderId] = useState("");
  const [providerDialogOpen, setProviderDialogOpen] = useState(false);
  const [analysisModel, setAnalysisModel] = useState("");
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [maxDepth, setMaxDepth] = useState(1);
  const [maxTurns, setMaxTurns] = useState(8);
  const [maxParallel, setMaxParallel] = useState(2);
  const deferredPrompt = useDeferredValue(prompt);
  const deferredSearchText = useDeferredValue(searchText.trim());

  // Re-seed the form whenever the dialog opens (fresh or prefilled).
  useEffect(() => {
    if (!open) return;
    const initialFilters = initialValues?.filters;
    setTargetType(initialValues?.targetType ?? "session_group");
    setDateRange(initialValues?.dateRange ?? (initialFilters ? "all" : "24h"));
    setStatus(initialFilters?.status ?? "all");
    setSearchText(initialFilters?.freeText ?? "");
    setScope(initialFilters?.scope ?? "all");
    setSource((firstValue(initialFilters?.sources) ?? "all") as SourceFilter);
    setServiceName(firstValue(initialFilters?.serviceNames) ?? "all");
    setAgentName(firstValue(initialFilters?.agents) ?? "all");
    setModelName(firstValue(initialFilters?.llmModelNames) ?? "all");
    setProviderId(initialValues?.providerId ?? "");
    setAnalysisModel(initialValues?.model ?? "");
    setTitle(initialValues?.title ?? "");
    setPrompt(initialValues?.prompt ?? DEFAULT_PROMPT);
    setMaxDepth(initialValues?.maxDepth ?? 1);
    setMaxTurns(initialValues?.maxTurns ?? 8);
    setMaxParallel(initialValues?.maxParallel ?? 2);
  }, [initialValues, open]);

  const filters = useMemo<TelemetryFilters>(() => {
    return {
      agents: agentName === "all" ? undefined : [agentName],
      freeText: deferredSearchText || undefined,
      llmModelNames: modelName === "all" ? undefined : [modelName],
      scope: scope === "all" ? undefined : scope,
      serviceNames: serviceName === "all" ? undefined : [serviceName],
      sources: source === "all" ? undefined : [source],
      startDate: startDateForRange(dateRange),
      status: status === "all" ? undefined : status,
    };
  }, [
    agentName,
    dateRange,
    deferredSearchText,
    modelName,
    scope,
    serviceName,
    source,
    status,
  ]);

  const providersQuery = trpc.halo.providers.list.useQuery(undefined, { enabled: open });
  const sessionFacetsQuery = trpc.sessions.facets.useQuery(
    { facetIds: RUN_CONFIG_FACET_IDS },
    { enabled: open && targetType === "session_group" },
  );
  const traceFacetsQuery = trpc.traces.facets.useQuery(
    { facetIds: RUN_CONFIG_FACET_IDS },
    { enabled: open && targetType === "trace_group" },
  );
  const facets =
    targetType === "session_group" ? sessionFacetsQuery.data : traceFacetsQuery.data;
  const previewQuery = trpc.halo.runs.preview.useQuery(
    { filters, targetType },
    { enabled: open, placeholderData: keepPreviousData },
  );

  // Default to the most recently saved provider so starting a run is
  // one-click when a provider already exists.
  const providers = providersQuery.data ?? [];
  const selectedProvider = providers.find((provider) => provider.id === providerId);
  const selectedProviderModelOptions = selectedProvider
    ? modelOptionsForProvider(selectedProvider.providerType)
    : null;
  const providerOptions = [
    ...providers.map((provider) => ({
      label: provider.name,
      value: provider.id,
    })),
    { label: "Add New Provider", value: ADD_PROVIDER_OPTION_VALUE },
  ];
  useEffect(() => {
    if (!open || providerId) return;
    const mostRecent = providers[0];
    if (mostRecent) {
      setProviderId(mostRecent.id);
      setAnalysisModel(
        initialValues?.model ?? defaultModelForProvider(mostRecent.providerType),
      );
    }
  }, [initialValues?.model, open, providerId, providers]);

  useEffect(() => {
    if (!open || !providerId || analysisModel.trim()) return;
    const provider = providers.find((item) => item.id === providerId);
    if (provider) setAnalysisModel(defaultModelForProvider(provider.providerType));
  }, [analysisModel, open, providerId, providers]);

  const startMutation = trpc.halo.runs.start.useMutation({
    async onSuccess(run) {
      toast.success({ title: "HALO run queued" });
      onOpenChange(false);
      await utils.halo.runs.list.invalidate();
      onStarted(run);
    },
    onError(error) {
      toast.error({ title: "Could not start HALO run", description: error.message });
    },
  });

  const canStart =
    Boolean(providerId) &&
    analysisModel.trim().length > 0 &&
    deferredPrompt.trim().length > 0 &&
    previewQuery.data != null &&
    previewQuery.data.spanCount > 0;

  return (
    <>
      <Dialog
        className="!w-[min(680px,94vw)] !max-w-[94vw] sm:!max-w-[680px] md:!w-[680px]"
        dialogDescription="Pick a filtered group of telemetry, choose a provider, and kick off the analysis."
        dialogTitle={
          <span className="flex items-center gap-2">
            <Play className="h-5 w-5 text-detail-brand" />
            Run Analysis
          </span>
        }
        footer={
          <div className="flex items-center justify-between gap-3 border-t border-subtle px-6 py-4">
            <p className="text-xs text-muted-foreground">
              {previewQuery.data && previewQuery.data.spanCount === 0
                ? "No telemetry matches these filters yet."
                : "Streams results back into this workspace."}
            </p>
            <div className="flex items-center gap-2">
              <Button onClick={() => onOpenChange(false)} variant="ghost">
                Cancel
              </Button>
              <Button
                disabled={!canStart || startMutation.isPending}
                onClick={() =>
                  startMutation.mutate({
                    filters,
                    maxDepth,
                    maxParallel,
                    maxTurns,
                    model: analysisModel.trim(),
                    prompt,
                    providerId,
                    targetType,
                    title: title || undefined,
                  })
                }
              >
                {startMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Play className="mr-2 h-4 w-4" />
                )}
                Start run
              </Button>
            </div>
          </div>
        }
        hideConfirmButton
        maxWidth={680}
        onConfirm={() => undefined}
        onOpenChange={onOpenChange}
        open={open}
      >
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-2">
            <SegmentButton
              active={targetType === "session_group"}
              label="Session group"
              onClick={() => setTargetType("session_group")}
            />
            <SegmentButton
              active={targetType === "trace_group"}
              label="Trace group"
              onClick={() => setTargetType("trace_group")}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-2 sm:col-span-2">
              <span className="text-xs font-semibold uppercase text-muted-foreground">
                Search
              </span>
              <Input
                onChange={(event) => setSearchText(event.currentTarget.value)}
                placeholder="Search trace content"
                value={searchText}
              />
            </label>
            <FilterSelect
              label="Window"
              onChange={(value) => setDateRange(value as DateRange)}
              options={[
                { label: "Last hour", value: "1h" },
                { label: "Last 24 hours", value: "24h" },
                { label: "Last 7 days", value: "7d" },
                { label: "All time", value: "all" },
              ]}
              value={dateRange}
            />
            <FilterSelect
              label="Status"
              onChange={(value) => setStatus(value as StatusFilter)}
              options={[
                { label: "Any status", value: "all" },
                { label: "OK", value: "ok" },
                { label: "Errors", value: "error" },
              ]}
              value={status}
            />
            <FilterSelect
              label="Source"
              onChange={(value) => setSource(value as SourceFilter)}
              options={toFacetOptions(facets?.categorical.source, "Any source")}
              value={source}
            />
            <FilterSelect
              label="Service"
              onChange={setServiceName}
              options={toFacetOptions(facets?.categorical.service_name, "Any service")}
              value={serviceName}
            />
            <FilterSelect
              label="Agent"
              onChange={setAgentName}
              options={toFacetOptions(facets?.categorical.agent_name, "Any agent")}
              value={agentName}
            />
            <FilterSelect
              label="Observed model"
              onChange={setModelName}
              options={toFacetOptions(facets?.categorical.llm_model_name, "Any model")}
              value={modelName}
            />
            <FilterSelect
              label="Scope"
              onChange={(value) => setScope(value as ScopeFilter)}
              options={[
                { label: "Any span", value: "all" },
                { label: "Root spans", value: "root" },
                { label: "Entrypoints", value: "entrypoint" },
              ]}
              value={scope}
            />
          </div>

        <div className="flex gap-2">
          <StatTile
            icon={<Activity />}
            label="Traces"
            loading={previewQuery.isLoading}
            value={previewQuery.data?.traceCount ?? 0}
          />
          <StatTile
            icon={<MessageSquare />}
            label="Sessions"
            loading={previewQuery.isLoading}
            value={previewQuery.data?.sessionCount ?? 0}
          />
          <StatTile
            icon={<Layers3 />}
            label="Spans"
            loading={previewQuery.isLoading}
            value={previewQuery.data?.spanCount ?? 0}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <FilterSelect
            label="Provider"
            onChange={(value) => {
              if (value === ADD_PROVIDER_OPTION_VALUE) {
                setProviderDialogOpen(true);
                return;
              }
              setProviderId(value);
              const provider = providers.find((item) => item.id === value);
              setAnalysisModel(
                provider ? defaultModelForProvider(provider.providerType) : "",
              );
            }}
            options={providerOptions}
            placeholder="Choose provider"
            value={providerId}
          />
          {selectedProviderModelOptions ? (
            <FilterSelect
              label="Model"
              onChange={setAnalysisModel}
              options={selectedProviderModelOptions}
              placeholder="Choose model"
              value={analysisModel}
            />
          ) : (
            <label className="space-y-2">
              <span className="text-xs font-semibold uppercase text-muted-foreground">
                Model
              </span>
              <Input
                disabled={!selectedProvider}
                onChange={(event) => setAnalysisModel(event.currentTarget.value)}
                placeholder={selectedProvider ? "Model id" : "Choose a provider first"}
                value={analysisModel}
              />
            </label>
          )}
          <label className="space-y-2 sm:col-span-2">
            <span className="text-xs font-semibold uppercase text-muted-foreground">
              Title
            </span>
            <Input
              onChange={(event) => setTitle(event.currentTarget.value)}
              placeholder="Optional run title"
              value={title}
            />
          </label>
        </div>

        <label className="space-y-2">
          <span className="text-xs font-semibold uppercase text-muted-foreground">
            Analysis prompt
          </span>
          <Textarea
            className="min-h-28 resize-y"
            onChange={(event) => setPrompt(event.currentTarget.value)}
            value={prompt}
          />
        </label>

        <div className="grid grid-cols-3 gap-3">
          <NumberField label="Depth" min={0} onChange={setMaxDepth} value={maxDepth} />
          <NumberField label="Turns" min={1} onChange={setMaxTurns} value={maxTurns} />
          <NumberField
            label="Parallel"
            min={1}
            onChange={setMaxParallel}
            value={maxParallel}
          />
        </div>
        </div>
      </Dialog>
      <ModelProviderDialog
        onOpenChange={setProviderDialogOpen}
        onSaved={() => {
          setProviderId("");
          setAnalysisModel("");
        }}
        open={providerDialogOpen}
      />
    </>
  );
}

function firstValue(values: readonly string[] | undefined) {
  return values?.find((value) => value.trim().length > 0);
}

function SegmentButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      className={cn(active && "border-detail-brand/60 text-detail-brand")}
      onClick={onClick}
      type="button"
      variant={active ? "secondary" : "outline"}
    >
      {label}
    </Button>
  );
}

function NumberField({
  label,
  min,
  onChange,
  value,
}: {
  label: string;
  min: number;
  onChange: (value: number) => void;
  value: number;
}) {
  return (
    <label className="space-y-2">
      <span className="text-xs font-semibold uppercase text-muted-foreground">
        {label}
      </span>
      <Input
        min={min}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        type="number"
        value={String(value)}
      />
    </label>
  );
}
