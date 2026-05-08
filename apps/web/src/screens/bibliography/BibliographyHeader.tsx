import type { FC } from "react";

interface BibliographyHeaderProps {
  subjectName: string;
}

export const BibliographyHeader: FC<BibliographyHeaderProps> = ({ subjectName }) => (
  <div style={{ padding: "40px 56px 0" }}>
    <div className="cap" style={{ marginBottom: 8 }}>
      Sources · {subjectName}
    </div>
    <h1
      className="serif"
      style={{
        fontSize: 36,
        lineHeight: 1.1,
        letterSpacing: "-0.02em",
        fontWeight: 400,
        marginBottom: 14,
      }}
    >
      Bibliography
    </h1>
    <p
      className="t-read t-muted"
      style={{ maxWidth: 680, fontSize: 15.5, marginBottom: 32, lineHeight: 1.6 }}
    >
      The corpus Episteme reads from when generating completions. Every suggested paragraph is
      grounded in passages from these sources — never paraphrased outside them.
    </p>
  </div>
);
