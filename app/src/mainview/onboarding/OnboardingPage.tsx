import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  DownloadCloud,
  FileUp,
  Radio,
  Sparkles,
} from "lucide-react";

import { Button, cn } from "~/lib/ui";
import { trpc } from "~/trpc";
import { ModelProviderDialog } from "~/halo/ModelProviderDialog";
import { LangfuseLogo, PhoenixLogo } from "~/tracing/ImportDataScreen";
import { APP_CATALYST_URL } from "../../desktop/commands";
import { openExternalUrl } from "../desktop/desktopBridge";

type OnboardingStep = "welcome" | "model" | "traces";

const STEPS: Array<{ id: OnboardingStep; label: string }> = [
  { id: "welcome", label: "Welcome" },
  { id: "model", label: "Model" },
  { id: "traces", label: "Data" },
];

export function OnboardingPage() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [step, setStep] = useState<OnboardingStep>("welcome");

  const providersQuery = trpc.halo.providers.list.useQuery();

  const completeMutation = trpc.onboarding.complete.useMutation({
    async onSuccess() {
      await utils.onboarding.get.invalidate();
    },
  });

  const finish = async (destination: "home" | "import-data") => {
    await completeMutation.mutateAsync();
    void navigate({ to: destination === "home" ? "/" : "/import-data" });
  };

  const stepIndex = STEPS.findIndex((item) => item.id === step);
  const goNext = () => {
    const next = STEPS[stepIndex + 1]?.id;
    if (next) setStep(next);
  };

  return (
    <main className="min-h-screen overflow-auto bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-8 py-10">
        <header className="flex items-center justify-between">
          <StepRail step={step} />
          <Button
            onClick={() => void finish("home")}
            size="sm"
            variant="ghost"
          >
            Skip setup
          </Button>
        </header>

        <div className="flex flex-1 flex-col justify-center py-10">
          {step === "welcome" ? <WelcomeStep onContinue={goNext} /> : null}
          {step === "model" ? (
            <ModelStep
              connectedProviderName={providersQuery.data?.[0]?.name ?? null}
              onContinue={goNext}
            />
          ) : null}
          {step === "traces" ? (
            <TracesStep onFinish={(destination) => void finish(destination)} />
          ) : null}
        </div>
      </div>
    </main>
  );
}

function WelcomeStep({ onContinue }: { onContinue: () => void }) {
  return (
    <div className="space-y-8">
      <div className="text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-detail-brand">
          Welcome to HALO
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-normal">
          See what your AI agents are really doing
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-base text-muted-foreground">
          HALO is a local control room for AI agents. It collects your agent
          traces, lets you inspect every step, and runs AI analysis that finds
          the failures and bottlenecks for you. Everything stays on this
          machine.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <ValueCard
          description="Stream traces live from any OpenTelemetry or Catalyst exporter, or watch sessions unfold turn by turn."
          icon={<Radio className="h-5 w-5" />}
          title="Watch agents live"
        />
        <ValueCard
          description="Bring trace history in from Langfuse, Arize Phoenix, or a JSONL export. Nothing gets locked in."
          icon={<DownloadCloud className="h-5 w-5" />}
          title="Import from anywhere"
        />
        <ValueCard
          description="Analysis runs read your traces with your own model key and report failures, latency, and fixes."
          icon={<BrainCircuit className="h-5 w-5" />}
          title="Let HALO find issues"
        />
      </div>

      <div className="flex justify-center">
        <Button
          className="h-auto max-w-full whitespace-normal px-4 py-3 text-center leading-5"
          onClick={() => void openExternalUrl(APP_CATALYST_URL)}
          size="lg"
          type="button"
          variant="secondary"
        >
          Run HALO on Catalyst with $250 in free credits -&gt; Try now
        </Button>
      </div>

      <div className="rounded-xl border border-dashed border-border/60 p-5">
        <p className="text-sm font-medium">How it fits into your app</p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-sm text-muted-foreground">
          <FlowNode label="Your agent" />
          <FlowArrow />
          <FlowNode label="Traces into HALO" />
          <FlowArrow />
          <FlowNode label="HALO engine + your model key" />
          <FlowArrow />
          <FlowNode highlight label="Failures, bottlenecks, fixes" />
        </div>
      </div>

      <div className="flex justify-center">
        <Button onClick={onContinue} size="lg">
          Get started
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function ModelStep({
  connectedProviderName,
  onContinue,
}: {
  connectedProviderName: string | null;
  onContinue: () => void;
}) {
  const [providerDialogOpen, setProviderDialogOpen] = useState(false);

  return (
    <div className="space-y-6">
      <StepHeading
        eyebrow="Step 2 of 3"
        title="Connect a model"
        description="HALO's analysis engine uses your API key to reason over your traces. The key is stored in the local database and never leaves this machine."
      />

      {connectedProviderName ? (
        <div className="flex items-center gap-2.5 rounded-md border border-detail-success/30 bg-detail-success/5 px-3 py-2.5 text-sm">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-detail-success" />
          <span>
            <span className="font-medium">{connectedProviderName}</span> is
            already connected. You can add another key or continue.
          </span>
        </div>
      ) : null}

      <div className="rounded-xl border border-subtle bg-card p-6 text-center">
        <p className="text-lg font-medium">
          {connectedProviderName ? "Model provider connected" : "Add a model provider"}
        </p>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          Use OpenAI, Anthropic, or a custom OpenAI-compatible endpoint. You can
          manage providers later in Settings.
        </p>
        <Button
          className="mt-5"
          onClick={() => setProviderDialogOpen(true)}
          size="lg"
        >
          {connectedProviderName ? "Add another provider" : "Add provider"}
        </Button>
      </div>

      <div className="flex items-center justify-center gap-3">
        <Button onClick={onContinue} variant="ghost">
          {connectedProviderName ? "Continue" : "Skip for now"}
        </Button>
      </div>

      <ModelProviderDialog
        onOpenChange={setProviderDialogOpen}
        onSaved={onContinue}
        open={providerDialogOpen}
        submitLabel="Save and continue"
      />
    </div>
  );
}

function TracesStep({
  onFinish,
}: {
  onFinish: (destination: "home" | "import-data") => void;
}) {
  return (
    <div className="space-y-6">
      <StepHeading
        eyebrow="Step 3 of 3"
        title="Bring in your traces"
        description="HALO comes alive once traces arrive. Import history from another tool, or point a live agent at the local endpoint."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <ImportOptionCard
          icon={<LangfuseLogo className="h-6 w-6" />}
          label="Langfuse"
          onClick={() => onFinish("import-data")}
        />
        <ImportOptionCard
          icon={<PhoenixLogo className="h-6 w-6" />}
          label="Phoenix"
          onClick={() => onFinish("import-data")}
        />
        <ImportOptionCard
          icon={<FileUp className="h-5 w-5 text-detail-brand" />}
          label="JSONL file"
          onClick={() => onFinish("import-data")}
        />
      </div>

      <div className="flex justify-center">
        <Button onClick={() => onFinish("home")} size="lg">
          <Sparkles className="mr-2 h-4 w-4" />
          Open HALO
        </Button>
      </div>
    </div>
  );
}

function StepHeading({
  description,
  eyebrow,
  title,
}: {
  description: string;
  eyebrow: string;
  title: string;
}) {
  return (
    <div className="text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-detail-brand">
        {eyebrow}
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-normal">{title}</h1>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
        {description}
      </p>
    </div>
  );
}

function ValueCard({
  description,
  icon,
  title,
}: {
  description: string;
  icon: ReactNode;
  title: string;
}) {
  return (
    <div className="rounded-[18px] border border-border/70 bg-card p-5">
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-detail-brand/10 text-detail-brand">
        {icon}
      </span>
      <h2 className="mt-4 text-base font-semibold">{title}</h2>
      <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{description}</p>
    </div>
  );
}

function FlowNode({ highlight, label }: { highlight?: boolean; label: string }) {
  return (
    <span
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs",
        highlight
          ? "border-detail-brand/40 bg-detail-brand/10 text-detail-brand"
          : "border-subtle bg-background-muted",
      )}
    >
      {label}
    </span>
  );
}

function FlowArrow() {
  return <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />;
}

function ImportOptionCard({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="group flex items-center gap-3 rounded-[18px] border border-border/70 bg-card p-4 text-left transition hover:border-border hover:bg-card-hover/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onClick}
      type="button"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-background-muted">
        {icon}
      </span>
      <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
        {label}
        <ArrowRight className="h-3.5 w-3.5 -translate-x-1 text-muted-foreground opacity-0 transition group-hover:translate-x-0 group-hover:opacity-100" />
      </span>
    </button>
  );
}

function StepRail({ step }: { step: OnboardingStep }) {
  const activeIndex = STEPS.findIndex((item) => item.id === step);
  return (
    <div className="flex items-center gap-2">
      {STEPS.map((item, index) => (
        <div className="flex items-center gap-2" key={item.id}>
          <span
            className={cn(
              "grid h-6 min-w-6 place-items-center rounded-full border text-[11px]",
              index <= activeIndex
                ? "border-detail-brand bg-detail-brand/15 text-detail-brand"
                : "border-subtle text-muted-foreground",
            )}
          >
            {index + 1}
          </span>
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {item.label}
          </span>
          {index < STEPS.length - 1 ? (
            <span className="h-px w-5 bg-border/50" />
          ) : null}
        </div>
      ))}
    </div>
  );
}
