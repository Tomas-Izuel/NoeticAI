// SyllabusTab — syllabus excerpt and learning objective.
// Reads from concept basics.
import type { FC } from "react";
import type { ConceptDetail } from "../../../api/concepts";

interface SyllabusTabProps {
  concept: ConceptDetail;
}

export const SyllabusTab: FC<SyllabusTabProps> = ({ concept }) => {
  const hasContent = concept.syllabusExcerpt || concept.learningObjective;

  if (!hasContent) {
    return (
      <div className="fade-in">
        <p className="t-body t-muted" style={{ fontStyle: "italic" }}>
          No syllabus excerpt available for this concept.
        </p>
      </div>
    );
  }

  const loPrefix = concept.learningObjective
    ? (concept.learningObjective.split("—")[0] ?? concept.learningObjective).trim()
    : "";

  return (
    <div
      className="fade-in panel"
      style={{ padding: "20px 24px", position: "relative" }}
    >
      {/* Accent left bar */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 2,
          background: "var(--accent)",
          borderRadius: "6px 0 0 6px",
        }}
      />
      {loPrefix && (
        <div className="cap" style={{ marginBottom: 10 }}>
          {loPrefix}
        </div>
      )}
      {concept.syllabusExcerpt && (
        <p className="t-read" style={{ fontSize: 15.5, lineHeight: 1.7 }}>
          {concept.syllabusExcerpt}
        </p>
      )}
      {concept.learningObjective && (
        <div className="t-sm t-faint italic" style={{ marginTop: 14 }}>
          {concept.learningObjective}
        </div>
      )}
    </div>
  );
};
