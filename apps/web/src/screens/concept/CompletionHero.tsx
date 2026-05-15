// CompletionHero — the hero block showing the suggested completion.
// Mirrors design/screen-concept.jsx lines 27–62.
// Buttons: Merge (no-op + toast per plan §1.6 D19), Edit before merging (stub), Reject (stub).
// TODO (plan §1.6 D19): when the backend adds write-back endpoints, replace the toast stubs
// with real mutations for merge/edit/reject.
import type { FC } from "react";
import type { CompletionLatestResponse } from "../../api/completion";
import { CitationLink } from "./CitationLink";
import { Icon } from "./primitives";

interface CitationMapEntry {
  index: number; // 1-based
  sourceId: string;
  sourceTitle: string;
  sourceAuthor: string | null;
  pagesLabel: string | null;
  chapterLabel: string | null;
}

interface CompletionHeroProps {
  completion: NonNullable<CompletionLatestResponse["completion"]>;
  citationMap: Map<string, CitationMapEntry>;
  onOpenCitation: (chunkId: string, sourceId: string) => void;
  unitName: string | null;
}

export const CompletionHero: FC<CompletionHeroProps> = ({
  completion,
  citationMap,
  onOpenCitation,
  unitName,
}) => {
  const paragraphs = completion.paragraphs ?? [];
  const sourceCount = citationMap.size;
  const wordCount = [completion.summary, ...paragraphs.map((p) => p.text)]
    .filter(Boolean)
    .join(" ")
    .split(/\s+/)
    .filter(Boolean).length;

  function handleMerge() {
    // Merging is local — copy the draft into your Notion page manually.
    // TODO (plan §1.6 D19): swap in real merge mutation when backend adds write-back endpoint.
    alert("Merging is local — copy the draft into your Notion page manually.");
  }

  function handleEditBeforeMerging() {
    // TODO (plan §1.6 D19): open edit modal when backend adds write-back endpoint.
    alert("Merging is local — copy the draft into your Notion page manually.");
  }

  function handleReject() {
    // TODO (plan §1.6 D19): call reject mutation when backend adds write-back endpoint.
    alert("Merging is local — copy the draft into your Notion page manually.");
  }

  return (
    <div
      style={{
        background: "var(--base)",
        border: "1px solid var(--line)",
        borderRadius: 8,
        padding: "28px 32px",
        marginBottom: 28,
        position: "relative",
      }}
    >
      {/* Accent left bar */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          background: "var(--accent)",
          borderRadius: "8px 0 0 8px",
        }}
      />

      {/* Header row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 14,
          flexWrap: "wrap",
          rowGap: 6,
        }}
      >
        <Icon name="sparkle" size={14} />
        <span className="cap" style={{ color: "var(--accent-soft)" }}>
          Suggested completion · grounded in {sourceCount} source{sourceCount !== 1 ? "s" : ""}
        </span>
        <span style={{ flex: 1, minWidth: 8 }} />
        <span className="t-sm t-faint" style={{ whiteSpace: "nowrap" }}>
          {paragraphs.length} paragraph{paragraphs.length !== 1 ? "s" : ""} · ~{wordCount} words
        </span>
      </div>

      {/* Summary (italic intro) */}
      {completion.summary && (
        <p
          className="t-read serif"
          style={{
            fontSize: 16.5,
            lineHeight: 1.7,
            color: "var(--fg-muted)",
            marginBottom: 18,
            fontStyle: "italic",
          }}
        >
          {completion.summary}
        </p>
      )}

      {/* Paragraphs with inline citation markers */}
      {paragraphs.map((p, i) => (
        <div
          key={i}
          style={{
            marginBottom: 14,
            display: "grid",
            gridTemplateColumns: "24px 1fr",
            gap: 0,
          }}
        >
          <span
            className="mono"
            style={{ color: "var(--accent-soft)", fontSize: 13, paddingTop: 2 }}
          >
            +
          </span>
          <p className="serif" style={{ fontSize: 16, lineHeight: 1.7, margin: 0 }}>
            {p.text}
            {p.sourceIds.map((chunkId) => {
              const entry = citationMap.get(chunkId);
              if (!entry) return null;
              return (
                <CitationLink
                  key={chunkId}
                  chunkId={chunkId}
                  citationIndex={entry.index}
                  citation={{
                    sourceId: entry.sourceId,
                    sourceTitle: entry.sourceTitle,
                    sourceAuthor: entry.sourceAuthor,
                    pagesLabel: entry.pagesLabel,
                    chapterLabel: entry.chapterLabel,
                  }}
                  onOpen={onOpenCitation}
                />
              );
            })}
          </p>
        </div>
      ))}

      {/* Action bar */}
      <div
        style={{
          display: "flex",
          gap: 8,
          marginTop: 24,
          paddingTop: 20,
          borderTop: "1px solid var(--line)",
          flexWrap: "wrap",
        }}
      >
        <button className="btn btn-primary btn-lg" onClick={handleMerge}>
          <Icon name="check" size={14} />
          Merge into {unitName ? `${unitName} note` : "note"}
        </button>
        <button className="btn btn-secondary" onClick={handleEditBeforeMerging}>
          Edit before merging
        </button>
        <button className="btn btn-ghost" onClick={handleReject}>
          Reject
        </button>
        <span style={{ flex: 1 }} />
        <span
          className="t-sm t-faint"
          style={{ display: "flex", alignItems: "center", gap: 6, alignSelf: "center" }}
        >
          <Icon name="info" size={13} /> Inserted as a separate block. Your prose is never
          overwritten.
        </span>
      </div>
    </div>
  );
};
