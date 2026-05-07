import type { VerdictState } from "./verdict";
import type { Thresholds } from "./types";

export const DEFAULT_THRESHOLDS: Thresholds = {
  greenDepth: 0.78,
  amberDepth: 0.55,
  minFragmentsForGreen: 2,
};

// Pure derivation per plan.md §1.4. The web app re-runs this client-side
// when previewing threshold changes in screen-settings.jsx (Phase 7e).
export function deriveState(
  score: { depth: number; fragments: number },
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): VerdictState {
  if (
    score.depth >= thresholds.greenDepth &&
    score.fragments >= thresholds.minFragmentsForGreen
  ) {
    return "green";
  }
  if (score.depth >= thresholds.amberDepth || score.fragments === 1) {
    return "amber";
  }
  return "red";
}
