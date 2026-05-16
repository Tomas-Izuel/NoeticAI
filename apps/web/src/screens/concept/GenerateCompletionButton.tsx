// GenerateCompletionButton — state-machine button driven by eligibility + running status.
import type { FC } from "react";
import { Link } from "@tanstack/react-router";
import { Icon } from "./primitives";

export type EligibilityState =
  | { kind: "loading" }
  | { kind: "ok"; candidateChunkCount: number }
  | { kind: "no_sources_loaded" }
  | { kind: "no_ready_sources"; sourcesTotal: number; sourcesReady: number }
  | { kind: "no_related_chunks"; topSimilarity: number | null; similarityFloor: number }
  | { kind: "error"; onRetry: () => void };

interface GenerateCompletionButtonProps {
  isRunning: boolean;
  onGenerate: () => void;
  eligibility: EligibilityState;
  subjectId: string;
}

function BibliographyLink({ subjectId }: { subjectId: string }) {
  return (
    <Link
      to="/bibliography"
      search={{ subjectId }}
      className="btn btn-ghost btn-sm"
      style={{ textDecoration: "none", marginTop: 8, alignSelf: "flex-start" }}
    >
      Go to bibliography
    </Link>
  );
}

export const GenerateCompletionButton: FC<GenerateCompletionButtonProps> = ({
  isRunning,
  onGenerate,
  eligibility,
  subjectId,
}) => {
  // ── Loading ──────────────────────────────────────────────────────────────────
  if (eligibility.kind === "loading") {
    return (
      <div
        style={{
          padding: "48px 0",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: 12,
        }}
      >
        <button className="btn btn-primary btn-lg" disabled>
          <Icon name="sync" size={14} />
          Checking sources…
        </button>
      </div>
    );
  }

  // ── Error checking eligibility ───────────────────────────────────────────────
  if (eligibility.kind === "error") {
    return (
      <div
        style={{
          padding: "48px 0",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: 8,
        }}
      >
        <button className="btn btn-primary btn-lg" disabled>
          Couldn't check sources
        </button>
        <p className="t-xs t-faint italic">Eligibility check failed.</p>
        <button className="btn btn-ghost btn-sm" onClick={eligibility.onRetry}>
          Retry
        </button>
      </div>
    );
  }

  // ── No bibliography at all ────────────────────────────────────────────────────
  if (eligibility.kind === "no_sources_loaded") {
    return (
      <div
        style={{
          padding: "48px 0",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: 8,
        }}
      >
        <button className="btn btn-primary btn-lg" disabled>
          Load a bibliography first
        </button>
        <p className="t-sm t-muted" style={{ maxWidth: 420, marginTop: 4 }}>
          This subject has no sources yet. Completions are only generated from sources
          you've uploaded.
        </p>
        <BibliographyLink subjectId={subjectId} />
      </div>
    );
  }

  // ── Sources still indexing ────────────────────────────────────────────────────
  if (eligibility.kind === "no_ready_sources") {
    const pending = eligibility.sourcesTotal - eligibility.sourcesReady;
    return (
      <div
        style={{
          padding: "48px 0",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: 8,
        }}
      >
        <button className="btn btn-primary btn-lg" disabled>
          <Icon name="sync" size={14} />
          Sources still processing
        </button>
        <p className="t-sm t-muted" style={{ maxWidth: 420, marginTop: 4 }}>
          {pending} source{pending !== 1 ? "s" : ""} still being indexed.
        </p>
        <BibliographyLink subjectId={subjectId} />
      </div>
    );
  }

  // ── No related chunks found ───────────────────────────────────────────────────
  if (eligibility.kind === "no_related_chunks") {
    const { topSimilarity, similarityFloor } = eligibility;
    // Show hint when top similarity is within 10 percentage points of the floor
    const showClosestHint =
      topSimilarity !== null && topSimilarity >= similarityFloor - 0.1;

    return (
      <div
        style={{
          padding: "48px 0",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: 8,
        }}
      >
        <button className="btn btn-primary btn-lg" disabled>
          No source supports this concept yet
        </button>
        <p className="t-sm t-muted" style={{ maxWidth: 420, marginTop: 4 }}>
          Your sources don't cover this concept above the similarity threshold.
        </p>
        {showClosestHint && (
          <p className="t-xs t-faint italic">
            Closest match: {Math.round(topSimilarity! * 100)}% similarity (need{" "}
            {Math.round(similarityFloor * 100)}%).
          </p>
        )}
        <Link
          to="/bibliography"
          search={{ subjectId }}
          className="btn btn-ghost btn-sm"
          style={{ textDecoration: "none", marginTop: 4, alignSelf: "flex-start" }}
        >
          Upload a related source
        </Link>
      </div>
    );
  }

  // ── Eligible (kind === "ok") ───────────────────────────────────────────────────
  return (
    <div
      style={{
        padding: "48px 0",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 12,
      }}
    >
      <p className="t-body t-muted" style={{ marginBottom: 8 }}>
        Generate a completion grounded in your bibliography.
      </p>
      <button
        className="btn btn-primary btn-lg"
        onClick={onGenerate}
        disabled={isRunning}
      >
        {isRunning ? (
          <>
            <Icon name="sync" size={14} />
            Generating…
          </>
        ) : (
          <>
            <Icon name="sparkle" size={14} />
            Generate completion
          </>
        )}
      </button>
    </div>
  );
};
