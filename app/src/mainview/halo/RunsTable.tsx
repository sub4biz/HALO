import { BrainCircuit, CircleStop, Trash2 } from "lucide-react";

import { Badge, Button, EmptyState, cn } from "~/lib/ui";
import { ProgressBar, StatusBadge } from "~/components/StatusBadge";
import { targetLabel, type HaloRunView } from "./runShared";

const GRID_COLS =
  "grid-cols-[minmax(260px,1.6fr)_minmax(130px,0.6fr)_150px_150px_96px]";

export const ACTIVE_RUN_STATUSES = ["queued", "exporting", "running"] as const;

export function isActiveRun(run: HaloRunView) {
  return (ACTIVE_RUN_STATUSES as readonly string[]).includes(run.status);
}

export function RunsTable({
  onCancel,
  onDelete,
  onOpen,
  onRunAnalysis,
  runs,
}: {
  onCancel: (run: HaloRunView) => void;
  onDelete: (run: HaloRunView) => void;
  onOpen: (run: HaloRunView) => void;
  onRunAnalysis: () => void;
  runs: HaloRunView[];
}) {
  if (runs.length === 0) {
    return (
      <EmptyState
        action={
          <Button onClick={onRunAnalysis} size="sm" variant="outline">
            Run Analysis
          </Button>
        }
        className="w-full py-16"
        description="Pick a trace or session group and let HALO find the failures and bottlenecks."
        icon={BrainCircuit}
        title="No HALO runs yet"
      />
    );
  }

  return (
    <div className="rounded-xl border border-border/55">
      <div
        className={cn(
          "grid rounded-t-xl border-b border-border/50 bg-muted/30 px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground",
          GRID_COLS,
        )}
      >
        <div>Run</div>
        <div className="text-right">Scope</div>
        <div className="pl-6">Status</div>
        <div className="text-right">Created</div>
        <div />
      </div>
      <div>
        {runs.map((run) => {
          const active = isActiveRun(run);
          const created = new Date(run.createdAt);
          return (
            <div
              className={cn(
                "grid w-full cursor-pointer items-center border-b border-border/40 px-4 py-3.5 text-left transition last:rounded-b-xl last:border-b-0 hover:bg-muted/50",
                GRID_COLS,
              )}
              key={run.id}
              onClick={() => onOpen(run)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onOpen(run);
                }
              }}
              role="button"
              tabIndex={0}
            >
              <div className="flex min-w-0 items-center gap-3 pr-4">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-detail-brand/10 text-detail-brand">
                  <BrainCircuit className="h-4.5 w-4.5" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{run.title}</p>
                  <div className="mt-1 flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap">
                    <Badge size="sm" variant="outline">
                      {targetLabel(run.targetType)}
                    </Badge>
                    <span
                      className="truncate text-xs text-muted-foreground"
                      title={`${run.providerName} · ${run.model}`}
                    >
                      {run.providerName || "provider"} · {run.model || "model"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="text-right tabular-nums">
                <p className="text-sm">{run.spanCount.toLocaleString()} spans</p>
                <p className="text-xs text-muted-foreground">
                  {run.traceCount.toLocaleString()} traces
                  {run.sessionCount > 0 ? ` · ${run.sessionCount} sessions` : ""}
                </p>
              </div>

              <div className="min-w-0 pl-6">
                <StatusBadge status={run.status} />
                {active ? (
                  <div className="mt-1.5 w-24">
                    <ProgressBar value={run.progress} />
                  </div>
                ) : null}
              </div>

              <div className="text-right tabular-nums">
                <p className="text-sm">
                  {created.toLocaleDateString(undefined, {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </p>
                <p className="text-xs text-muted-foreground">
                  {created.toLocaleTimeString(undefined, {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </p>
              </div>

              <div
                className="flex items-center justify-end gap-1"
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
              >
                {active ? (
                  <Button
                    aria-label="Cancel run"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => onCancel(run)}
                    size="icon"
                    title="Cancel run"
                    variant="ghost"
                  >
                    <CircleStop className="h-4 w-4" />
                  </Button>
                ) : null}
                <Button
                  aria-label="Delete run"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => onDelete(run)}
                  size="icon"
                  title="Delete run"
                  variant="ghost"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
