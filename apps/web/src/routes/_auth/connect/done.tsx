import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { useEffect, useRef, useState } from "react";
import { useConnections } from "../../../api/connections";
import {
  useStrategies,
  useDiscovery,
  type StrategyDescriptor,
} from "../../../api/strategies";
import {
  useCreateMapping,
  useAvailableSubjects,
  useSyncSubjects,
  type AvailableSubject,
  type SyncSubjectsResult,
} from "../../../api/mappings";
import { useAsyncJob } from "../../../lib/useAsyncJob";
import { StrategyForm } from "../../../components/StrategyForm";

// ─── Search params ────────────────────────────────────────────────────────────

const searchSchema = z.object({
  connectionId: z.string().optional(),
  mappingId: z.string().optional(),
  step: z.coerce.number().optional(),
  error: z.string().optional(),
});

export const Route = createFileRoute("/_auth/connect/done")({
  validateSearch: searchSchema,
  component: ConnectDonePage,
});

// ─── Known OAuth error codes ──────────────────────────────────────────────────

const ERROR_MESSAGES: Record<string, string> = {
  invalid_state:
    "The security token for this OAuth flow was invalid or expired. This can happen if you took too long or if the link was tampered with.",
  token_exchange_failed:
    "Notion returned an authorization code but the server couldn't exchange it for an access token. Check that your Notion integration credentials are correct.",
  notion_api_error:
    "Notion returned an error while completing the connection. Try again.",
  missing_params:
    "The callback was missing required parameters. Try the connection flow again.",
};

// ─── Wizard step union ────────────────────────────────────────────────────────

type WizardStep =
  | { kind: "strategy" }
  | { kind: "config"; strategyKey: string }
  | { kind: "subjects"; mappingId: string; strategyKey: string }
  | { kind: "ingest"; syncResult: SyncSubjectsResult; firstAddedId: string | null };

function stepNumber(step: WizardStep): 1 | 2 | 3 | 4 {
  switch (step.kind) {
    case "strategy": return 1;
    case "config": return 2;
    case "subjects": return 3;
    case "ingest": return 4;
  }
}

// ─── Step indicator ───────────────────────────────────────────────────────────

function ConnectStepIndicator({ current }: { current: 1 | 2 | 3 | 4 }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        marginBottom: 40,
      }}
    >
      <div className="cap">Connect · Notion workspace</div>
      <div style={{ flex: 1, height: 1, background: "var(--line)" }} />
      <div style={{ display: "flex", gap: 6 }}>
        {([1, 2, 3, 4] as const).map((s) => (
          <div
            key={s}
            style={{
              width: 24,
              height: 3,
              background: s <= current ? "var(--accent)" : "var(--fg-whisper)",
              borderRadius: 2,
            }}
          />
        ))}
      </div>
      <div className="cap t-faint">{current} of 4</div>
    </div>
  );
}

// ─── Primitives ───────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div
      style={{
        width: 16,
        height: 16,
        border: "2px solid var(--fg-whisper)",
        borderTopColor: "var(--accent-soft)",
        borderRadius: "50%",
        animation: "connect-spin 0.8s linear infinite",
        flexShrink: 0,
      }}
      aria-hidden="true"
    />
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div
      role="alert"
      style={{
        padding: "12px 16px",
        background: "var(--red-tint)",
        border: "1px solid var(--accent-deep)",
        borderRadius: 4,
        fontSize: 13,
        color: "var(--red-fg)",
        maxWidth: 540,
      }}
    >
      {message}
    </div>
  );
}

// ─── Step 1: Strategy picker ──────────────────────────────────────────────────

interface StrategyPickerProps {
  connectionId: string;
  onSelect: (key: string) => void;
}

function StrategyPicker({ connectionId, onSelect }: StrategyPickerProps) {
  const strategies = useStrategies(connectionId);

  if (strategies.isLoading) {
    return (
      <div className="panel" style={{ padding: "28px 28px", maxWidth: 600 }}>
        <div className="t-sm t-muted" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Spinner />
          Loading strategies…
        </div>
      </div>
    );
  }

  if (strategies.isError) {
    return <ErrorBox message={strategies.error.message} />;
  }

  const list: StrategyDescriptor[] = strategies.data?.strategies ?? [];

  if (list.length === 0) {
    return <ErrorBox message="No strategies available for this connection." />;
  }

  return (
    <div>
      <h1 className="hh-1 serif" style={{ marginBottom: 14, maxWidth: 680 }}>
        How is your workspace structured?{" "}
        <span className="italic t-muted">Choose a mapping strategy.</span>
      </h1>
      <p
        className="t-read t-muted"
        style={{ maxWidth: 600, fontSize: 15.5, marginBottom: 32 }}
      >
        Episteme needs to understand how your Notion workspace maps to subjects
        and units. Select the strategy that fits your setup.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 600 }}>
        {list.map((s) => (
          <div key={s.key} className="panel" style={{ padding: "20px 24px" }}>
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 16,
                marginBottom: 12,
              }}
            >
              <div style={{ flex: 1 }}>
                <div className="serif" style={{ fontSize: 16, fontWeight: 500, marginBottom: 4 }}>
                  {s.label}
                </div>
                <div className="t-sm t-muted" style={{ lineHeight: 1.55 }}>
                  {s.description}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => onSelect(s.key)}
              >
                Use this strategy
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 13 13"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="2,6.5 11,6.5" />
                  <polyline points="7,2.5 11,6.5 7,10.5" />
                </svg>
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Step 2: Discovery + config ───────────────────────────────────────────────

interface DiscoveryConfigProps {
  connectionId: string;
  strategyKey: string;
  onMapped: (mappingId: string) => void;
  onBack: () => void;
}

function DiscoveryConfig({
  connectionId,
  strategyKey,
  onMapped,
  onBack,
}: DiscoveryConfigProps) {
  const [submitError, setSubmitError] = useState<string | null>(null);

  const strategies = useStrategies(connectionId);
  const discovery = useDiscovery(connectionId, strategyKey);
  const createMapping = useCreateMapping(connectionId);

  const strategy = strategies.data?.strategies.find((s) => s.key === strategyKey);

  const handleSubmit = async (config: Record<string, string>) => {
    setSubmitError(null);
    try {
      const result = await createMapping.mutateAsync({ strategyKey, config });
      onMapped(result.mappingId);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to create mapping.");
    }
  };

  if (!strategy || strategies.isLoading) {
    return (
      <div className="panel" style={{ padding: 28, maxWidth: 600 }}>
        <div className="t-sm t-muted" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Spinner />
          Loading…
        </div>
      </div>
    );
  }

  // Build a NOOP discovery payload if still loading so the form can render
  const discoveryPayload = discovery.data ?? {
    databases: [],
    pages: [],
    suggestedConfig: {},
  };

  return (
    <div>
      <h1 className="hh-1 serif" style={{ marginBottom: 14, maxWidth: 680 }}>
        Configure the mapping.{" "}
        <span className="italic t-muted">Confirm or adjust the fields below.</span>
      </h1>
      <p
        className="t-read t-muted"
        style={{ maxWidth: 600, fontSize: 15.5, marginBottom: 32 }}
      >
        Episteme scanned your workspace&apos;s resources. Select the databases and
        properties that match your setup.
      </p>

      {/* Discovery status */}
      {discovery.isLoading && (
        <div className="panel" style={{ padding: "16px 20px", maxWidth: 600, marginBottom: 24 }}>
          <div className="t-sm t-muted" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Spinner />
            Scanning your workspace…
          </div>
        </div>
      )}

      {discovery.isError && (
        <div
          className="panel"
          style={{
            padding: "14px 16px",
            maxWidth: 600,
            marginBottom: 24,
            background: "var(--amber-tint)",
            border: "1px solid var(--amber)",
          }}
          role="status"
        >
          <span className="t-sm" style={{ color: "var(--amber-fg)" }}>
            Discovery failed — you can still configure manually below.
          </span>
        </div>
      )}

      {/* Config form */}
      <div className="panel" style={{ padding: "24px 28px", maxWidth: 600 }}>
        <div style={{ display: "flex", alignItems: "baseline", marginBottom: 20 }}>
          <h2 className="hh-3 serif" style={{ margin: 0 }}>
            {strategy.label}
          </h2>
        </div>

        {submitError && (
          <div
            role="alert"
            style={{
              marginBottom: 16,
              padding: "10px 14px",
              background: "var(--red-tint)",
              border: "1px solid var(--accent-deep)",
              borderRadius: 4,
              fontSize: 13,
              color: "var(--red-fg)",
            }}
          >
            {submitError}
          </div>
        )}

        <StrategyForm
          schema={strategy.configSchema}
          defaults={discoveryPayload.suggestedConfig}
          discovery={discoveryPayload}
          connectionId={connectionId}
          onSubmit={handleSubmit}
          submitLabel="Save mapping"
          submitting={createMapping.isPending}
        />
      </div>

      <div style={{ marginTop: 16 }}>
        <button className="btn btn-ghost btn-sm" onClick={onBack}>
          <svg
            width="13"
            height="13"
            viewBox="0 0 13 13"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="11,6.5 2,6.5" />
            <polyline points="6,2.5 2,6.5 6,10.5" />
          </svg>
          Back
        </button>
      </div>
    </div>
  );
}

// ─── Step 3: Subject picker ───────────────────────────────────────────────────

// Small checkbox mimicking the design's green-tint check style
function SubjectCheckbox({
  checked,
  onChange,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  id: string;
}) {
  return (
    <div
      role="checkbox"
      aria-checked={checked}
      id={id}
      tabIndex={0}
      onClick={() => onChange(!checked)}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          onChange(!checked);
        }
      }}
      style={{
        width: 16,
        height: 16,
        borderRadius: 3,
        background: checked ? "var(--green-tint)" : "transparent",
        boxShadow: checked
          ? "none"
          : "inset 0 0 0 1px var(--fg-whisper)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        flexShrink: 0,
        transition: "background 120ms, box-shadow 120ms",
      }}
    >
      {checked && (
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="var(--green-fg)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="1.5,5 4,7.5 8.5,2" />
        </svg>
      )}
    </div>
  );
}


// ─── Step 4: Ingest progress + redirect ───────────────────────────────────────

interface IngestJobRowProps {
  subjectId: string;
  jobId: string;
  name: string;
}

function IngestJobRow({ subjectId: _subjectId, jobId, name }: IngestJobRowProps) {
  const job = useAsyncJob(jobId);

  const state = job.data?.state;
  const isDone = state === "completed";
  const isFailed = state === "failed";
  const isActive = state === "active";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "11px 16px",
        borderBottom: "1px solid var(--line)",
      }}
    >
      {/* Status dot */}
      <div
        style={{
          width: 20,
          height: 20,
          borderRadius: "50%",
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: isDone
            ? "var(--green-tint)"
            : isFailed
              ? "var(--red-tint)"
              : "transparent",
          boxShadow: isDone || isFailed
            ? "none"
            : "inset 0 0 0 1px var(--fg-whisper)",
        }}
        aria-hidden="true"
      >
        {isDone && (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--green-fg)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="1.5,5 4,7.5 8.5,2" />
          </svg>
        )}
        {isFailed && (
          <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="var(--red-fg)" strokeWidth="2" strokeLinecap="round">
            <line x1="2" y1="2" x2="7" y2="7" />
            <line x1="7" y1="2" x2="2" y2="7" />
          </svg>
        )}
        {!isDone && !isFailed && isActive && (
          <div
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "var(--accent-soft)",
              animation: "connect-pulse 1.4s ease-in-out infinite",
            }}
          />
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          className="t-sm"
          style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {name}
        </div>
        <div className="t-xs t-faint" style={{ marginTop: 1 }}>
          {isDone
            ? "Done"
            : isFailed
              ? (job.data?.failedReason ?? "Failed")
              : isActive
                ? "Reading your Notion workspace…"
                : "Waiting in queue…"}
        </div>
      </div>
    </div>
  );
}

interface IngestProgressStepProps {
  connectionId: string;
  syncResult: SyncSubjectsResult;
  firstAddedId: string | null;
  availableSubjects: AvailableSubject[];
}

function IngestProgressStep({
  connectionId: _connectionId,
  syncResult,
  firstAddedId,
  availableSubjects,
}: IngestProgressStepProps) {
  const navigate = useNavigate();
  const [autoRedirected, setAutoRedirected] = useState(false);
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { jobs, added, kept } = syncResult;

  // Resolve subject name from available subjects list
  const nameFor = (subjectId: string) => {
    const s = availableSubjects.find(
      (sub) => sub.subjectId === subjectId || sub.externalId === subjectId,
    );
    return s?.name ?? subjectId;
  };

  // If no new jobs, navigate immediately
  useEffect(() => {
    if (jobs.length === 0 && !autoRedirected) {
      setAutoRedirected(true);
      const target = kept[0] ?? firstAddedId;
      if (target) {
        void navigate({ to: "/audit/$subjectId", params: { subjectId: target } });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (jobs.length === 0) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: "50%",
            background: "var(--green-tint)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
          aria-hidden="true"
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="var(--green-fg)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="1.5,5.5 4.5,8.5 9.5,2.5" />
          </svg>
        </div>
        <span className="t-sm">Subjects updated. Opening your audit…</span>
      </div>
    );
  }

  return (
    <IngestJobsWatcher
      jobs={jobs}
      added={added}
      kept={kept}
      firstAddedId={firstAddedId}
      nameFor={nameFor}
      navigate={navigate}
      redirectTimerRef={redirectTimerRef}
    />
  );
}

// Extracted to avoid hook-count variance (jobs.length is dynamic)
interface IngestJobsWatcherProps {
  jobs: Array<{ subjectId: string; jobId: string }>;
  added: string[];
  kept: string[];
  firstAddedId: string | null;
  nameFor: (id: string) => string;
  navigate: ReturnType<typeof useNavigate>;
  redirectTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
}

function IngestJobsWatcher({
  jobs,
  added,
  kept,
  firstAddedId,
  nameFor,
  navigate,
  redirectTimerRef,
}: IngestJobsWatcherProps) {
  // Poll each job — useAsyncJob handles per-query refetch intervals
  // We render one row per job; each row calls useAsyncJob internally.
  // To know if ALL are done, we pass jobIds to a watcher hook.
  const allJobIds = jobs.map((j) => j.jobId);
  const [autoRedirected, setAutoRedirected] = useState(false);

  // Aggregate watcher — poll all job states
  const agg = useAllJobsDoneWatcher(allJobIds);
  const allDone = agg.allTerminal;
  const allSucceeded = agg.allTerminal && !agg.anyFailed;

  useEffect(() => {
    // Only auto-redirect when EVERY job succeeded. If any failed, stay on
    // this page so the user can see the per-row failure copy and retry.
    if (allSucceeded && !autoRedirected) {
      redirectTimerRef.current = setTimeout(() => {
        if (!autoRedirected) {
          setAutoRedirected(true);
          const target = firstAddedId ?? added[0] ?? kept[0];
          if (target) {
            void navigate({ to: "/audit/$subjectId", params: { subjectId: target } });
          }
        }
      }, 1500);
    }
    return () => {
      if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allSucceeded]);

  const handleContinue = () => {
    if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current);
    setAutoRedirected(true);
    const target = firstAddedId ?? added[0] ?? kept[0];
    if (target) {
      void navigate({ to: "/audit/$subjectId", params: { subjectId: target } });
    }
  };

  return (
    <div>
      <h1 className="hh-1 serif" style={{ marginBottom: 14, maxWidth: 680 }}>
        Ingesting your subjects.{" "}
        <span className="italic t-muted">Reading Notion…</span>
      </h1>
      <p
        className="t-read t-muted"
        style={{ maxWidth: 600, fontSize: 15.5, marginBottom: 28 }}
      >
        Episteme is pulling notes and building embeddings for each new subject.
        This takes 20–90 seconds per subject depending on workspace size.
      </p>

      <div className="panel" style={{ padding: 0, overflow: "hidden", maxWidth: 560, marginBottom: 24 }}>
        {jobs.map((job, i) => (
          <div
            key={job.jobId}
            style={{ borderBottom: i < jobs.length - 1 ? undefined : "none" }}
          >
            <IngestJobRow
              subjectId={job.subjectId}
              jobId={job.jobId}
              name={nameFor(job.subjectId)}
            />
          </div>
        ))}
      </div>

      {allDone && allSucceeded && (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 20,
              height: 20,
              borderRadius: "50%",
              background: "var(--green-tint)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
            aria-hidden="true"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--green-fg)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="1.5,5 4,7.5 8.5,2" />
            </svg>
          </div>
          <span className="t-sm t-muted">All jobs complete.</span>
          <button
            className="btn btn-primary btn-sm"
            onClick={handleContinue}
            style={{ marginLeft: 8 }}
          >
            Continue to audit
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="2,6.5 11,6.5" />
              <polyline points="7,2.5 11,6.5 7,10.5" />
            </svg>
          </button>
        </div>
      )}

      {allDone && agg.anyFailed && (
        <div
          role="alert"
          style={{
            padding: "14px 16px",
            background: "var(--red-tint)",
            border: "1px solid var(--accent-deep)",
            borderRadius: 4,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div className="t-sm" style={{ color: "var(--red-fg)" }}>
            <strong>
              {agg.failedCount} of {jobs.length} subject{jobs.length === 1 ? "" : "s"} failed to ingest.
            </strong>{" "}
            See the per-subject error above. The most common cause is that the
            Notion integration is not yet shared with the relevant page or
            database. Share access in Notion and retry from the settings
            "Manage subjects" panel, or go back and adjust the mapping.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {agg.completedCount > 0 && (
              <button className="btn btn-primary btn-sm" onClick={handleContinue}>
                Continue with {agg.completedCount} succeeded
              </button>
            )}
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => void navigate({ to: "/settings" })}
            >
              Go to settings
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── useAllJobsDoneWatcher ────────────────────────────────────────────────────
// Polls all jobs and reports terminal-state aggregate. Distinguishes the
// "all completed" success path from the "any failed" path so the caller can
// avoid auto-navigating into an empty audit.

interface JobsAggregate {
  allTerminal: boolean;
  anyFailed: boolean;
  failedCount: number;
  completedCount: number;
}

function useAllJobsDoneWatcher(jobIds: string[]): JobsAggregate {
  const [agg, setAgg] = useState<JobsAggregate>({
    allTerminal: false,
    anyFailed: false,
    failedCount: 0,
    completedCount: 0,
  });

  useEffect(() => {
    if (jobIds.length === 0) {
      setAgg({ allTerminal: true, anyFailed: false, failedCount: 0, completedCount: 0 });
      return;
    }
    const TERMINAL = new Set(["completed", "failed"]);
    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      try {
        const results = await Promise.all(
          jobIds.map((id) =>
            fetch(`/api/jobs/${id}`, { credentials: "include" })
              .then((r) => r.json() as Promise<{ state: string }>)
              .catch(() => ({ state: "failed" })),
          ),
        );
        if (cancelled) return;
        const failedCount = results.filter((r) => r.state === "failed").length;
        const completedCount = results.filter((r) => r.state === "completed").length;
        const allTerminal = results.every((r) => TERMINAL.has(r.state));
        setAgg({ allTerminal, anyFailed: failedCount > 0, failedCount, completedCount });
        if (!allTerminal) setTimeout(poll, 1500);
      } catch {
        if (!cancelled) setTimeout(poll, 2000);
      }
    };

    void poll();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return agg;
}

// ─── Main page ────────────────────────────────────────────────────────────────

function ConnectDonePage() {
  const { connectionId, mappingId: searchMappingId, step: searchStep, error } = Route.useSearch();
  const navigate = useNavigate();

  const connections = useConnections();

  // Support deep-linking to step 3 (subject picker) via query params.
  // strategyKey is unknown from the URL but is only used for "back" from subjects
  // → config, which is not meaningful in the deep-link flow (user came from settings).
  const [step, setStep] = useState<WizardStep>(() => {
    if (searchMappingId && (searchStep === 3 || !searchStep)) {
      return { kind: "subjects", mappingId: searchMappingId, strategyKey: "" };
    }
    return { kind: "strategy" };
  });

  const [availableSubjectsSnapshot, setAvailableSubjectsSnapshot] = useState<AvailableSubject[]>([]);

  const currentStepNumber = stepNumber(step);

  // ─── Error state (OAuth callback returned error) ──────────────────────

  if (error) {
    const description = ERROR_MESSAGES[error] ?? `An unexpected error occurred (${error}).`;

    return (
      <div style={{ maxWidth: 600, margin: "80px auto", padding: "0 32px" }}>
        <div className="panel" style={{ padding: "32px 36px" }}>
          <h1 className="hh-3 serif" style={{ marginBottom: 14, fontSize: 18 }}>
            Connection failed
          </h1>
          <p className="t-sm t-muted" style={{ lineHeight: 1.6, marginBottom: 24 }}>
            {description}
          </p>
          <div
            className="t-xs t-faint mono"
            style={{
              padding: "8px 12px",
              background: "var(--elevated)",
              borderRadius: 4,
              marginBottom: 24,
            }}
          >
            error: {error}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <a href="/connect/start?source=notion" className="btn btn-primary">
              Try again
            </a>
            <button
              className="btn btn-ghost"
              onClick={() => void navigate({ to: "/onboarding" })}
            >
              Back to onboarding
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Missing connectionId ─────────────────────────────────────────────

  if (!connectionId) {
    return (
      <div style={{ maxWidth: 600, margin: "80px auto", padding: "0 32px" }}>
        <div className="panel" style={{ padding: "32px 36px" }}>
          <h1 className="hh-3 serif" style={{ marginBottom: 14 }}>
            No connection found
          </h1>
          <p className="t-sm t-muted" style={{ marginBottom: 20 }}>
            This page requires a valid connection. Start the OAuth flow from
            onboarding.
          </p>
          <a href="/connect/start?source=notion" className="btn btn-primary">
            Connect Notion
          </a>
        </div>
      </div>
    );
  }

  // ─── Loading connection ───────────────────────────────────────────────

  if (connections.isLoading) {
    return (
      <div style={{ maxWidth: 920, margin: "0 auto", padding: "56px 48px 80px" }}>
        <div className="t-sm t-muted" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Spinner />
          Loading connection…
        </div>
      </div>
    );
  }

  const connection = connections.data?.connections.find((c) => c.id === connectionId);

  // ─── Render wizard ────────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: 920, margin: "0 auto", padding: "56px 48px 80px" }}>
      <ConnectStepIndicator current={currentStepNumber} />

      {/* Workspace badge */}
      {connection && (
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "5px 12px",
            background: "var(--elevated)",
            borderRadius: 20,
            marginBottom: 32,
          }}
        >
          {connection.workspaceIcon && (
            <img
              src={connection.workspaceIcon}
              alt=""
              style={{ width: 16, height: 16, borderRadius: 3 }}
            />
          )}
          <span className="t-xs t-muted">{connection.workspaceName}</span>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background:
                connection.status === "active" ? "var(--green-fg)" : "var(--fg-whisper)",
            }}
            aria-hidden="true"
          />
        </div>
      )}

      {step.kind === "strategy" && (
        <StrategyPicker
          connectionId={connectionId}
          onSelect={(key) => setStep({ kind: "config", strategyKey: key })}
        />
      )}

      {step.kind === "config" && (
        <DiscoveryConfig
          connectionId={connectionId}
          strategyKey={step.strategyKey}
          onMapped={(mappingId) => {
            setStep({ kind: "subjects", mappingId, strategyKey: step.strategyKey });
          }}
          onBack={() => setStep({ kind: "strategy" })}
        />
      )}

      {step.kind === "subjects" && (
        <SubjectPickerWithSnapshot
          connectionId={connectionId}
          mappingId={step.mappingId}
          onSynced={(result, snapshot) => {
            setAvailableSubjectsSnapshot(snapshot);
            const firstAdded = result.added[0] ?? null;
            setStep({ kind: "ingest", syncResult: result, firstAddedId: firstAdded });
          }}
          onBack={() => setStep({ kind: "config", strategyKey: step.strategyKey })}
        />
      )}

      {step.kind === "ingest" && (
        <IngestProgressStep
          connectionId={connectionId}
          syncResult={step.syncResult}
          firstAddedId={step.firstAddedId}
          availableSubjects={availableSubjectsSnapshot}
        />
      )}

      <style>{`
        @keyframes connect-spin { to { transform: rotate(360deg); } }
        @keyframes connect-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
      `}</style>
    </div>
  );
}

// ─── SubjectPickerWithSnapshot ────────────────────────────────────────────────
// Wraps SubjectPicker and captures the available subjects snapshot before sync,
// so IngestProgressStep can resolve subject names from subjectIds.

interface SubjectPickerWithSnapshotProps {
  connectionId: string;
  mappingId: string;
  onSynced: (result: SyncSubjectsResult, snapshot: AvailableSubject[]) => void;
  onBack: () => void;
}

function SubjectPickerWithSnapshot({
  connectionId,
  mappingId,
  onSynced,
  onBack,
}: SubjectPickerWithSnapshotProps) {
  const availableSubjects = useAvailableSubjects(connectionId, mappingId);
  const syncSubjects = useSyncSubjects(connectionId, mappingId);
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const subjects: AvailableSubject[] = availableSubjects.data?.subjects ?? [];

  useEffect(() => {
    if (!availableSubjects.data || selected !== null) return;
    const trackedIds = subjects.filter((s) => s.tracked).map((s) => s.externalId);
    if (trackedIds.length > 0) {
      setSelected(new Set(trackedIds));
    } else {
      const first = subjects[0];
      setSelected(new Set(first ? [first.externalId] : []));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableSubjects.data]);

  const effectiveSelected = selected ?? new Set<string>();
  const allSelected = subjects.length > 0 && subjects.every((s) => effectiveSelected.has(s.externalId));
  const noneSelected = subjects.every((s) => !effectiveSelected.has(s.externalId));

  const handleToggle = (externalId: string) => {
    setSelected((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(externalId)) next.delete(externalId);
      else next.add(externalId);
      return next;
    });
  };

  const handleSelectAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(subjects.map((s) => s.externalId)));
  };

  const handleSync = async () => {
    setSyncError(null);
    try {
      const result = await syncSubjects.mutateAsync({
        externalIds: [...effectiveSelected],
        kickIngest: true,
      });
      onSynced(result, subjects);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Failed to sync subjects.");
    }
  };

  // Loading
  if (availableSubjects.isLoading) {
    return (
      <div>
        <h1 className="hh-1 serif" style={{ marginBottom: 14, maxWidth: 680 }}>
          Loading your subjects.{" "}
          <span className="italic t-muted">One moment.</span>
        </h1>
        <div className="panel" style={{ padding: "28px", maxWidth: 600 }}>
          <div className="t-sm t-muted" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Spinner />
            Fetching available subjects from Notion…
          </div>
        </div>
      </div>
    );
  }

  // Error
  if (availableSubjects.isError) {
    return (
      <div>
        <h1 className="hh-1 serif" style={{ marginBottom: 14 }}>Could not load subjects.</h1>
        <ErrorBox message={availableSubjects.error.message} />
        <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={onBack}>Back</button>
          <button className="btn btn-secondary btn-sm" onClick={() => void availableSubjects.refetch()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Empty
  if (subjects.length === 0) {
    return (
      <div>
        <h1 className="hh-1 serif" style={{ marginBottom: 14, maxWidth: 680 }}>
          No subjects found.{" "}
          <span className="italic t-muted">Check your mapping.</span>
        </h1>
        <div className="panel" style={{ padding: "28px", maxWidth: 600, marginBottom: 24 }}>
          <p className="t-sm t-muted" style={{ lineHeight: 1.65, marginBottom: 0 }}>
            Episteme couldn&apos;t find any rows matching your strategy + config.
            Check that the integration is shared with the right pages and
            databases, or go back and adjust the mapping.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={onBack}>
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="11,6.5 2,6.5" />
              <polyline points="6,2.5 2,6.5 6,10.5" />
            </svg>
            Adjust mapping
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => void availableSubjects.refetch()}
            disabled={availableSubjects.isFetching}
          >
            {availableSubjects.isFetching ? "Fetching…" : "Re-fetch from Notion"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="hh-1 serif" style={{ marginBottom: 14, maxWidth: 680 }}>
        Which subjects do you want to track?{" "}
        <span className="italic t-muted">Select all that apply.</span>
      </h1>
      <p className="t-read t-muted" style={{ maxWidth: 600, fontSize: 15.5, marginBottom: 24 }}>
        Episteme found {subjects.length} subject{subjects.length !== 1 ? "s" : ""} in your
        mapping. Pre-checked subjects are already tracked. Uncheck any you want
        removed — their data will be deleted.
      </p>

      {/* Controls bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, maxWidth: 600 }}>
        <button className="btn btn-ghost btn-sm" type="button" onClick={handleSelectAll}>
          {allSelected ? "Deselect all" : "Select all"}
        </button>
        <span style={{ flex: 1 }} />
        <button
          className="btn btn-ghost btn-sm"
          type="button"
          onClick={() => void availableSubjects.refetch()}
          disabled={availableSubjects.isFetching}
        >
          {availableSubjects.isFetching ? (
            <><Spinner />Fetching…</>
          ) : (
            "Re-fetch from Notion"
          )}
        </button>
      </div>

      {/* Subject list */}
      <div className="panel" style={{ padding: 0, overflow: "hidden", maxWidth: 600, marginBottom: 24 }}>
        {subjects.map((subject, i) => {
          const isChecked = effectiveSelected.has(subject.externalId);
          return (
            <div
              key={subject.externalId}
              role="checkbox"
              aria-checked={isChecked}
              tabIndex={0}
              onClick={() => handleToggle(subject.externalId)}
              onKeyDown={(e) => {
                if (e.key === " " || e.key === "Enter") {
                  e.preventDefault();
                  handleToggle(subject.externalId);
                }
              }}
              style={{
                display: "grid",
                gridTemplateColumns: "20px 1fr auto",
                alignItems: "center",
                gap: 12,
                padding: "12px 16px",
                borderBottom: i < subjects.length - 1 ? "1px solid var(--line)" : "none",
                cursor: "pointer",
                background: isChecked ? "rgba(77,139,106,0.04)" : "transparent",
                transition: "background 100ms",
              }}
            >
              <SubjectCheckbox
                id={`spws-${subject.externalId}`}
                checked={isChecked}
                onChange={() => {}}
              />
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 2 }}>
                  {subject.glyph && (
                    <span style={{ fontSize: 14, lineHeight: 1, flexShrink: 0 }} aria-hidden="true">
                      {subject.glyph}
                    </span>
                  )}
                  <span
                    className="serif"
                    style={{
                      fontSize: 14,
                      fontWeight: 500,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {subject.name}
                  </span>
                </div>
                {(subject.course ?? subject.term) && (
                  <div className="t-xs t-faint">
                    {[subject.course, subject.term].filter(Boolean).join(" · ")}
                  </div>
                )}
              </div>
              <div style={{ flexShrink: 0 }}>
                {subject.tracked && (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      padding: "2px 8px",
                      background: "var(--elevated)",
                      border: "1px solid var(--line-strong)",
                      borderRadius: 999,
                      fontSize: 10.5,
                      color: "var(--fg-muted)",
                      fontFamily: "var(--mono)",
                      letterSpacing: "0.04em",
                    }}
                  >
                    tracked
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {syncError && (
        <div
          role="alert"
          style={{
            marginBottom: 16,
            padding: "10px 14px",
            background: "var(--red-tint)",
            border: "1px solid var(--accent-deep)",
            borderRadius: 4,
            fontSize: 13,
            color: "var(--red-fg)",
            maxWidth: 600,
          }}
        >
          {syncError}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8, maxWidth: 600 }}>
        <button className="btn btn-ghost btn-sm" onClick={onBack}>
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="11,6.5 2,6.5" />
            <polyline points="6,2.5 2,6.5 6,10.5" />
          </svg>
          Back
        </button>
        <span style={{ flex: 1 }} />
        <span className="t-xs t-faint">{effectiveSelected.size} of {subjects.length} selected</span>
        <button
          className="btn btn-primary"
          disabled={syncSubjects.isPending || noneSelected}
          onClick={() => void handleSync()}
        >
          {syncSubjects.isPending ? (
            <><Spinner />Saving…</>
          ) : (
            <>
              Confirm subjects
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="2,6.5 11,6.5" />
                <polyline points="7,2.5 11,6.5 7,10.5" />
              </svg>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
