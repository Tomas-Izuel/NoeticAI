import type { FC } from "react";
import { Icon } from "./icons";
import { UploadPdfButton } from "./UploadPdfButton";
import { AddUrlForm } from "./AddUrlForm";

interface ToolbarRowProps {
  isUploadPending: boolean;
  isUrlPending: boolean;
  onPdfFile: (file: File) => void;
  onUrlSubmit: (url: string) => void;
}

export const ToolbarRow: FC<ToolbarRowProps> = ({
  isUploadPending,
  isUrlPending,
  onPdfFile,
  onUrlSubmit,
}) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 12,
      margin: "0 56px 16px",
    }}
  >
    {/* Search — rendered but not wired in v1 (§9 of plan) */}
    <div className="search" style={{ flex: 1, maxWidth: 340 }}>
      <Icon name="search" size={13} />
      <input placeholder="Search sources, authors…" disabled />
    </div>
    <span style={{ flex: 1 }} />
    <UploadPdfButton isPending={isUploadPending} onFile={onPdfFile} />
    <AddUrlForm isPending={isUrlPending} onSubmit={onUrlSubmit} />
  </div>
);
