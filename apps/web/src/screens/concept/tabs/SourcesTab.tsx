// SourcesTab — bibliography sources used in the latest completion.
// Renders the citation map grouped by source, with citation indices matching the prose.
import type { FC } from "react";
import type { CompletionLatestResponse } from "../../../api/completion";
import { ConfBar } from "../primitives";

interface CitationMapEntry {
  index: number;
  sourceId: string;
  sourceTitle: string;
  sourceAuthor: string | null;
  sourceYear: number | null;
  pagesLabel: string | null;
  chapterLabel: string | null;
  similarity: number;
}

interface SourcesTabProps {
  citationMap: Map<string, CitationMapEntry>;
  completion: CompletionLatestResponse | null;
}

export const SourcesTab: FC<SourcesTabProps> = ({ citationMap, completion }) => {
  if (!completion?.completion || !completion.completion.paragraphs) {
    return (
      <div className="fade-in">
        <p className="t-body t-muted" style={{ fontStyle: "italic" }}>
          Generate a completion to see sources used.
        </p>
      </div>
    );
  }

  if (citationMap.size === 0) {
    return (
      <div className="fade-in">
        <p className="t-body t-muted" style={{ fontStyle: "italic" }}>
          No sources cited in this completion.
        </p>
      </div>
    );
  }

  // Group by sourceId preserving citationIndex order
  const bySource = new Map<
    string,
    { title: string; author: string | null; year: number | null; entries: CitationMapEntry[] }
  >();
  for (const entry of citationMap.values()) {
    const existing = bySource.get(entry.sourceId);
    if (existing) {
      existing.entries.push(entry);
    } else {
      bySource.set(entry.sourceId, {
        title: entry.sourceTitle,
        author: entry.sourceAuthor,
        year: entry.sourceYear,
        entries: [entry],
      });
    }
  }

  return (
    <div className="fade-in">
      <p className="t-body t-muted" style={{ marginBottom: 16 }}>
        The completion is grounded in these passages — nothing else.
      </p>
      {Array.from(bySource.values()).map((src, si) => (
        <div key={si} className="panel" style={{ padding: "16px 20px", marginBottom: 8 }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 14,
              flexWrap: "wrap",
            }}
          >
            <span className="serif" style={{ fontSize: 15.5 }}>
              {src.author ?? "Unknown"}{" "}
              <span className="italic t-muted">{src.title}</span>
            </span>
            {src.year && (
              <span className="t-sm t-faint mono">({src.year})</span>
            )}
            <span style={{ flex: 1, minWidth: 20 }} />
            <ConfBar
              value={src.entries[0]?.similarity ?? 0}
              color="var(--green)"
            />
            <span className="mono" style={{ fontSize: 11, color: "var(--fg-muted)" }}>
              {(src.entries[0]?.similarity ?? 0).toFixed(2)}
            </span>
          </div>
          {src.entries.map((e, ei) => (
            <div key={ei} className="t-sm t-faint" style={{ marginTop: ei === 0 ? 6 : 2 }}>
              [{e.index}]{e.chapterLabel ? ` ${e.chapterLabel}` : ""}
              {e.pagesLabel ? ` · pp. ${e.pagesLabel}` : ""}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};
