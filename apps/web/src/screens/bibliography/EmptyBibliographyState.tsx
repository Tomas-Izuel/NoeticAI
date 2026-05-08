import type { FC } from "react";
import { Icon } from "./icons";
import { UploadPdfButton } from "./UploadPdfButton";
import { AddUrlForm } from "./AddUrlForm";

interface EmptyBibliographyStateProps {
  isUploadPending: boolean;
  isUrlPending: boolean;
  onPdfFile: (file: File) => void;
  onUrlSubmit: (url: string) => void;
}

export const EmptyBibliographyState: FC<EmptyBibliographyStateProps> = ({
  isUploadPending,
  isUrlPending,
  onPdfFile,
  onUrlSubmit,
}) => (
  <div
    style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "80px 56px",
      textAlign: "center",
    }}
  >
    <div
      style={{
        width: 48,
        height: 48,
        borderRadius: 8,
        background: "var(--elevated)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        marginBottom: 24,
        color: "var(--fg-muted)",
      }}
    >
      <Icon name="book" size={22} />
    </div>
    <h2
      className="serif"
      style={{ fontSize: 22, fontWeight: 400, marginBottom: 8, color: "var(--fg)" }}
    >
      No sources yet
    </h2>
    <p
      className="t-muted"
      style={{ maxWidth: 400, lineHeight: 1.6, marginBottom: 28, fontSize: 14 }}
    >
      Add PDFs or URLs to build the corpus. Episteme will chunk and index them — every completion
      is grounded in passages from these sources.
    </p>
    <div style={{ display: "flex", gap: 10 }}>
      <UploadPdfButton isPending={isUploadPending} onFile={onPdfFile} />
      <AddUrlForm isPending={isUrlPending} onSubmit={onUrlSubmit} />
    </div>
  </div>
);
