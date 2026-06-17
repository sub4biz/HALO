import { KeyRound, Loader2, RefreshCcw, Trash2 } from "lucide-react";

import { Badge, Button, Input, Skeleton } from "~/lib/ui";
import { StatusPanel } from "../langfuse/shared";
import { DEFAULT_PHOENIX_URL } from "./shared";

export function ConnectStep({
  apiKey,
  baseUrl,
  connectingId,
  connectionName,
  connections,
  connectionsLoading,
  isConnecting,
  onApiKeyChange,
  onBaseUrlChange,
  onConnect,
  onConnectionNameChange,
  onDeleteConnection,
  onReconnectStored,
}: {
  apiKey: string;
  baseUrl: string;
  connectingId: string | null;
  connectionName: string;
  connections: Array<{
    baseUrl: string;
    discoveredProjects: Array<{ id: string; name: string }>;
    id: string;
    lastStatus: string;
    name: string;
    updatedAt: string;
  }>;
  connectionsLoading: boolean;
  isConnecting: boolean;
  onApiKeyChange: (value: string) => void;
  onBaseUrlChange: (value: string) => void;
  onConnect: () => void;
  onConnectionNameChange: (value: string) => void;
  onDeleteConnection: (id: string) => void;
  onReconnectStored: (id: string) => void;
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_320px]">
      <div className="space-y-4">
        <StatusPanel
          icon={<KeyRound className="h-4 w-4" />}
          title="Phoenix connection"
        >
          <p className="text-sm text-muted-foreground">
            Import data from Arize Phoenix. API Key is only needed when
            authentication is enabled
          </p>
        </StatusPanel>
        <div className="grid gap-3">
          <Input
            label="Connection name"
            onChange={(event) => onConnectionNameChange(event.currentTarget.value)}
            placeholder="Local Phoenix"
            value={connectionName}
          />
          <Input
            label="Phoenix URL"
            onChange={(event) => onBaseUrlChange(event.currentTarget.value)}
            placeholder={DEFAULT_PHOENIX_URL}
            value={baseUrl}
          />
          <Input
            label="API key (optional)"
            onChange={(event) => onApiKeyChange(event.currentTarget.value)}
            placeholder="Leave empty when auth is disabled"
            type="password"
            value={apiKey}
          />
        </div>
        <Button className="w-full" disabled={isConnecting} onClick={onConnect}>
          {isConnecting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCcw className="mr-2 h-4 w-4" />
          )}
          Connect and discover
        </Button>
      </div>

      <div className="rounded-lg border border-subtle bg-background-muted p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Saved connections</h3>
          <Badge variant="outline">{connections.length}</Badge>
        </div>
        <div className="mt-3 space-y-2">
          {connectionsLoading ? (
            <>
              <Skeleton className="h-24 w-full rounded-md" />
              <Skeleton className="h-24 w-full rounded-md" />
            </>
          ) : connections.length === 0 ? (
            <p className="rounded-md border border-dashed border-subtle p-4 text-sm text-muted-foreground">
              No Phoenix connections saved yet.
            </p>
          ) : (
            connections.map((connection) => (
              <div
                className="rounded-md border border-subtle bg-background p-3"
                key={connection.id}
              >
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{connection.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {connection.discoveredProjects.length > 0
                        ? `${connection.discoveredProjects.length} projects · ${connection.baseUrl}`
                        : connection.baseUrl}
                    </p>
                  </div>
                  <Badge
                    variant={
                      connection.lastStatus === "connected"
                        ? "status-success"
                        : "outline"
                    }
                  >
                    {connection.lastStatus}
                  </Badge>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <Button
                    className="flex-1"
                    disabled={isConnecting}
                    onClick={() => onReconnectStored(connection.id)}
                    size="sm"
                    variant="secondary"
                  >
                    {connectingId === connection.id ? (
                      <>
                        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                        Connecting…
                      </>
                    ) : (
                      "Use"
                    )}
                  </Button>
                  <Button
                    aria-label="Delete Phoenix connection"
                    disabled={isConnecting}
                    onClick={() => onDeleteConnection(connection.id)}
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
      </div>
    </div>
  );
}
