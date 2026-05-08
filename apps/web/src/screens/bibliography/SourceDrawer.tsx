import { useEffect, useRef, type FC } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getSource, deleteSource, reindexSource } from "../../api/sources";
import type { SourceListItem } from "../../api/sources";
import { StatusPill } from "./StatusPill";
import { RetrievalTestInput } from "./RetrievalTestInput";
import { Icon } from "./icons";

interface SourceDrawerProps {
  sourceId: string;
  subjectId: string;
  onClose: () => void;
}

export const SourceDrawer: FC<SourceDrawerProps> = ({ sourceId, subjectId, onClose }) => {
  const drawerRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();

  const detailQ = useQuery({
    queryKey: ["sources", "detail", sourceId],
    queryFn: () => getSource(sourceId),
    staleTime: 60_000,
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteSource(sourceId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["sources", "list", subjectId] });
      onClose();
    },
  });

  const reindexMutation = useMutation({
    mutationFn: () => reindexSource(sourceId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["sources", "list", subjectId] });
      void qc.invalidateQueries({ queryKey: ["sources", "detail", sourceId] });
    },
  });

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    drawerRef.current?.focus();
  }, []);

  const handleDelete = () => {
    if (window.confirm("Delete this source? All chunks and embeddings will be removed.")) {
      deleteMutation.mutate();
    }
  };

  const source: SourceListItem | undefined = detailQ.data?.source;
  const chunks = detailQ.data?.chunks ?? [];

  return (
    <>
      {/* Backdrop */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.55)",
          zIndex: 40,
        }}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label={source ? `Source detail: ${source.title}` : "Source detail"}
        tabIndex={-1}
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: 520,
          background: "var(--base)",
          borderLeft: "1px solid var(--line-strong)",
          zIndex: 50,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          outline: "none",
        }}
      >
        {/* Sticky header */}
        <div
          style={{
            padding: "20px 24px 16px",
            borderBottom: "1px solid var(--line)",
            position: "sticky",
            top: 0,
            background: "var(--base)",
            zIndex: 1,
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              {source ? (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <StatusPill status={source.status} failureReason={source.failureReason} />
                    <span className="t-xs t-faint mono">{source.kind}</span>
                  </div>
                  <h2
                    className="serif"
                    style={{ fontSize: 20, fontWeight: 400, margin: 0, lineHeight: 1.25 }}
                  >
                    <span className="italic">{source.title}</span>
                  </h2>
                  {source.author && (
                    <p className="t-sm t-faint" style={{ margin: "4px 0 0" }}>
                      {source.author}
                      {source.year ? ` · ${source.year}` : ""}
                    </p>
                  )}
                </>
              ) : (
                <div style={{ height: 48, background: "var(--elevated)", borderRadius: 4 }} />
              )}
            </div>
            <button
              className="icon-btn"
              onClick={onClose}
              aria-label="Close drawer"
              style={{ flexShrink: 0, marginTop: 2 }}
            >
              <Icon name="x" size={16} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: "20px 24px 32px", flex: 1 }}>
          {detailQ.isLoading && (
            <p className="t-sm t-faint">Loading…</p>
          )}

          {detailQ.isError && (
            <p className="t-sm" style={{ color: "var(--red-fg)" }}>
              Failed to load source detail.
            </p>
          )}

          {source && (
            <>
              {/* Metadata grid */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr 1fr",
                  gap: 1,
                  background: "var(--line)",
                  marginBottom: 24,
                }}
              >
                {[
                  {
                    label: "Chunks",
                    value: String(source.chunkCount),
                  },
                  {
                    label: "Pages",
                    value: source.pageCount ? String(source.pageCount) : "—",
                  },
                  {
                    label: "Bytes",
                    value: source.byteCount
                      ? `${Math.round(source.byteCount / 1024)} KB`
                      : "—",
                  },
                  {
                    label: "Status",
                    value: source.status,
                  },
                ].map((item) => (
                  <div key={item.label} style={{ padding: "8px 10px", background: "var(--base)" }}>
                    <div className="cap-sm" style={{ marginBottom: 4 }}>
                      {item.label}
                    </div>
                    {item.label === "Status" ? (
                      <StatusPill status={source.status} failureReason={source.failureReason} />
                    ) : (
                      <div
                        className="serif"
                        style={{ fontSize: 18, lineHeight: 1, color: "var(--fg)", fontWeight: 400 }}
                      >
                        {item.value}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Failure reason */}
              {source.failureReason && (
                <div
                  role="alert"
                  style={{
                    padding: "10px 14px",
                    background: "var(--red-tint)",
                    border: "1px solid var(--red)",
                    borderRadius: 4,
                    marginBottom: 20,
                  }}
                >
                  <p className="t-sm" style={{ color: "var(--red-fg)", margin: 0 }}>
                    <strong style={{ color: "var(--fg)" }}>Failure reason:</strong>{" "}
                    {source.failureReason}
                  </p>
                </div>
              )}

              {/* Chunk previews */}
              {chunks.length > 0 && (
                <div style={{ marginBottom: 28 }}>
                  <div className="cap" style={{ marginBottom: 10 }}>
                    Chunk previews
                    {detailQ.data && source.chunkCount > chunks.length && (
                      <span className="t-xs t-faint" style={{ marginLeft: 8, textTransform: "none", letterSpacing: 0 }}>
                        Showing {chunks.length} of {source.chunkCount}
                      </span>
                    )}
                  </div>
                  {chunks.map((chunk) => (
                    <div
                      key={chunk.position}
                      style={{
                        padding: "10px 12px",
                        background: "var(--elevated)",
                        borderRadius: 4,
                        marginBottom: 6,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          marginBottom: 5,
                        }}
                      >
                        <span
                          className="mono"
                          style={{ fontSize: 10, color: "var(--fg-faint)" }}
                        >
                          #{chunk.position + 1}
                        </span>
                        {chunk.pagesLabel && (
                          <span className="t-xs t-faint">{chunk.pagesLabel}</span>
                        )}
                        <span
                          className="mono"
                          style={{ fontSize: 10, color: "var(--fg-faint)", marginLeft: "auto" }}
                        >
                          {chunk.charCount} chars
                        </span>
                      </div>
                      <p
                        style={{
                          fontSize: 12,
                          lineHeight: 1.5,
                          color: "var(--fg-muted)",
                          margin: 0,
                          fontStyle: "italic",
                        }}
                      >
                        {chunk.textPreview}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {/* Retrieval test */}
              {source.status === "ready" && (
                <div style={{ marginBottom: 28 }}>
                  <RetrievalTestInput subjectId={subjectId} />
                </div>
              )}

              {/* Footer actions */}
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  paddingTop: 16,
                  borderTop: "1px solid var(--line)",
                }}
              >
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => reindexMutation.mutate()}
                  disabled={reindexMutation.isPending}
                >
                  <Icon name="sync" size={12} />
                  {reindexMutation.isPending ? " Re-indexing…" : " Re-index"}
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={handleDelete}
                  disabled={deleteMutation.isPending}
                  style={{ marginLeft: "auto", color: "var(--red-fg)" }}
                >
                  <Icon name="trash" size={12} />
                  {" "}Delete
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
};
