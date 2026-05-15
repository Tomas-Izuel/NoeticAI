// CitationLink — inline superscript [N] chip. Hover shows abbreviated source.
// On click, opens the CitationDrawer for the full chunk.
import type { FC } from "react";

interface CitationInfo {
  sourceId: string;
  sourceTitle: string;
  sourceAuthor: string | null;
  pagesLabel: string | null;
  chapterLabel: string | null;
}

interface CitationLinkProps {
  chunkId: string;
  citationIndex: number; // 1-based
  citation: CitationInfo;
  onOpen: (chunkId: string, sourceId: string) => void;
}

export const CitationLink: FC<CitationLinkProps> = ({
  chunkId,
  citationIndex,
  citation,
  onOpen,
}) => {
  const label =
    citation.sourceAuthor
      ? `${citation.sourceAuthor} — ${citation.sourceTitle}${citation.pagesLabel ? `, pp. ${citation.pagesLabel}` : ""}`
      : `${citation.sourceTitle}${citation.pagesLabel ? `, pp. ${citation.pagesLabel}` : ""}`;

  return (
    <sup
      className="citation-link"
      onClick={() => onOpen(chunkId, citation.sourceId)}
      title={label}
      role="button"
      tabIndex={0}
      aria-label={`Citation ${citationIndex}: ${label}`}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(chunkId, citation.sourceId);
        }
      }}
      style={{
        cursor: "pointer",
        fontFamily: "var(--mono)",
        fontSize: 11,
        color: "var(--accent-soft)",
        background: "var(--accent-tint)",
        padding: "1px 4px",
        borderRadius: 3,
        marginLeft: 2,
        userSelect: "none",
      }}
    >
      [{citationIndex}]
    </sup>
  );
};
