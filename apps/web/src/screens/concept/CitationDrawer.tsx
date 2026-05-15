// CitationDrawer — side panel showing the cited source chunk.
// Lazily fetches GET /api/sources/:sid/chunks/:chunkId when opened.
import { useEffect, useRef, type FC } from "react";
import { useQuery } from "@tanstack/react-query";
import { getChunk } from "../../api/completion";
import { Icon } from "./primitives";

export interface CitationDrawerState {
  open: boolean;
  chunkId: string | null;
  sourceId: string | null;
}

interface CitationDrawerProps {
  state: CitationDrawerState;
  onClose: () => void;
}

export const CitationDrawer: FC<CitationDrawerProps> = ({ state, onClose }) => {
  const drawerRef = useRef<HTMLDivElement>(null);

  const chunkQ = useQuery({
    queryKey: ["chunk", state.sourceId, state.chunkId],
    queryFn: () => getChunk(state.sourceId!, state.chunkId!),
    enabled: state.open && !!state.sourceId && !!state.chunkId,
    staleTime: 10 * 60 * 1000,
  });

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // Trap focus when opened
  useEffect(() => {
    if (state.open) {
      drawerRef.current?.focus();
    }
  }, [state.open]);

  if (!state.open) return null;

  const data = chunkQ.data;

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
        aria-label="Source citation detail"
        tabIndex={-1}
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: 480,
          background: "var(--base)",
          borderLeft: "1px solid var(--line-strong)",
          zIndex: 50,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          outline: "none",
        }}
      >
        {/* Header */}
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
              {data ? (
                <>
                  <h2
                    className="serif"
                    style={{ fontSize: 17, fontWeight: 400, margin: 0, lineHeight: 1.3 }}
                  >
                    {data.source.title}
                  </h2>
                  {data.source.author && (
                    <p className="t-sm t-faint" style={{ marginTop: 2, margin: "2px 0 0" }}>
                      {data.source.author}
                      {data.source.year ? ` (${data.source.year})` : ""}
                    </p>
                  )}
                </>
              ) : (
                <h2
                  className="serif"
                  style={{ fontSize: 17, fontWeight: 400, margin: 0, color: "var(--fg-faint)" }}
                >
                  {chunkQ.isLoading ? "Loading…" : "Source chunk"}
                </h2>
              )}
            </div>
            <button
              className="icon-btn"
              onClick={onClose}
              aria-label="Close citation drawer"
              style={{ flexShrink: 0, marginTop: 2 }}
            >
              <Icon name="x" size={16} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: "20px 24px 32px", flex: 1 }}>
          {chunkQ.isLoading && (
            <p className="t-sm t-faint" style={{ fontStyle: "italic" }}>
              Loading passage…
            </p>
          )}

          {chunkQ.isError && (
            <p className="t-sm" style={{ color: "var(--red-fg)" }}>
              Could not load chunk. Try again.
            </p>
          )}

          {data && (
            <>
              {/* Location metadata */}
              {(data.chunk.chapterLabel || data.chunk.pagesLabel) && (
                <div className="t-sm t-faint" style={{ marginBottom: 16 }}>
                  {[data.chunk.chapterLabel, data.chunk.pagesLabel && `pp. ${data.chunk.pagesLabel}`]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              )}

              {/* Previous chunk — faded context */}
              {data.surrounding.previous && (
                <div
                  style={{
                    padding: "10px 14px",
                    marginBottom: 8,
                    borderLeft: "2px solid var(--line-strong)",
                    opacity: 0.45,
                  }}
                >
                  {data.surrounding.previous.pagesLabel && (
                    <div className="cap-sm" style={{ marginBottom: 4 }}>
                      pp. {data.surrounding.previous.pagesLabel}
                    </div>
                  )}
                  <p
                    className="serif"
                    style={{ fontSize: 14, lineHeight: 1.65, color: "var(--fg-muted)", margin: 0 }}
                  >
                    {data.surrounding.previous.text}
                  </p>
                </div>
              )}

              {/* Main chunk — highlighted */}
              <div
                style={{
                  padding: "14px 18px",
                  background: "var(--elevated)",
                  border: "1px solid var(--line-strong)",
                  borderLeft: "3px solid var(--accent)",
                  borderRadius: 4,
                  marginBottom: 8,
                }}
              >
                <p
                  className="serif"
                  style={{ fontSize: 15, lineHeight: 1.7, color: "var(--fg)", margin: 0 }}
                >
                  {data.chunk.text}
                </p>
              </div>

              {/* Next chunk — faded context */}
              {data.surrounding.next && (
                <div
                  style={{
                    padding: "10px 14px",
                    marginTop: 8,
                    borderLeft: "2px solid var(--line-strong)",
                    opacity: 0.45,
                  }}
                >
                  {data.surrounding.next.pagesLabel && (
                    <div className="cap-sm" style={{ marginBottom: 4 }}>
                      pp. {data.surrounding.next.pagesLabel}
                    </div>
                  )}
                  <p
                    className="serif"
                    style={{ fontSize: 14, lineHeight: 1.65, color: "var(--fg-muted)", margin: 0 }}
                  >
                    {data.surrounding.next.text}
                  </p>
                </div>
              )}

              {/* Char count metadata */}
              <div className="t-sm t-faint" style={{ marginTop: 16 }}>
                <span className="mono">{data.chunk.charCount}</span> chars
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
};
