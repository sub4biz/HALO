import type { ReactNode } from "react";
import { Fragment, useMemo } from "react";
import { Link, useRouterState } from "@tanstack/react-router";

import { InferenceIcon } from "~/lib/ui";
import { isDesktopShell, openExternalUrl } from "~/desktop/desktopBridge";
import { APP_INFERENCE_LOGO_URL } from "../../desktop/commands";

type HeaderCrumb = {
  label: string;
  to?: "/" | "/data" | "/analysis" | "/imports" | "/settings" | "/welcome";
};

/**
 * The single fixed window header used by every page.
 *
 * The outer div is the ElectroBun window drag region (titleBarStyle
 * hiddenInset); interactive children must live inside the no-drag wrapper.
 * In the desktop shell the left cell stays empty — it's the macOS traffic
 * lights' zone and the wordmark moves below it into WorkspaceNav. In a plain
 * browser there are no traffic lights, so the wordmark lives here.
 */
export function AppHeader({
  actions,
  description,
  icon,
  status,
  title,
}: {
  actions?: ReactNode;
  description?: string;
  icon?: ReactNode;
  status?: ReactNode;
  title: string;
}) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const breadcrumbs = useMemo(
    () => buildHeaderBreadcrumbs(pathname, title),
    [pathname, title],
  );

  return (
    <div className="electrobun-webkit-app-region-drag fixed inset-x-0 top-0 z-40 grid h-14 select-none grid-cols-[14rem_minmax(0,1fr)]">
      {isDesktopShell() ? (
        <div className="h-14 border-r border-border/50 bg-sidebar" />
      ) : (
        <div className="flex h-14 items-center border-r border-border/50 bg-sidebar px-5">
          <button
            aria-label="Open Inference"
            className="electrobun-webkit-app-region-no-drag inline-flex"
            onClick={() => void openExternalUrl(APP_INFERENCE_LOGO_URL)}
            type="button"
          >
            <InferenceIcon height={20} width={120} />
          </button>
        </div>
      )}
      <div className="flex min-w-0 items-center justify-between gap-4 border-b border-border/50 bg-sidebar px-6">
        <div className="flex min-w-0 items-center gap-3">
          {icon ? (
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-subtle bg-card">
              {icon}
            </div>
          ) : null}
          <HeaderBreadcrumbs breadcrumbs={breadcrumbs} />
          {description ? (
            <span className="hidden truncate text-xs text-muted-foreground md:block">
              {description}
            </span>
          ) : null}
        </div>

        <div className="electrobun-webkit-app-region-no-drag flex min-w-0 shrink-0 items-center gap-2">
          {status}
          {actions}
        </div>
      </div>
    </div>
  );
}

function HeaderBreadcrumbs({ breadcrumbs }: { breadcrumbs: HeaderCrumb[] }) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex min-w-0 shrink items-center overflow-hidden"
    >
      {breadcrumbs.map((crumb, index) => {
        const current = index === breadcrumbs.length - 1;
        return (
          <Fragment key={`${crumb.label}-${index}`}>
            {index > 0 ? (
              <span className="mx-3 select-none text-sm text-muted-foreground/40">
                /
              </span>
            ) : null}
            {crumb.to && !current ? (
              <Link
                className="shrink-0 whitespace-nowrap text-sm text-muted-foreground transition-colors hover:text-foreground"
                search={{} as never}
                to={crumb.to}
              >
                {crumb.label}
              </Link>
            ) : (
              <span
                className={
                  current
                    ? "truncate whitespace-nowrap text-sm text-foreground"
                    : "shrink-0 whitespace-nowrap text-sm text-muted-foreground"
                }
              >
                {crumb.label}
              </span>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}

function buildHeaderBreadcrumbs(pathname: string, title: string): HeaderCrumb[] {
  const normalized = pathname.replace(/\/$/, "") || "/";
  const crumbs: HeaderCrumb[] = [{ label: "HALO", to: "/data" }];

  if (normalized === "/" || normalized === "/data" || normalized === "/traces") {
    return [...crumbs, { label: "Data" }];
  }
  if (normalized === "/analysis") {
    return [...crumbs, { label: "Analysis" }];
  }
  if (normalized.startsWith("/analysis/")) {
    return [
      ...crumbs,
      { label: "Analysis", to: "/analysis" },
      { label: title || "Run" },
    ];
  }
  if (normalized === "/imports") {
    return [...crumbs, { label: "Imports" }];
  }
  if (normalized === "/import-data") {
    return [
      ...crumbs,
      { label: "Imports", to: "/imports" },
      { label: "Import Data" },
    ];
  }
  if (normalized === "/settings") {
    return [...crumbs, { label: "Settings" }];
  }
  if (normalized === "/welcome") {
    return [...crumbs, { label: "Setup" }];
  }
  return [...crumbs, { label: title }];
}
