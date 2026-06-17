import { flexRender } from "@tanstack/react-table";
import { useCallback, useMemo, type UIEvent } from "react";
import { MessageSquare } from "lucide-react";

import { EmptyState } from "~/lib/ui";
import {
  formatDuration,
  formatMoney,
  formatTimestamp,
  sourceLabel,
} from "~/lib/format";
import { showDesktopRowContextMenu } from "~/desktop/desktopBridge";
import type {
  SessionSortKey,
  SessionSummary,
} from "../../server/telemetry/types";
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

const SESSION_TABLE_WIDTHS_STORAGE_KEY = "halo-sessions-table-column-widths";

export function SessionList({
  activeSessionId,
  hasNextPage,
  isLoading,
  isFetchingNextPage,
  onLoadMore,
  onSortChange,
  onSelectSession,
  recentSessionIds,
  sessions,
  sortBy,
  sortOrder,
  totalCount,
}: {
  activeSessionId?: string;
  hasNextPage: boolean;
  isLoading: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  onSortChange: (sortBy: SessionSortKey, sortOrder: LogSortOrder) => void;
  onSelectSession: (sessionId: string) => void;
  recentSessionIds: Set<string>;
  sessions: SessionSummary[];
  sortBy: SessionSortKey;
  sortOrder: LogSortOrder;
  totalCount: number;
}) {
  const columns = useMemo<LogTableColumn<SessionSummary, SessionSortKey>[]>(
    () => [
      {
        cell: (session) => (
          <MonoCell>{formatTimestamp(session.startTime)}</MonoCell>
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
        cell: (session) => (
          <span className="flex min-w-0 items-center gap-2.5">
            <KindStatusTile
              kind="CHAIN"
              status={logRowStatus({
                hasError: session.hasError,
                isRecent: recentSessionIds.has(session.sessionId),
              })}
            />
            <span className="min-w-0 truncate text-sm font-medium">
              {session.latestTraceName || "unnamed session"}
            </span>
            {session.sources.some((source) => source !== "local") ? (
              <SourceGlyph
                title={`Imported from ${session.sources
                  .filter((source) => source !== "local")
                  .map((source) => sourceLabel(source))
                  .join(", ")}`}
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
        cell: (session) => <PreviewCell text={session.inputPreview} />,
        defaultTrack: "minmax(150px,1.3fr)",
        header: "Input",
        id: "input",
        maxSize: 720,
        minSize: 150,
        size: 260,
      },
      {
        cell: (session) => (
          <PreviewCell
            status={logRowStatus({
              hasError: session.hasError,
              isRecent: recentSessionIds.has(session.sessionId),
            })}
            text={session.outputPreview}
          />
        ),
        defaultTrack: "minmax(150px,1.3fr)",
        header: "Output",
        id: "output",
        maxSize: 720,
        minSize: 150,
        size: 260,
      },
      {
        align: "right",
        cell: (session) => (
          <MonoCell className="text-right">{session.traceCount}</MonoCell>
        ),
        defaultTrack: "52px",
        header: "Turns",
        id: "turns",
        maxSize: 120,
        minSize: 44,
        size: 52,
        sortKey: "trace_count",
      },
      {
        align: "right",
        cell: (session) => (
          <MonoCell className="text-right">
            {formatDuration(session.durationMs)}
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
        cell: (session) => (
          <MonoCell className="text-right" muted={false}>
            {session.totalCost == null
              ? "—"
              : formatMoney(Number(session.totalCost))}
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
    [recentSessionIds],
  );
  const logTable = useResizableLogTable({
    columns,
    data: sessions,
    getRowId: (session) => session.sessionId,
    storageKey: SESSION_TABLE_WIDTHS_STORAGE_KEY,
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

  if (isLoading && sessions.length === 0) {
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
          rightAlignedCount={3}
        />
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 p-8">
        <EmptyState
          className="min-h-full w-full justify-center"
          description="Sessions appear when traces include a session ID. Traces without one stay hidden here."
          icon={MessageSquare}
          title="No sessions yet"
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
        const session = row.original;
        const status = logRowStatus({
          hasError: session.hasError,
          isRecent: recentSessionIds.has(session.sessionId),
        });
        return (
          <button
            className={logRowClassName({
              active: session.sessionId === activeSessionId,
              flash: recentSessionIds.has(session.sessionId),
              status,
            })}
            key={session.sessionId}
            onClick={() => onSelectSession(session.sessionId)}
            onContextMenu={(event) => {
              event.preventDefault();
              void showDesktopRowContextMenu({
                id: session.sessionId,
                kind: "session",
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
        label="sessions"
        shownCount={sessions.length}
        totalCount={totalCount}
      />
    </div>
  );
}
