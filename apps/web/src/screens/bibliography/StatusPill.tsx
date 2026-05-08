import type { FC } from "react";
import type { SourceStatus } from "../../api/sources";

interface StatusPillProps {
  status: SourceStatus;
  failureReason?: string | null;
}

function pillClass(status: SourceStatus): string {
  switch (status) {
    case "ready":
      return "cov-pill green";
    case "uploading":
    case "chunking":
    case "embedded":
      return "cov-pill neutral";
    case "partial":
      return "cov-pill amber";
    case "failed":
      return "cov-pill red";
    default:
      return "cov-pill neutral";
  }
}

function pillLabel(status: SourceStatus): string {
  switch (status) {
    case "ready":
      return "indexed";
    case "uploading":
      return "uploading";
    case "chunking":
      return "chunking";
    case "embedded":
      return "embedding";
    case "partial":
      return "partial";
    case "failed":
      return "failed";
    default:
      return status;
  }
}

export const StatusPill: FC<StatusPillProps> = ({ status, failureReason }) => (
  <span
    className={pillClass(status)}
    title={failureReason ?? undefined}
    style={{ cursor: failureReason ? "help" : undefined }}
  >
    {pillLabel(status)}
  </span>
);
