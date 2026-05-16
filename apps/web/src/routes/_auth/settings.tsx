import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useConnections, useDisconnect } from "../../api/connections";
import { useActiveMapping, useAvailableSubjects, useSyncSubjects, type AvailableSubject } from "../../api/mappings";

export const Route = createFileRoute("/_auth/settings")({
  component: SettingsPage,
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatRelativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ─── Small spinner ────────────────────────────────────────────────────────────

function Spinner({ size = 14 }: { size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        border: `${size <= 12 ? 1.5 : 2}px solid var(--fg-whisper)`,
        borderTopColor: "var(--accent-soft)",
        borderRadius: "50%",
        animation: "settings-spin 0.8s linear infinite",
        flexShrink: 0,
      }}
      aria-hidden="true"
    />
  );
}

// ─── Subject checkbox ─────────────────────────────────────────────────────────

function SubjectCheckbox({
  checked,
  onChange,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  id: string;
}) {
  return (
    <div
      role="checkbox"
      aria-checked={checked}
      id={id}
      tabIndex={0}
      onClick={() => onChange(!checked)}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          onChange(!checked);
        }
      }}
      style={{
        width: 16,
        height: 16,
        borderRadius: 3,
        background: checked ? "var(--green-tint)" : "transparent",
        boxShadow: checked
          ? "none"
          : "inset 0 0 0 1px var(--fg-whisper)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        flexShrink: 0,
        transition: "background 120ms, box-shadow 120ms",
      }}
    >
      {checked && (
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="var(--green-fg)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="1.5,5 4,7.5 8.5,2" />
        </svg>
      )}
    </div>
  );
}

// ─── Manage Subjects overlay panel ───────────────────────────────────────────

interface ManageSubjectsPanelProps {
  connectionId: string;
  mappingId: string;
  workspaceName: string;
  onClose: () => void;
}

function ManageSubjectsPanel({
  connectionId,
  mappingId,
  workspaceName,
  onClose,
}: ManageSubjectsPanelProps) {
  const availableSubjects = useAvailableSubjects(connectionId, mappingId);
  const syncSubjects = useSyncSubjects(connectionId, mappingId);
  const panelRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const subjects: AvailableSubject[] = availableSubjects.data?.subjects ?? [];

  // Initialize from tracked subjects
  useEffect(() => {
    if (!availableSubjects.data || selected !== null) return;
    const trackedIds = subjects.filter((s) => s.tracked).map((s) => s.externalId);
    setSelected(new Set(trackedIds));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableSubjects.data]);

  // Focus panel on mount
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  // Esc key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const effectiveSelected = selected ?? new Set<string>();
  const trackedCount = subjects.filter((s) => s.tracked).length;
  const newCount = [...effectiveSelected].filter(
    (id) => !subjects.find((s) => s.externalId === id)?.tracked,
  ).length;
  const removedCount = subjects.filter(
    (s) => s.tracked && !effectiveSelected.has(s.externalId),
  ).length;

  const handleToggle = (externalId: string) => {
    setSelected((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(externalId)) next.delete(externalId);
      else next.add(externalId);
      return next;
    });
    setSaveSuccess(false);
  };

  const handleSave = async () => {
    setSyncError(null);
    try {
      await syncSubjects.mutateAsync({
        externalIds: [...effectiveSelected],
        kickIngest: true,
      });
      setSaveSuccess(true);
      setTimeout(onClose, 800);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Failed to save changes.");
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.55)",
          zIndex: 300,
        }}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`Manage subjects from ${workspaceName}`}
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: 480,
          background: "var(--base)",
          border: "1px solid var(--line-strong)",
          borderRight: "none",
          zIndex: 301,
          display: "flex",
          flexDirection: "column",
          outline: "none",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "18px 24px",
            borderBottom: "1px solid var(--line)",
            flexShrink: 0,
          }}
        >
          <div style={{ flex: 1 }}>
            <div className="cap-sm" style={{ color: "var(--fg-faint)", marginBottom: 2 }}>
              Subjects
            </div>
            <h2 className="hh-3 serif" style={{ margin: 0 }}>
              {workspaceName}
            </h2>
          </div>
          <button
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            aria-label="Close"
            style={{ flexShrink: 0 }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <line x1="2" y1="2" x2="12" y2="12" />
              <line x1="12" y1="2" x2="2" y2="12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
          {availableSubjects.isLoading && (
            <div className="t-sm t-muted" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Spinner />
              Loading subjects…
            </div>
          )}

          {availableSubjects.isError && (
            <div
              role="alert"
              style={{
                padding: "12px 14px",
                background: "var(--red-tint)",
                border: "1px solid var(--accent-deep)",
                borderRadius: 4,
                fontSize: 13,
                color: "var(--red-fg)",
              }}
            >
              {availableSubjects.error.message}
            </div>
          )}

          {availableSubjects.data && subjects.length === 0 && (
            <div className="t-sm t-faint" style={{ lineHeight: 1.6 }}>
              No subjects found in this mapping. Check the mapping configuration.
            </div>
          )}

          {subjects.length > 0 && (
            <>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 10,
                }}
              >
                <span className="t-xs t-faint">
                  {effectiveSelected.size} of {subjects.length} selected
                </span>
                <span style={{ flex: 1 }} />
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  onClick={() => void availableSubjects.refetch()}
                  disabled={availableSubjects.isFetching}
                >
                  {availableSubjects.isFetching ? "Fetching…" : "Refresh"}
                </button>
              </div>

              <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
                {subjects.map((subject, i) => {
                  const isChecked = effectiveSelected.has(subject.externalId);
                  return (
                    <div
                      key={subject.externalId}
                      role="checkbox"
                      aria-checked={isChecked}
                      tabIndex={0}
                      onClick={() => handleToggle(subject.externalId)}
                      onKeyDown={(e) => {
                        if (e.key === " " || e.key === "Enter") {
                          e.preventDefault();
                          handleToggle(subject.externalId);
                        }
                      }}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "20px 1fr auto",
                        alignItems: "center",
                        gap: 12,
                        padding: "11px 14px",
                        borderBottom: i < subjects.length - 1 ? "1px solid var(--line)" : "none",
                        cursor: "pointer",
                        background: isChecked ? "rgba(77,139,106,0.04)" : "transparent",
                        transition: "background 100ms",
                      }}
                    >
                      <SubjectCheckbox
                        id={`msp-${subject.externalId}`}
                        checked={isChecked}
                        onChange={() => {}}
                      />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                          {subject.glyph && (
                            <span style={{ fontSize: 13, lineHeight: 1, flexShrink: 0 }} aria-hidden="true">
                              {subject.glyph}
                            </span>
                          )}
                          <span
                            className="serif"
                            style={{
                              fontSize: 13,
                              fontWeight: 500,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {subject.name}
                          </span>
                        </div>
                        {(subject.course ?? subject.term) && (
                          <div className="t-xs t-faint">
                            {[subject.course, subject.term].filter(Boolean).join(" · ")}
                          </div>
                        )}
                      </div>
                      <div style={{ flexShrink: 0 }}>
                        {subject.tracked && (
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              padding: "2px 7px",
                              background: "var(--elevated)",
                              border: "1px solid var(--line-strong)",
                              borderRadius: 999,
                              fontSize: 10,
                              color: "var(--fg-muted)",
                              fontFamily: "var(--mono)",
                              letterSpacing: "0.04em",
                            }}
                          >
                            tracked
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "16px 24px",
            borderTop: "1px solid var(--line)",
            flexShrink: 0,
          }}
        >
          {/* Summary */}
          {(newCount > 0 || removedCount > 0) && (
            <div
              style={{
                padding: "10px 14px",
                background: removedCount > 0 ? "var(--amber-tint)" : "var(--elevated)",
                border: `1px solid ${removedCount > 0 ? "var(--amber)" : "var(--line)"}`,
                borderRadius: 4,
                marginBottom: 14,
                fontSize: 12.5,
                lineHeight: 1.5,
                color: removedCount > 0 ? "var(--amber-fg)" : "var(--fg-muted)",
              }}
              role="status"
            >
              {newCount > 0 && (
                <div>
                  <strong style={{ color: "var(--fg)" }}>{newCount} new</strong> subject{newCount !== 1 ? "s" : ""} will be ingested.
                </div>
              )}
              {removedCount > 0 && (
                <div style={{ marginTop: newCount > 0 ? 4 : 0 }}>
                  <strong style={{ color: "var(--amber-fg)" }}>{removedCount}</strong> subject{removedCount !== 1 ? "s" : ""} will be{" "}
                  <strong>permanently removed with all their data</strong> (audits, gaps, embeddings).
                </div>
              )}
            </div>
          )}

          {syncError && (
            <div
              role="alert"
              style={{
                marginBottom: 12,
                padding: "10px 12px",
                background: "var(--red-tint)",
                border: "1px solid var(--accent-deep)",
                borderRadius: 4,
                fontSize: 12.5,
                color: "var(--red-fg)",
              }}
            >
              {syncError}
            </div>
          )}

          {saveSuccess && (
            <div
              role="status"
              style={{
                marginBottom: 12,
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 12.5,
                color: "var(--green-fg)",
              }}
            >
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="1.5,6.5 5,10 11.5,3" />
              </svg>
              Changes saved.
            </div>
          )}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={syncSubjects.isPending}>
              Cancel
            </button>
            <button
              className="btn btn-primary btn-sm"
              disabled={
                syncSubjects.isPending ||
                subjects.length === 0 ||
                !availableSubjects.data
              }
              onClick={() => void handleSave()}
            >
              {syncSubjects.isPending ? (
                <><Spinner size={12} />Saving…</>
              ) : (
                "Save changes"
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Connection panel ─────────────────────────────────────────────────────────

interface ConnectionPanelProps {
  connectionId: string;
  workspaceName: string;
  workspaceIcon: string | null;
  status: string;
  createdAt: string;
}

function ConnectionPanel({
  connectionId,
  workspaceName,
  workspaceIcon,
  status,
  createdAt,
}: ConnectionPanelProps) {
  const navigate = useNavigate();
  const disconnect = useDisconnect(connectionId);
  const activeMapping = useActiveMapping(connectionId);
  const [showManageSubjects, setShowManageSubjects] = useState(false);

  const mappingId = activeMapping.data?.mapping?.id ?? null;
  const hasMapping = !!mappingId;

  const handleDisconnect = () => {
    if (
      !window.confirm(
        `Disconnect "${workspaceName}"? Existing ingested notes and audits are preserved, but new syncs will stop.`,
      )
    ) {
      return;
    }
    disconnect.mutate(undefined, {
      onError: (err) => {
        alert(`Disconnect failed: ${err.message}`);
      },
    });
  };

  return (
    <>
      <section className="panel" style={{ padding: "24px 28px", marginBottom: 18 }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            marginBottom: 16,
          }}
        >
          <h2 className="hh-3 serif" style={{ margin: 0 }}>
            Notion connection
          </h2>
          <span style={{ flex: 1 }} />
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {/* Manage subjects */}
            {hasMapping ? (
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setShowManageSubjects(true)}
              >
                Manage subjects
              </button>
            ) : (
              <a
                href={`/connect/done?connectionId=${connectionId}`}
                className="btn btn-secondary btn-sm"
                title="Set up a mapping first"
              >
                Manage subjects
              </a>
            )}
            <a
              href="/connect/start?source=notion"
              className="btn btn-secondary btn-sm"
            >
              Reconnect
            </a>
            <button
              className="btn btn-ghost btn-sm"
              onClick={handleDisconnect}
              disabled={disconnect.isPending}
            >
              {disconnect.isPending ? "Disconnecting…" : "Disconnect"}
            </button>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "200px 1fr",
            rowGap: 12,
            columnGap: 24,
          }}
        >
          <span className="t-sm t-muted">Workspace</span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {workspaceIcon && (
              <img
                src={workspaceIcon}
                alt=""
                style={{ width: 16, height: 16, borderRadius: 3 }}
              />
            )}
            <span className="t-sm">{workspaceName}</span>
          </div>

          <span className="t-sm t-muted">Status</span>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background:
                  status === "active" ? "var(--green-fg)" : "var(--fg-whisper)",
                flexShrink: 0,
              }}
              aria-hidden="true"
            />
            <span
              className="t-sm"
              style={{
                color: status === "active" ? "var(--green-fg)" : "var(--fg-muted)",
                textTransform: "capitalize",
              }}
            >
              {status}
            </span>
          </div>

          <span className="t-sm t-muted">Connected at</span>
          <span className="t-sm" title={createdAt}>
            {formatRelativeTime(createdAt)}
          </span>

          <span className="t-sm t-muted">Mapping</span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {activeMapping.isLoading ? (
              <span className="t-sm t-faint">Loading…</span>
            ) : hasMapping ? (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "2px 8px",
                  background: "var(--green-tint)",
                  border: "1px solid var(--green)",
                  borderRadius: 3,
                  fontSize: 11.5,
                  color: "var(--green-fg)",
                  fontFamily: "var(--mono)",
                }}
              >
                active
              </span>
            ) : (
              <a
                href={`/connect/done?connectionId=${connectionId}`}
                className="t-sm"
                style={{ color: "var(--accent-soft)", textDecoration: "none" }}
              >
                Set up mapping →
              </a>
            )}
          </div>
        </div>
      </section>

      {showManageSubjects && mappingId && (
        <ManageSubjectsPanel
          connectionId={connectionId}
          mappingId={mappingId}
          workspaceName={workspaceName}
          onClose={() => setShowManageSubjects(false)}
        />
      )}
    </>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyConnectionState() {
  return (
    <section className="panel" style={{ padding: "32px 28px", marginBottom: 18 }}>
      <h2 className="hh-3 serif" style={{ marginBottom: 10, margin: "0 0 10px" }}>
        No connections yet
      </h2>
      <p
        className="t-sm t-muted"
        style={{ marginBottom: 20, lineHeight: 1.6, maxWidth: 460 }}
      >
        Connect a knowledge source to start auditing your notes against your
        syllabus.
      </p>
      <a href="/connect/start?source=notion" className="btn btn-primary btn-sm">
        Connect Notion
      </a>
    </section>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

function SettingsPage() {
  const connections = useConnections();

  return (
    <div
      style={{
        maxWidth: 880,
        margin: "0 auto",
        padding: "48px 56px 80px",
      }}
    >
      <div className="cap" style={{ marginBottom: 8 }}>
        Settings
      </div>
      <h1 className="hh-1 serif" style={{ marginBottom: 32 }}>
        Account &amp; system preferences
      </h1>

      {connections.isLoading && (
        <div className="t-sm t-muted" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Spinner />
          Loading connections…
        </div>
      )}

      {!connections.isLoading &&
        (connections.data?.connections.length ?? 0) === 0 && (
          <EmptyConnectionState />
        )}

      {connections.data?.connections.map((c) => (
        <ConnectionPanel
          key={c.id}
          connectionId={c.id}
          workspaceName={c.workspaceName}
          workspaceIcon={c.workspaceIcon}
          status={c.status}
          createdAt={c.createdAt}
        />
      ))}

      <p
        className="t-sm t-faint serif italic"
        style={{ marginTop: 32, textAlign: "center" }}
      >
        Episteme · designed as a thinking instrument, not a productivity tool.
      </p>

      <style>{`
        @keyframes settings-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
