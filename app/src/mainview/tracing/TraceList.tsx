import { flexRender } from "@tanstack/react-table";
import { useCallback, useMemo, type UIEvent } from "react";
import { Search } from "lucide-react";

import { EmptyState } from "~/lib/ui";
import {
  formatDuration,
  formatMoney,
  formatTimestamp,
  sourceLabel,
} from "~/lib/format";
import { showDesktopRowContextMenu } from "~/desktop/desktopBridge";
import type { Trace, TraceSortKey } from "../../server/telemetry/types";
import {
  KindStatusTile,
  LogTableFooter,
  LogTableNextPageLoader,
  LogTableSkeleton,
  MonoCell,
  PreviewCell,
  ResizableLogTableHeader,
  SourceGlyph,
  type LogSortOrder,
  type LogTableColumn,
  logRowClassName,
  logRowStatus,
  useResizableLogTable,
} from "./logTable";

const TRACE_TABLE_WIDTHS_STORAGE_KEY = "halo-traces-table-column-widths";

export function TraceList({
  activeTraceId,
  hasNextPage,
  isLoading,
  isFetchingNextPage,
  onLoadMore,
  onSortChange,
  onSelectTrace,
  recentTraceIds,
  sortBy,
  sortOrder,
  totalCount,
  traces,
}: {
  activeTraceId?: string;
  hasNextPage: boolean;
  isLoading: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  onSortChange: (sortBy: TraceSortKey, sortOrder: LogSortOrder) => void;
  onSelectTrace: (traceId: string) => void;
  recentTraceIds: Set<string>;
  sortBy: TraceSortKey;
  sortOrder: LogSortOrder;
  totalCount: number;
  traces: Trace[];
}) {
  const columns = useMemo<LogTableColumn<Trace, TraceSortKey>[]>(
    () => [
      {
        cell: (trace) => (
          <MonoCell>{formatTimestamp(trace.startTime)}</MonoCell>
        ),
        defaultTrack: "120px",
        header: "Created",
        id: "created",
        maxSize: 220,
        minSize: 96,
        size: 120,
        sortKey: "start_time",
      },
      {
        cell: (trace) => (
          <span className="flex min-w-0 items-center gap-2.5">
            <KindStatusTile
              kind={trace.rootObservationKind}
              status={logRowStatus({
                hasError: trace.hasError,
                isRecent: recentTraceIds.has(trace.traceId),
              })}
            />
            <span className="min-w-0 truncate text-sm font-medium">
              {trace.rootSpanName || "unnamed trace"}
            </span>
            {trace.source !== "local" ? (
              <SourceGlyph
                title={[
                  `Imported from ${sourceLabel(trace.source)}`,
                  trace.sourceConnectionName
                    ? `Connection: ${trace.sourceConnectionName}`
                    : null,
                ]
                  .filter(Boolean)
                  .join("\n")}
              />
            ) : null}
          </span>
        ),
        defaultTrack: "minmax(150px,1fr)",
        header: "Name",
        id: "name",
        maxSize: 560,
        minSize: 150,
        size: 220,
      },
      {
        cell: (trace) => <PreviewCell text={trace.inputPreview} />,
        defaultTrack: "minmax(170px,1.4fr)",
        header: "Input",
        id: "input",
        maxSize: 720,
        minSize: 170,
        size: 280,
      },
      {
        cell: (trace) => (
          <PreviewCell
            status={logRowStatus({
              hasError: trace.hasError,
              isRecent: recentTraceIds.has(trace.traceId),
            })}
            text={trace.outputPreview}
          />
        ),
        defaultTrack: "minmax(170px,1.4fr)",
        header: "Output",
        id: "output",
        maxSize: 720,
        minSize: 170,
        size: 280,
      },
      {
        align: "right",
        cell: (trace) => (
          <MonoCell className="text-right">
            {formatDuration(trace.durationMs)}
          </MonoCell>
        ),
        defaultTrack: "80px",
        header: "Duration",
        id: "duration",
        maxSize: 180,
        minSize: 72,
        size: 80,
        sortKey: "duration",
      },
      {
        align: "right",
        cell: (trace) => (
          <MonoCell className="text-right" muted={false}>
            {trace.totalCost == null
              ? "—"
              : formatMoney(Number(trace.totalCost))}
          </MonoCell>
        ),
        defaultTrack: "72px",
        header: "Cost",
        id: "cost",
        maxSize: 160,
        minSize: 64,
        size: 72,
        sortKey: "total_cost",
      },
    ],
    [recentTraceIds],
  );
  const logTable = useResizableLogTable({
    columns,
    data: traces,
    getRowId: (trace) => trace.traceId,
    storageKey: TRACE_TABLE_WIDTHS_STORAGE_KEY,
  });
  const handleScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      if (!hasNextPage || isFetchingNextPage) return;
      const element = event.currentTarget;
      const distanceFromBottom =
        element.scrollHeight - element.scrollTop - element.clientHeight;
      if (distanceFromBottom < 360) {
        onLoadMore();
      }
    },
    [hasNextPage, isFetchingNextPage, onLoadMore],
  );

  if (isLoading && traces.length === 0) {
    return (
      <div className="min-h-0 flex-1 overflow-auto">
        <ResizableLogTableHeader
          logTable={logTable}
          onSortChange={onSortChange}
          sortBy={sortBy}
          sortOrder={sortOrder}
        />
        <LogTableSkeleton
          columnCount={columns.length}
          gridStyle={logTable.gridStyle}
          rightAlignedCount={2}
        />
      </div>
    );
  }

  if (traces.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 p-8">
        <EmptyState
          className="min-h-full w-full justify-center"
          description="Broaden the filters or wait for another local ingest batch."
          icon={Search}
          title="No matching traces"
        />
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto" onScroll={handleScroll}>
      <ResizableLogTableHeader
        logTable={logTable}
        onSortChange={onSortChange}
        sortBy={sortBy}
        sortOrder={sortOrder}
      />
      {logTable.table.getRowModel().rows.map((row) => {
        const trace = row.original;
        const status = logRowStatus({
          hasError: trace.hasError,
          isRecent: recentTraceIds.has(trace.traceId),
        });
        return (
          <button
            className={logRowClassName({
              active: trace.traceId === activeTraceId,
              flash: recentTraceIds.has(trace.traceId),
              status,
            })}
            key={trace.traceId}
            onClick={() => onSelectTrace(trace.traceId)}
            onContextMenu={(event) => {
              event.preventDefault();
              void showDesktopRowContextMenu({
                id: trace.traceId,
                kind: "trace",
                sourceName:
                  trace.source === "local" ? null : sourceLabel(trace.source),
                sourceUrl: trace.sourceUrl,
              });
            }}
            style={logTable.gridStyle}
            type="button"
          >
            {row.getVisibleCells().map((cell) => {
              const meta = cell.column.columnDef.meta as
                | { align?: "left" | "right" }
                | undefined;
              return (
                <span
                  className={`block min-w-0 ${meta?.align === "right" ? "text-right" : ""}`}
                  key={cell.id}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </span>
              );
            })}
          </button>
        );
      })}
      {isFetchingNextPage ? <LogTableNextPageLoader /> : null}
      <LogTableFooter
        label="traces"
        shownCount={traces.length}
        totalCount={totalCount}
      />
    </div>
  );
}
