import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/traces")({
  validateSearch: (search) => ({
    followLatest:
      search.followLatest === 1 || search.followLatest === "1" ? 1 : undefined,
    sessionId:
      typeof search.sessionId === "string" ? search.sessionId : undefined,
    traceId: typeof search.traceId === "string" ? search.traceId : undefined,
    view: search.view === "sessions" ? "sessions" : undefined,
  }),
  beforeLoad: ({ search }) => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ search, to: "/data" });
  },
});
