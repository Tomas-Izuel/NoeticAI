import { createFileRoute, Link } from "@tanstack/react-router";
import type { Subject, SubjectTotals } from "../../api/subjects";
import { useActiveSubject } from "../../lib/useActiveSubject";
import { useSignOut } from "../../api/auth";

export const Route = createFileRoute("/_auth/")({
  component: HomePage,
});

// ── Glyph badge (design/shell.jsx lines 47) ───────────────────────────────────

function SubjectGlyph({ glyph }: { glyph: string | null }) {
  if (!glyph) return null;
  return (
    <span
      style={{
        width: 24,
        height: 24,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "var(--serif)",
        fontStyle: "italic",
        fontSize: 14,
        color: "var(--accent-soft)",
        background: "var(--recessed)",
        border: "1px solid var(--line)",
        flexShrink: 0,
      }}
    >
      {glyph}
    </span>
  );
}

// ── Coverage spine (4px segmented bar) ───────────────────────────────────────

function CoverageSpine({ totals }: { totals: SubjectTotals }) {
  const total = totals.concepts;
  const segs = [
    { bg: "var(--green)", n: totals.covered },
    { bg: "var(--amber)", n: totals.partial },
    { bg: "var(--red)", n: totals.missing },
  ];
  return (
    <div style={{ display: "flex", height: 4, gap: 1, marginBottom: 10 }}>
      {segs.map((s, i) => (
        <div
          key={i}
          style={{
            width: total > 0 ? `${(s.n / total) * 100}%` : "33.33%",
            background: s.bg,
          }}
        />
      ))}
    </div>
  );
}

// ── Coverage stat row ─────────────────────────────────────────────────────────

function CoverageStats({ totals }: { totals: SubjectTotals }) {
  const stats = [
    { state: "green", n: totals.covered, label: "Covered" },
    { state: "amber", n: totals.partial, label: "Partial" },
    { state: "red", n: totals.missing, label: "Missing" },
  ] as const;
  return (
    <div style={{ display: "flex", gap: 12 }}>
      {stats.map((s) => (
        <div key={s.state} style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span className={`cov-dot ${s.state}`} />
          <span className="mono" style={{ fontSize: 11, color: "var(--fg)" }}>{s.n}</span>
          <span className="cap-sm" style={{ color: "var(--fg-faint)" }}>{s.label}</span>
        </div>
      ))}
    </div>
  );
}

// ── Subject card ──────────────────────────────────────────────────────────────

function SubjectCard({ subject }: { subject: Subject }) {
  const hasMeta = subject.course !== null || subject.term !== null;
  const metaLine = [subject.course, subject.term].filter(Boolean).join(" · ");

  return (
    <Link
      to="/audit/$subjectId"
      params={{ subjectId: subject.id }}
      style={{ textDecoration: "none", color: "inherit", display: "block" }}
    >
      <div
        className="panel"
        style={{
          padding: "16px 18px",
          cursor: "pointer",
          transition: "border-color 120ms",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {/* Header row: glyph + name + meta */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <SubjectGlyph glyph={subject.glyph} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="serif" style={{ fontSize: 15, lineHeight: 1.3 }}>
              {subject.name}
            </div>
            {hasMeta && (
              <div className="t-xs t-faint" style={{ marginTop: 2 }}>{metaLine}</div>
            )}
          </div>
        </div>

        {/* Coverage block */}
        {subject.totals.concepts > 0 ? (
          <>
            <CoverageSpine totals={subject.totals} />
            <CoverageStats totals={subject.totals} />
          </>
        ) : (
          <p className="t-sm t-muted" style={{ margin: 0, fontStyle: "italic" }}>
            No audit yet
          </p>
        )}

        {/* Footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            borderTop: "1px solid var(--line)",
            marginTop: 2,
            paddingTop: 10,
          }}
        >
          <span className="t-xs t-faint">Open →</span>
        </div>
      </div>
    </Link>
  );
}

// ── Account panel ─────────────────────────────────────────────────────────────

function AccountPanel({ signOut }: { signOut: () => void }) {
  return (
    <div className="panel" style={{ padding: "16px 18px" }}>
      <div className="cap" style={{ marginBottom: 12 }}>Account</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        <Link to="/plan" style={{ textDecoration: "none" }}>
          <button className="btn btn-ghost btn-sm">Plan &amp; usage</button>
        </Link>
        <Link to="/settings" style={{ textDecoration: "none" }}>
          <button className="btn btn-ghost btn-sm">Settings</button>
        </Link>
        <Link to="/onboarding" style={{ textDecoration: "none" }}>
          <button className="btn btn-ghost btn-sm">Setup / Connect another source</button>
        </Link>
        <button className="btn btn-ghost btn-sm" onClick={signOut}>
          Sign out
        </button>
      </div>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ signOut }: { signOut: () => void }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        padding: "80px 32px",
      }}
    >
      <div className="panel" style={{ padding: "40px 44px", maxWidth: 520, width: "100%" }}>
        <h1
          className="serif"
          style={{
            fontWeight: 400,
            fontSize: 28,
            lineHeight: 1.2,
            letterSpacing: "-0.018em",
            marginBottom: 14,
          }}
        >
          Episteme is ready for your first subject.
        </h1>
        <p className="t-read t-muted" style={{ marginBottom: 28, lineHeight: 1.6 }}>
          Connect a Notion workspace to begin tracking a subject.
        </p>
        <Link
          to="/connect/start"
          search={{ source: "notion" }}
          className="btn btn-primary"
          style={{ display: "inline-flex", marginBottom: 24 }}
        >
          Connect Notion
        </Link>
        <div
          style={{
            display: "flex",
            gap: 6,
            flexWrap: "wrap",
            borderTop: "1px solid var(--line)",
            paddingTop: 16,
          }}
        >
          <Link to="/plan" style={{ textDecoration: "none" }}>
            <button className="btn btn-ghost btn-sm">Plan</button>
          </Link>
          <Link to="/settings" style={{ textDecoration: "none" }}>
            <button className="btn btn-ghost btn-sm">Settings</button>
          </Link>
          <button className="btn btn-ghost btn-sm" onClick={signOut}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Loading state ─────────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="panel" style={{ padding: "20px 24px", maxWidth: 360 }}>
      <span className="t-sm t-muted">Loading subjects…</span>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

function HomePage() {
  const { subjects, isLoading } = useActiveSubject();
  const signOut = useSignOut();

  if (isLoading) {
    return (
      <div style={{ padding: "40px 56px" }}>
        <LoadingState />
      </div>
    );
  }

  if (subjects.length === 0) {
    return <EmptyState signOut={signOut} />;
  }

  return (
    <div style={{ padding: "40px 56px", maxWidth: 1200 }}>
      {/* Hero */}
      <div style={{ marginBottom: 32 }}>
        <div className="cap" style={{ marginBottom: 10 }}>Home</div>
        <h1
          className="serif"
          style={{
            fontWeight: 400,
            fontSize: 36,
            lineHeight: 1.1,
            letterSpacing: "-0.02em",
            marginBottom: 8,
          }}
        >
          Your subjects
        </h1>
        <p className="t-muted" style={{ fontSize: 14 }}>
          Pick a subject to open its coverage audit.
        </p>
      </div>

      {/* Subject grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
          gap: 16,
          marginBottom: 32,
        }}
      >
        {subjects.map((subject) => (
          <SubjectCard key={subject.id} subject={subject} />
        ))}
      </div>

      {/* Account panel */}
      <AccountPanel signOut={signOut} />
    </div>
  );
}
