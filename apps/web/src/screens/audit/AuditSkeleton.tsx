// Skeleton for the audit screen initial load state.
import type { FC } from "react";

const SkeletonLine: FC<{ width?: string; height?: number }> = ({
  width = "100%",
  height = 12,
}) => (
  <div
    style={{
      width,
      height,
      background: "var(--elevated)",
      borderRadius: 2,
      opacity: 0.5,
    }}
  />
);

const SkeletonRow: FC = () => (
  <div
    style={{
      display: "grid",
      gridTemplateColumns: "22px 1fr 80px 80px 180px 130px 24px",
      alignItems: "center",
      gap: 16,
      padding: "14px 12px",
      borderBottom: "1px solid var(--line)",
    }}
  >
    <SkeletonLine width="18px" height={18} />
    <SkeletonLine width="60%" />
    <SkeletonLine width="40px" />
    <SkeletonLine width="40px" />
    <SkeletonLine />
    <SkeletonLine width="70px" />
    <SkeletonLine width="14px" />
  </div>
);

const SkeletonUnit: FC = () => (
  <div style={{ marginBottom: 48 }}>
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: "32px 0 16px",
        borderBottom: "1px solid var(--line)",
        gap: 16,
      }}
    >
      <SkeletonLine width="80px" height={14} />
      <SkeletonLine width="180px" height={18} />
    </div>
    {[1, 2, 3, 4, 5].map((i) => (
      <SkeletonRow key={i} />
    ))}
  </div>
);

export const AuditSkeleton: FC = () => (
  <div className="audit">
    {/* Header skeleton */}
    <div style={{ padding: "40px 56px 32px", borderBottom: "1px solid var(--line)" }}>
      <div style={{ display: "flex", gap: 48 }}>
        <div style={{ flex: "1 1 360px", display: "flex", flexDirection: "column", gap: 14 }}>
          <SkeletonLine width="120px" height={11} />
          <SkeletonLine width="320px" height={36} />
          <SkeletonLine width="90%" height={14} />
          <SkeletonLine width="70%" height={14} />
        </div>
        <div style={{ flex: "0 1 340px", display: "flex", flexDirection: "column", gap: 10 }}>
          <SkeletonLine width="160px" height={11} />
          <SkeletonLine width="100%" height={6} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 1, background: "var(--line)" }}>
            {[1, 2, 3].map((i) => (
              <div key={i} style={{ padding: "10px 12px", background: "var(--canvas)" }}>
                <SkeletonLine width="40px" height={28} />
                <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
                  <SkeletonLine width="8px" height={8} />
                  <SkeletonLine width="60px" height={8} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
    {/* Filter row skeleton */}
    <div style={{ padding: "24px 56px 16px", borderBottom: "1px solid var(--line)", display: "flex", gap: 12 }}>
      {[100, 80, 90, 80].map((w, i) => (
        <SkeletonLine key={i} width={`${w}px`} height={26} />
      ))}
    </div>
    {/* Unit skeletons */}
    <div style={{ padding: "16px 56px 80px" }}>
      <SkeletonUnit />
      <SkeletonUnit />
      <SkeletonUnit />
    </div>
  </div>
);
