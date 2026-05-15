// DetailTabs — four-tab strip (reasoning, evidence, sources, syllabus).
// Mirrors design/screen-concept.jsx lines 64–143.
import type { FC } from "react";
import type { ConceptDetail } from "../../api/concepts";
import type { CompletionLatestResponse } from "../../api/completion";
import { ReasoningTab } from "./tabs/ReasoningTab";
import { EvidenceTab } from "./tabs/EvidenceTab";
import { SourcesTab } from "./tabs/SourcesTab";
import { SyllabusTab } from "./tabs/SyllabusTab";

export type TabId = "reasoning" | "evidence" | "sources" | "syllabus";

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

interface DetailTabsProps {
  tab: TabId;
  onTabChange: (id: TabId) => void;
  concept: ConceptDetail;
  latestCompletion: CompletionLatestResponse | null;
  citationMap: Map<string, CitationMapEntry>;
}

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "reasoning", label: "Why this is missing" },
  { id: "evidence", label: "What you wrote" },
  { id: "sources", label: "Sources used" },
  { id: "syllabus", label: "Syllabus context" },
];

export const DetailTabs: FC<DetailTabsProps> = ({
  tab,
  onTabChange,
  concept,
  latestCompletion,
  citationMap,
}) => {
  const runId = concept.latestRun?.id ?? null;
  const fragmentCount = 0; // derived from audit run — shown in Evidence tab header
  const sourceCount = citationMap.size;

  return (
    <>
      {/* Tab strip */}
      <div
        style={{
          display: "flex",
          gap: 0,
          borderBottom: "1px solid var(--line)",
          marginBottom: 20,
        }}
      >
        {TABS.map((t) => {
          const badge =
            t.id === "evidence"
              ? fragmentCount > 0
                ? fragmentCount
                : null
              : t.id === "sources"
                ? sourceCount > 0
                  ? sourceCount
                  : null
                : null;
          return (
            <button
              key={t.id}
              onClick={() => onTabChange(t.id)}
              className={`detail-tab ${tab === t.id ? "active" : ""}`}
            >
              {t.label}
              {badge != null && (
                <span className="mono" style={{ color: "var(--fg-faint)", fontSize: 11 }}>
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {tab === "reasoning" && (
        <ReasoningTab
          runId={runId}
          conceptId={concept.id}
          concept={concept}
          latestCompletion={latestCompletion}
        />
      )}
      {tab === "evidence" && (
        <EvidenceTab runId={runId} conceptId={concept.id} />
      )}
      {tab === "sources" && (
        <SourcesTab citationMap={citationMap} completion={latestCompletion} />
      )}
      {tab === "syllabus" && <SyllabusTab concept={concept} />}
    </>
  );
};
