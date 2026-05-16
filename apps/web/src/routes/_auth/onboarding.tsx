import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAsyncJob } from "../../lib/useAsyncJob";
import {
  uploadSyllabus,
  getDraft,
  confirmCurriculum,
  getActiveSyllabus,
  type CurriculumDraft,
  type ConfirmEdits,
  type DraftConcept,
  type DraftUnit,
} from "../../api/syllabus";
import { useConnections } from "../../api/connections";
import { useActiveMapping, useAvailableSubjects } from "../../api/mappings";
import { useActiveSubject } from "../../lib/useActiveSubject";

export const Route = createFileRoute("/_auth/onboarding")({
  component: OnboardingPage,
});

// ─── Types ────────────────────────────────────────────────────────────────────

// Phase 0 (connect) is prepended to the existing upload → extracting → review
// → confirming flow. The existing step numbers shift by +1 (upload is now step
// 2) and total steps become 4.
type Phase =
  | { kind: "connect" }
  | { kind: "upload" }
  | { kind: "extracting"; syllabusId: string; jobId: string }
  | { kind: "review"; syllabusId: string; draft: CurriculumDraft }
  | { kind: "confirming"; syllabusId: string; draft: CurriculumDraft };

// ─── Inline-edit primitive ────────────────────────────────────────────────────

interface EditableTitleProps {
  value: string;
  onChange: (v: string) => void;
  level: "subject" | "unit" | "concept";
}

function EditableTitle({ value, onChange, level }: EditableTitleProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  const startEditing = () => {
    setDraft(value);
    setEditing(true);
    // Focus on the next tick after state update renders the input
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) onChange(trimmed);
    setEditing(false);
  };

  const cancel = () => {
    setDraft(value);
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); commit(); }
    if (e.key === "Escape") { cancel(); }
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="input"
        style={{
          fontFamily: "var(--serif)",
          fontSize: level === "subject" ? 20 : level === "unit" ? 16 : 14,
          fontWeight: 400,
          height: level === "concept" ? 28 : 32,
          letterSpacing: level === "subject" ? "-0.012em" : undefined,
        }}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        autoFocus
      />
    );
  }

  if (level === "subject") {
    return (
      <h2
        className="serif"
        style={{
          fontSize: 20, fontWeight: 400, margin: 0, letterSpacing: "-0.012em",
          cursor: "text", color: "var(--fg)",
        }}
        onDoubleClick={startEditing}
        title="Doble clic para editar"
      >
        {value}
        <span
          className="t-xs t-faint"
          style={{ marginLeft: 8, fontFamily: "var(--sans)", letterSpacing: 0 }}
        >
          (doble clic para editar)
        </span>
      </h2>
    );
  }

  if (level === "unit") {
    return (
      <h3
        className="serif"
        style={{
          fontSize: 15, fontWeight: 500, margin: 0, letterSpacing: "-0.005em",
          cursor: "text", color: "var(--fg)",
        }}
        onDoubleClick={startEditing}
        title="Doble clic para editar"
      >
        {value}
      </h3>
    );
  }

  // concept
  return (
    <div
      style={{ fontSize: 13, color: "var(--fg)", cursor: "text" }}
      onDoubleClick={startEditing}
      title="Doble clic para editar"
    >
      {value}
    </div>
  );
}

// ─── Step indicator ───────────────────────────────────────────────────────────

// Total steps is now 4: connect (1) → upload (2) → extracting (3) → review (4)
function StepIndicator({ currentStep }: { currentStep: 1 | 2 | 3 | 4 }) {
  const totalSteps = 4;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 40 }}>
      <div className="cap">Setup · Programa de estudios</div>
      <div style={{ flex: 1, height: 1, background: "var(--line)" }} />
      <div style={{ display: "flex", gap: 6 }}>
        {[1, 2, 3, 4].map((s) => (
          <div
            key={s}
            style={{
              width: 24,
              height: 3,
              background: s <= currentStep ? "var(--accent)" : "var(--fg-whisper)",
              borderRadius: 2,
            }}
          />
        ))}
      </div>
      <div className="cap t-faint">
        {currentStep} de {totalSteps}
      </div>
    </div>
  );
}

// ─── Phase 0: Connect Notion ──────────────────────────────────────────────────

// Shown when the user has no active connection. Three branches:
//   1. No connection at all → hero "Connect Notion" CTA.
//   2. Connection exists but no active mapping → "Continue setup" to the wizard.
//   3. Connection + active mapping → advance directly to upload (caller handles).
interface ConnectPhaseProps {
  onProceed: () => void;
}

function ConnectPhase({ onProceed }: ConnectPhaseProps) {
  const connections = useConnections();
  const firstConnection = connections.data?.connections[0] ?? null;
  const activeMapping = useActiveMapping(firstConnection?.id ?? null);
  const mappingId = activeMapping.data?.mapping?.id ?? null;

  // Fetch available subjects only when a mapping exists, to determine whether
  // the user has already tracked at least one subject.
  const availableSubjectsQuery = useAvailableSubjects(
    firstConnection?.id ?? null,
    mappingId,
  );

  const trackedCount =
    availableSubjectsQuery.data?.subjects.filter((s) => s.tracked).length ?? 0;

  const readyToAdvance =
    !connections.isLoading &&
    !activeMapping.isLoading &&
    !!firstConnection &&
    !!activeMapping.data?.mapping &&
    !availableSubjectsQuery.isLoading &&
    trackedCount > 0;

  // Once all queries settle with a tracked subject, skip to upload
  useEffect(() => {
    if (readyToAdvance) {
      onProceed();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readyToAdvance]);

  if (connections.isLoading) {
    return (
      <div className="t-sm t-muted" style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div
          style={{
            width: 14,
            height: 14,
            border: "2px solid var(--fg-whisper)",
            borderTopColor: "var(--accent-soft)",
            borderRadius: "50%",
            animation: "pulse 0.8s linear infinite",
          }}
          aria-hidden="true"
        />
        Checking connection…
      </div>
    );
  }

  // Branch: has connection + mapping, but no tracked subjects yet.
  // Guard against error: if subjects query errored, fall through to the
  // upload phase (safe default — user can upload a syllabus manually).
  if (
    firstConnection &&
    activeMapping.data?.mapping &&
    !availableSubjectsQuery.isLoading &&
    !availableSubjectsQuery.isError &&
    trackedCount === 0
  ) {
    return (
      <div className="fade-in">
        <h1 className="hh-1 serif" style={{ marginBottom: 14, maxWidth: 680 }}>
          You&apos;re connected to Notion.{" "}
          <span className="italic t-muted">Pick the subjects you want to track.</span>
        </h1>
        <p
          className="t-read t-muted"
          style={{ maxWidth: 600, fontSize: 15.5, marginBottom: 32 }}
        >
          Your workspace{" "}
          <strong style={{ color: "var(--fg)" }}>{firstConnection.workspaceName}</strong>{" "}
          is mapped, but no subjects are being tracked yet. Select the subjects
          Episteme should audit.
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <a
            href={`/connect/done?connectionId=${firstConnection.id}&mappingId=${mappingId}&step=3`}
            className="btn btn-primary"
          >
            Pick subjects
            <svg
              width="13"
              height="13"
              viewBox="0 0 13 13"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="2,6.5 11,6.5" />
              <polyline points="7,2.5 11,6.5 7,10.5" />
            </svg>
          </a>
        </div>
      </div>
    );
  }

  // Branch: has connection but no mapping → show "Continue setup" link
  if (firstConnection && !activeMapping.data?.mapping && !activeMapping.isLoading) {
    return (
      <div className="fade-in">
        <h1 className="hh-1 serif" style={{ marginBottom: 14, maxWidth: 680 }}>
          Notion connected.{" "}
          <span className="italic t-muted">
            Finish mapping your workspace.
          </span>
        </h1>
        <p
          className="t-read t-muted"
          style={{ maxWidth: 600, fontSize: 15.5, marginBottom: 32 }}
        >
          Your Notion workspace{" "}
          <strong style={{ color: "var(--fg)" }}>
            {firstConnection.workspaceName}
          </strong>{" "}
          is connected but hasn&apos;t been mapped to a subject yet. Continue
          the setup to tell Episteme how your workspace is organised.
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <a
            href={`/connect/done?connectionId=${firstConnection.id}`}
            className="btn btn-primary"
          >
            Continue setup
            <svg
              width="13"
              height="13"
              viewBox="0 0 13 13"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="2,6.5 11,6.5" />
              <polyline points="7,2.5 11,6.5 7,10.5" />
            </svg>
          </a>
        </div>
      </div>
    );
  }

  // Branch: no connection → hero CTA
  return (
    <div className="fade-in">
      <h1 className="hh-1 serif" style={{ marginBottom: 14, maxWidth: 680 }}>
        Connect your Notion.{" "}
        <span className="italic t-muted">
          Where your notes live.
        </span>
      </h1>
      <p
        className="t-read t-muted"
        style={{ maxWidth: 600, fontSize: 15.5, marginBottom: 32 }}
      >
        Episteme reads your notes directly from Notion. Connect your workspace
        to start: we&apos;ll detect your subjects, units, and pages — then
        audit coverage against your syllabus.
      </p>

      <div
        className="panel"
        style={{
          padding: "24px 28px",
          maxWidth: 440,
          marginBottom: 32,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          {[
            "Read-only access — Episteme never writes to Notion.",
            "Works with databases, pages, and hierarchies.",
            "Re-syncs on demand; you control when notes refresh.",
          ].map((line) => (
            <div
              key={line}
              style={{ display: "flex", alignItems: "flex-start", gap: 10 }}
            >
              <div
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: "50%",
                  background: "var(--green-tint)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  marginTop: 1,
                }}
                aria-hidden="true"
              >
                <svg
                  width="8"
                  height="8"
                  viewBox="0 0 8 8"
                  fill="none"
                  stroke="var(--green-fg)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="1,4 3,6.5 7,1.5" />
                </svg>
              </div>
              <span className="t-sm">{line}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <a
          href="/connect/start?source=notion&redirect=/onboarding"
          className="btn btn-primary btn-lg"
        >
          Connect Notion
          <svg
            width="13"
            height="13"
            viewBox="0 0 13 13"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="2,6.5 11,6.5" />
            <polyline points="7,2.5 11,6.5 7,10.5" />
          </svg>
        </a>
        <button
          className="btn btn-ghost"
          onClick={onProceed}
          title="Skip if you've already set up via the stub connector"
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}

// ─── Drop zone (State A) ──────────────────────────────────────────────────────

interface UploadPhaseProps {
  onUploaded: (syllabusId: string, jobId: string) => void;
}

function UploadPhase({ onUploaded }: UploadPhaseProps) {
  const [dragOver, setDragOver] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [showReplace, setShowReplace] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { activeSubjectId, activeSubject, isLoading: subjectsLoading } = useActiveSubject();

  // Loaded-syllabus check: if the active subject already has an active
  // syllabus, render a summary instead of the upload form (the user can
  // still click "Replace" to upload a new version).
  const activeSyllabusQ = useQuery({
    queryKey: ["syllabus", "active", activeSubjectId],
    queryFn: () => getActiveSyllabus(activeSubjectId!),
    enabled: !!activeSubjectId,
    staleTime: 30 * 1000,
  });
  const loadedSyllabus = activeSyllabusQ.data?.syllabus ?? null;

  // Fallback connection/mapping info for the "no subject" recovery link.
  const connections = useConnections();
  const firstConnection = connections.data?.connections[0] ?? null;
  const activeMapping = useActiveMapping(firstConnection?.id ?? null);
  const mappingId = activeMapping.data?.mapping?.id ?? null;

  const upload = useMutation({
    mutationFn: ({ file, subjectId }: { file: File; subjectId: string }) =>
      uploadSyllabus(file, subjectId),
    onSuccess: (data) => {
      setUploadError(null);
      onUploaded(data.syllabusId, data.jobId);
    },
    onError: (err: Error) => {
      setUploadError(err.message);
    },
  });

  const handleFile = (file: File) => {
    if (!file.type.includes("pdf")) {
      setUploadError("Solo se aceptan archivos PDF.");
      return;
    }
    if (!activeSubjectId) {
      setUploadError("No hay materia activa seleccionada.");
      return;
    }
    setUploadError(null);
    upload.mutate({ file, subjectId: activeSubjectId });
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    // Reset so the same file can be re-picked if needed
    e.target.value = "";
  };

  // Build the recovery link for the "no subject" fallback block.
  const noSubjectLink =
    firstConnection && mappingId
      ? `/connect/done?connectionId=${firstConnection.id}&mappingId=${mappingId}&step=3`
      : "/connect/start?source=notion&redirect=/onboarding";

  return (
    <div className="fade-in">
      <h1 className="hh-1 serif" style={{ marginBottom: 14, maxWidth: 680 }}>
        Subí tu programa.{" "}
        <span className="italic t-muted">
          Vamos a extraer la estructura conceptual.
        </span>
      </h1>
      <p
        className="t-read t-muted"
        style={{ maxWidth: 600, fontSize: 15.5, marginBottom: 32 }}
      >
        Cargá el PDF de tu programa de estudios. Episteme va a identificar los
        conceptos, unidades y objetivos de aprendizaje de forma automática.
        Después podrás revisar y ajustar todo antes de confirmar.
      </p>

      {/* Active subject chip or "no subject" recovery block */}
      {subjectsLoading ? (
        <div
          className="t-sm t-muted"
          style={{ marginBottom: 20, display: "flex", alignItems: "center", gap: 8 }}
        >
          <div
            style={{
              width: 12,
              height: 12,
              border: "2px solid var(--fg-whisper)",
              borderTopColor: "var(--accent-soft)",
              borderRadius: "50%",
              animation: "pulse 0.8s linear infinite",
            }}
            aria-hidden="true"
          />
          Cargando materia…
        </div>
      ) : activeSubjectId && activeSubject ? (
        <div
          className="panel"
          style={{
            padding: "10px 14px",
            marginBottom: 20,
            maxWidth: 440,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <div
            style={{
              flexShrink: 0,
              padding: "2px 8px",
              background: "var(--accent-tint)",
              border: "1px solid var(--accent-deep)",
              borderRadius: 3,
            }}
          >
            <span className="cap-sm" style={{ color: "var(--accent-soft)" }}>
              Materia
            </span>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              className="t-sm"
              style={{ color: "var(--fg)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            >
              {activeSubject.name}
            </div>
            {(activeSubject.course || activeSubject.term) && (
              <div className="t-xs t-faint" style={{ marginTop: 1 }}>
                {[activeSubject.course, activeSubject.term].filter(Boolean).join(" · ")}
              </div>
            )}
          </div>
          <div className="t-xs t-faint">
            Cambiá la materia desde la barra superior
          </div>
        </div>
      ) : (
        <div
          className="panel"
          style={{
            padding: "14px 16px",
            marginBottom: 20,
            maxWidth: 440,
            background: "var(--amber-tint)",
            border: "1px solid var(--amber)",
            borderRadius: 4,
          }}
          role="alert"
        >
          <p className="t-sm" style={{ color: "var(--amber-fg)", margin: "0 0 10px" }}>
            Primero tenés que hacer seguimiento de una materia.
          </p>
          <a href={noSubjectLink} className="btn btn-ghost btn-sm">
            Seleccionar materia
            <svg width="11" height="11" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="2,6.5 11,6.5"/>
              <polyline points="7,2.5 11,6.5 7,10.5"/>
            </svg>
          </a>
        </div>
      )}

      {/* If a syllabus is already loaded for the active subject, show the
          summary instead of the upload form. The user can click "Replace" to
          drop a new version — that re-bumps the syllabus version on submit. */}
      {loadedSyllabus && !showReplace && activeSubjectId ? (
        <>
          <div
            className="panel"
            style={{
              padding: "20px 24px",
              marginBottom: 18,
              maxWidth: 640,
              display: "flex",
              alignItems: "flex-start",
              gap: 16,
            }}
          >
            <div
              style={{
                flexShrink: 0,
                width: 36,
                height: 36,
                borderRadius: 6,
                background: "var(--green-tint)",
                color: "var(--green-fg)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              aria-hidden="true"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3,8 7,12 13,4" />
              </svg>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="serif" style={{ fontSize: 16, fontWeight: 500, marginBottom: 2 }}>
                Programa cargado
              </div>
              <div className="t-sm t-muted" style={{ marginBottom: 8 }}>
                {loadedSyllabus.sourceFilename ?? "syllabus.pdf"}
                {" · v"}
                {loadedSyllabus.version}
                {" · subido "}
                {new Date(loadedSyllabus.createdAt).toLocaleDateString()}
              </div>
              <div className="t-xs t-faint" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <span>
                  <strong style={{ color: "var(--fg)" }}>{loadedSyllabus.conceptCount}</strong>
                  {" "}conceptos
                </span>
                <span>
                  <strong style={{ color: "var(--fg)" }}>{loadedSyllabus.unitCount}</strong>
                  {" "}unidades
                </span>
                <span>
                  estado:{" "}
                  <span className="mono">{loadedSyllabus.status}</span>
                </span>
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="btn btn-primary"
              onClick={() => {
                if (activeSubjectId) {
                  // Jump to /audit so the user can run an audit; we already
                  // have the data they need.
                  window.location.href = `/audit/${activeSubjectId}`;
                }
              }}
            >
              Ir a la auditoría
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => {
                setShowReplace(true);
                setUploadError(null);
              }}
            >
              Reemplazar programa
            </button>
          </div>
        </>
      ) : (
        <>
      {showReplace && loadedSyllabus && (
        <div
          className="panel"
          style={{
            padding: "12px 16px",
            marginBottom: 16,
            maxWidth: 640,
            background: "var(--amber-tint)",
            border: "1px solid var(--amber)",
            borderRadius: 4,
          }}
        >
          <p className="t-sm" style={{ color: "var(--amber-fg)", margin: 0 }}>
            Reemplazar el programa creará una nueva versión (v{loadedSyllabus.version + 1}). La versión actual queda archivada.
          </p>
          <button
            className="btn btn-ghost btn-sm"
            style={{ marginTop: 8 }}
            onClick={() => setShowReplace(false)}
          >
            Cancelar
          </button>
        </div>
      )}

      {/* Drop zone */}
      <div
        className="panel"
        role="button"
        tabIndex={0}
        aria-label="Zona de carga. Arrastrá o hacé clic para seleccionar un PDF."
        style={{
          padding: "56px 40px",
          textAlign: "center",
          border: dragOver
            ? "1.5px dashed var(--accent-soft)"
            : "1.5px dashed var(--fg-whisper)",
          background: dragOver ? "var(--elevated)" : "var(--base)",
          cursor: (upload.isPending || !activeSubjectId) ? "not-allowed" : "pointer",
          transition: "background 120ms, border-color 120ms",
          marginBottom: 12,
          outline: "none",
          opacity: !activeSubjectId ? 0.5 : 1,
        }}
        onDragOver={(e) => { e.preventDefault(); if (activeSubjectId) setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => {
          if (!upload.isPending && activeSubjectId) fileInputRef.current?.click();
        }}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !upload.isPending && activeSubjectId) {
            fileInputRef.current?.click();
          }
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          style={{ display: "none" }}
          onChange={handleChange}
          disabled={!activeSubjectId}
        />
        <div
          style={{
            width: 40,
            height: 40,
            border: "1.5px solid var(--fg-whisper)",
            borderRadius: 8,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 16,
            color: "var(--fg-faint)",
          }}
          aria-hidden="true"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 2v11M6 7l4-5 4 5"/>
            <path d="M3 15v2a1 1 0 001 1h12a1 1 0 001-1v-2"/>
          </svg>
        </div>
        {upload.isPending ? (
          <p className="t-sm t-muted" style={{ margin: 0 }}>
            Subiendo…
          </p>
        ) : (
          <>
            <p
              className="serif"
              style={{ fontSize: 16, margin: "0 0 6px", color: "var(--fg)" }}
            >
              Arrastrá tu PDF acá o hacé clic para seleccionar
            </p>
            <p className="t-sm t-faint" style={{ margin: 0 }}>
              Solo PDF · Máx. 20 MB
            </p>
          </>
        )}
      </div>

      {/* Upload error */}
      {uploadError && (
        <div
          style={{
            color: "var(--accent-soft)",
            fontSize: 13,
            marginBottom: 12,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
          role="alert"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="7" cy="7" r="6"/>
            <line x1="7" y1="4" x2="7" y2="7.5"/>
            <circle cx="7" cy="10" r="0.8" fill="currentColor" stroke="none"/>
          </svg>
          {uploadError}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          className="btn btn-primary"
          disabled={upload.isPending || !activeSubjectId}
          onClick={() => {
            if (activeSubjectId) fileInputRef.current?.click();
          }}
        >
          {upload.isPending ? "Subiendo…" : "Subí tu programa"}
        </button>
      </div>
        </>
      )}
    </div>
  );
}

// ─── Extraction progress (State B) ───────────────────────────────────────────

type ProgressState = "uploading" | "queued" | "extracting" | "ready" | "failed";

function mapJobStateToProgress(
  jobState: string | undefined,
): ProgressState {
  if (!jobState) return "queued";
  if (jobState === "completed") return "ready";
  if (jobState === "failed") return "failed";
  if (jobState === "active") return "extracting";
  // waiting, delayed, waiting-children, prioritized, unknown
  return "queued";
}

const PROGRESS_LABELS: Record<ProgressState, string> = {
  uploading: "Subiendo archivo…",
  queued: "En cola…",
  extracting: "Extrayendo conceptos con IA…",
  ready: "Extracción completa",
  failed: "La extracción falló",
};

interface ExtractionPhaseProps {
  syllabusId: string;
  jobId: string;
  onReady: (draft: CurriculumDraft) => void;
  onRetry: () => void;
}

function ExtractionPhase({
  syllabusId,
  jobId,
  onReady,
  onRetry,
}: ExtractionPhaseProps) {
  const [draftError, setDraftError] = useState<string | null>(null);

  const job = useAsyncJob(jobId);
  const progressState = mapJobStateToProgress(job.data?.state);

  const draft = useQuery({
    queryKey: ["curriculum-draft", syllabusId],
    queryFn: async () => {
      try {
        const data = await getDraft(syllabusId);
        return data;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Error al cargar el borrador.";
        setDraftError(msg);
        throw err;
      }
    },
    enabled: job.data?.state === "completed",
    retry: 1,
  });

  // Transition to review once draft is loaded — use effect to avoid state
  // update during render
  useEffect(() => {
    if (draft.data) onReady(draft.data);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.data]);

  const steps: ProgressState[] = ["uploading", "queued", "extracting", "ready"];
  const currentIndex = steps.indexOf(progressState);

  return (
    <div className="fade-in">
      <h1 className="hh-1 serif" style={{ marginBottom: 14, maxWidth: 680 }}>
        Extrayendo el árbol conceptual.{" "}
        <span className="italic t-muted">Un momento.</span>
      </h1>
      <p
        className="t-read t-muted"
        style={{ maxWidth: 600, fontSize: 15.5, marginBottom: 40 }}
      >
        Opus está leyendo tu programa. Esto puede tomar entre 20 y 60 segundos
        dependiendo de la extensión del documento.
      </p>

      <div className="panel" style={{ padding: "28px 28px 24px", maxWidth: 520, marginBottom: 24 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {steps.map((step, i) => {
            const isDone = i < currentIndex || progressState === "ready";
            const isActive = step === progressState && progressState !== "ready" && progressState !== "failed";
            const isFailed = progressState === "failed" && step === "extracting";

            return (
              <div key={step} style={{ display: "flex", alignItems: "flex-start", gap: 14, padding: "10px 0" }}>
                {/* Step circle */}
                <div
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: isDone
                      ? "var(--green-tint)"
                      : isFailed
                        ? "var(--red-tint)"
                        : isActive
                          ? "var(--accent-tint)"
                          : "transparent",
                    boxShadow: isDone
                      ? "none"
                      : isFailed
                        ? "inset 0 0 0 1px var(--red)"
                        : isActive
                          ? "inset 0 0 0 1px var(--accent-soft)"
                          : "inset 0 0 0 1px var(--fg-whisper)",
                    marginTop: 1,
                  }}
                  aria-hidden="true"
                >
                  {isDone && (
                    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="var(--green-fg)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="1.5,5.5 4.5,8.5 9.5,2.5"/>
                    </svg>
                  )}
                  {isFailed && (
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--red-fg)" strokeWidth="2" strokeLinecap="round">
                      <line x1="2" y1="2" x2="8" y2="8"/>
                      <line x1="8" y1="2" x2="2" y2="8"/>
                    </svg>
                  )}
                  {isActive && (
                    <div
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: "var(--accent-soft)",
                        animation: "pulse 1.4s ease-in-out infinite",
                      }}
                    />
                  )}
                </div>

                <div style={{ paddingTop: 2 }}>
                  <div
                    className="t-sm"
                    style={{
                      color: isDone
                        ? "var(--green-fg)"
                        : isFailed
                          ? "var(--red-fg)"
                          : isActive
                            ? "var(--fg)"
                            : "var(--fg-faint)",
                    }}
                  >
                    {PROGRESS_LABELS[step]}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {progressState === "failed" && (
          <div
            style={{
              marginTop: 12,
              padding: "10px 12px",
              background: "var(--red-tint)",
              borderRadius: 4,
              fontSize: 13,
              color: "var(--red-fg)",
            }}
            role="alert"
          >
            {job.data?.failedReason ?? "Error desconocido durante la extracción."}
          </div>
        )}

        {draftError && (
          <div
            style={{
              marginTop: 12,
              padding: "10px 12px",
              background: "var(--red-tint)",
              borderRadius: 4,
              fontSize: 13,
              color: "var(--red-fg)",
            }}
            role="alert"
          >
            {draftError}
          </div>
        )}
      </div>

      {(progressState === "failed" || draftError) && (
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost" onClick={onRetry}>
            Volver a intentar
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Curriculum review (State C) ─────────────────────────────────────────────

interface ReviewPhaseProps {
  syllabusId: string;
  draft: CurriculumDraft;
  onConfirmed: (subjectId: string) => void;
}

function ReviewPhase({ syllabusId, draft: initialDraft, onConfirmed }: ReviewPhaseProps) {
  const [edits, setEdits] = useState<ConfirmEdits>({});
  const [confirmError, setConfirmError] = useState<string | null>(null);

  // The draft starts from the prop but can be re-fetched if the user clicks
  // "Actualizar" — useful when the worker is still finishing and status is
  // not yet "ready", so the user doesn't have to re-upload.
  const draftQuery = useQuery({
    queryKey: ["curriculum-draft", syllabusId],
    queryFn: () => getDraft(syllabusId),
    initialData: initialDraft,
    staleTime: 0,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
  const draft = draftQuery.data ?? initialDraft;
  const status = draft.syllabus.status;
  const canConfirm = status === "ready";

  const confirm = useMutation({
    mutationFn: () => {
      const hasEdits =
        (edits.subject && Object.keys(edits.subject).length > 0) ||
        (edits.units && Object.keys(edits.units).length > 0) ||
        (edits.concepts && Object.keys(edits.concepts).length > 0);
      return confirmCurriculum({
        syllabusId,
        edits: hasEdits ? edits : undefined,
      });
    },
    onSuccess: (data) => {
      setConfirmError(null);
      onConfirmed(data.subjectId);
    },
    onError: (err: Error) => {
      setConfirmError(err.message);
    },
  });

  // ── Edit helpers ──

  const setSubjectName = (name: string) => {
    setEdits((prev) => ({ ...prev, subject: { ...prev.subject, name } }));
  };

  const setUnitName = (unitId: string, name: string) => {
    setEdits((prev) => ({
      ...prev,
      units: { ...prev.units, [unitId]: { ...prev.units?.[unitId], name } },
    }));
  };

  const setConceptName = (conceptId: string, name: string) => {
    setEdits((prev) => ({
      ...prev,
      concepts: {
        ...prev.concepts,
        [conceptId]: { ...prev.concepts?.[conceptId], name },
      },
    }));
  };

  // Resolve the current display value (edited or original)
  const subjectName = edits.subject?.name ?? draft.subject.name;
  const getUnitName = (unit: DraftUnit) =>
    edits.units?.[unit.id]?.name ?? unit.name;
  const getConceptName = (concept: DraftConcept) =>
    edits.concepts?.[concept.id]?.name ?? concept.name;

  const totalConcepts = draft.units.reduce(
    (acc, u) => acc + u.concepts.length,
    0,
  );

  return (
    <div className="fade-in">
      <h1 className="hh-1 serif" style={{ marginBottom: 14, maxWidth: 680 }}>
        Esto es lo que extrajimos.{" "}
        <span className="italic t-muted">Revisá y ajustá antes de confirmar.</span>
      </h1>
      <p
        className="t-read t-muted"
        style={{ maxWidth: 640, fontSize: 15.5, marginBottom: 32 }}
      >
        Encontramos{" "}
        <strong style={{ color: "var(--fg)" }}>{draft.units.length} unidades</strong>{" "}
        y{" "}
        <strong style={{ color: "var(--fg)" }}>{totalConcepts} conceptos</strong>.
        Podés editar cualquier título con doble clic. Los cambios se envían junto con la confirmación.
      </p>

      {/* Subject header */}
      <div
        className="panel"
        style={{ padding: "18px 20px", marginBottom: 16 }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <div
            style={{
              flexShrink: 0,
              padding: "2px 8px",
              background: "var(--accent-tint)",
              border: "1px solid var(--accent-deep)",
              borderRadius: 3,
            }}
          >
            <span className="cap-sm" style={{ color: "var(--accent-soft)" }}>
              Materia
            </span>
          </div>
          <EditableTitle
            value={subjectName}
            onChange={setSubjectName}
            level="subject"
          />
        </div>
        {(draft.subject.course || draft.subject.term) && (
          <div
            className="t-sm t-faint"
            style={{ marginTop: 6, paddingLeft: 0 }}
          >
            {[draft.subject.course, draft.subject.term]
              .filter(Boolean)
              .join(" · ")}
          </div>
        )}
      </div>

      {/* Units + concepts */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 32 }}>
        {draft.units.map((unit, unitIndex) => (
          <div key={unit.id} className="panel" style={{ padding: 0, overflow: "hidden" }}>
            {/* Unit header */}
            <div
              style={{
                padding: "12px 18px",
                borderBottom:
                  unit.concepts.length > 0 ? "1px solid var(--line)" : "none",
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              <div
                style={{
                  flexShrink: 0,
                  minWidth: 22,
                  height: 22,
                  borderRadius: 4,
                  background: "var(--elevated)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <span
                  className="mono"
                  style={{ fontSize: 11, color: "var(--fg-faint)" }}
                >
                  {unitIndex + 1}
                </span>
              </div>
              <EditableTitle
                value={getUnitName(unit)}
                onChange={(v) => setUnitName(unit.id, v)}
                level="unit"
              />
              {unit.weeksLabel && (
                <span
                  className="t-xs t-faint mono"
                  style={{ marginLeft: "auto", flexShrink: 0 }}
                >
                  {unit.weeksLabel}
                </span>
              )}
            </div>

            {/* Concept rows */}
            {unit.concepts.map((concept, cIdx) => (
              <div
                key={concept.id}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 12,
                  padding: "10px 18px 10px 50px",
                  borderBottom:
                    cIdx < unit.concepts.length - 1
                      ? "1px solid var(--line)"
                      : "none",
                }}
              >
                <div
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "var(--fg-whisper)",
                    flexShrink: 0,
                    marginTop: 5,
                  }}
                  aria-hidden="true"
                />
                <div style={{ flex: 1 }}>
                  <EditableTitle
                    value={getConceptName(concept)}
                    onChange={(v) => setConceptName(concept.id, v)}
                    level="concept"
                  />
                  {concept.learningObjective && (
                    <div
                      className="t-xs t-faint italic"
                      style={{ marginTop: 3, lineHeight: 1.45 }}
                    >
                      {concept.learningObjective}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {unit.concepts.length === 0 && (
              <div
                className="t-xs t-faint"
                style={{ padding: "10px 18px 10px 50px" }}
              >
                Sin conceptos extraídos en esta unidad.
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Confirm error */}
      {confirmError && (
        <div
          style={{
            marginBottom: 16,
            padding: "10px 14px",
            background: "var(--red-tint)",
            border: "1px solid var(--accent-deep)",
            borderRadius: 4,
            fontSize: 13,
            color: "var(--red-fg)",
          }}
          role="alert"
        >
          {confirmError}
        </div>
      )}

      {/* Status banner — visible whenever the syllabus isn't ready to confirm */}
      {!canConfirm && (
        <div
          className="panel"
          style={{
            padding: "12px 16px",
            marginBottom: 12,
            background: "var(--amber-tint)",
            border: "1px solid var(--amber)",
            borderRadius: 4,
            fontSize: 13,
            color: "var(--amber-fg)",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
          role="status"
        >
          <span style={{ flex: 1 }}>
            {status === "extracting"
              ? "La extracción aún está en curso. Actualizá para ver el resultado más reciente."
              : status === "queued"
                ? "El trabajo está en cola."
                : status === "failed"
                  ? `La extracción falló${draft.syllabus.failureReason ? `: ${draft.syllabus.failureReason}` : "."} Volvé a subir el PDF.`
                  : status === "confirmed"
                    ? "Este programa ya fue confirmado anteriormente."
                    : `Estado: ${status}`}
          </span>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => void draftQuery.refetch()}
            disabled={draftQuery.isFetching}
          >
            {draftQuery.isFetching ? "…" : "Actualizar"}
          </button>
        </div>
      )}

      {/* CTA */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="t-sm t-faint">
          Los cambios se guardan al confirmar
        </span>
        <span style={{ flex: 1 }} />
        <button
          className="btn btn-primary btn-lg"
          disabled={confirm.isPending || !canConfirm}
          onClick={() => confirm.mutate()}
          title={!canConfirm ? `Esperando estado=ready (actual: ${status})` : undefined}
        >
          {confirm.isPending ? "Confirmando…" : "Confirmar y continuar"}
          {!confirm.isPending && (
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="2,6.5 11,6.5"/>
              <polyline points="7,2.5 11,6.5 7,10.5"/>
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

function OnboardingPage() {
  const navigate = useNavigate();

  // Phase 0 ("connect") is now the initial state. ConnectPhase auto-advances
  // to "upload" if the user already has a connection + active mapping.
  const [phase, setPhase] = useState<Phase>({ kind: "connect" });

  const handleConnected = () => {
    setPhase({ kind: "upload" });
  };

  const handleUploaded = (syllabusId: string, jobId: string) => {
    setPhase({ kind: "extracting", syllabusId, jobId });
  };

  const handleReady = (draft: CurriculumDraft) => {
    setPhase((prev) => {
      // Guard: only transition once, from "extracting"
      if (prev.kind !== "extracting") return prev;
      return { kind: "review", syllabusId: prev.syllabusId, draft };
    });
  };

  const handleConfirmed = (subjectId: string) => {
    void navigate({ to: "/audit/$subjectId", params: { subjectId } });
  };

  const handleRetry = () => {
    // On retry after extraction failure, go back to upload (not connect — the
    // user is already connected; they just need to re-upload the PDF).
    setPhase({ kind: "upload" });
  };

  // Map phase kind to step number for the indicator
  const currentStep: 1 | 2 | 3 | 4 =
    phase.kind === "connect"
      ? 1
      : phase.kind === "upload"
        ? 2
        : phase.kind === "extracting"
          ? 3
          : 4;

  return (
    <div style={{ maxWidth: 920, margin: "0 auto", padding: "56px 48px 80px" }}>
      <StepIndicator currentStep={currentStep} />

      {phase.kind === "connect" && (
        <ConnectPhase onProceed={handleConnected} />
      )}

      {phase.kind === "upload" && (
        <UploadPhase onUploaded={handleUploaded} />
      )}

      {phase.kind === "extracting" && (
        <ExtractionPhase
          syllabusId={phase.syllabusId}
          jobId={phase.jobId}
          onReady={handleReady}
          onRetry={handleRetry}
        />
      )}

      {(phase.kind === "review" || phase.kind === "confirming") && (
        <ReviewPhase
          syllabusId={phase.syllabusId}
          draft={phase.draft}
          onConfirmed={handleConfirmed}
        />
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
      `}</style>
    </div>
  );
}
