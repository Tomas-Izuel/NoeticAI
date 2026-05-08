import type { ConceptFragmentVerdict } from "./verdict";

// Used by score.ts to decide which links count toward mentions/depth.
// Mirrors plan.md §1.4: only engages + mentions count.
export const COUNTING_VERDICTS: ReadonlyArray<ConceptFragmentVerdict> = [
  "engages",
  "mentions",
];

export function countsTowardCoverage(v: ConceptFragmentVerdict): boolean {
  return v === "engages" || v === "mentions";
}

// Per plan.md §1.4: depth = max(score) for engages-verdict fragments,
//                  else 0.4 * max(score) for mentions-only.
export function computeDepth(args: {
  bestEngagesSimilarity: number | null;
  bestMentionsSimilarity: number | null;
}): number {
  if (args.bestEngagesSimilarity !== null) return args.bestEngagesSimilarity;
  if (args.bestMentionsSimilarity !== null)
    return 0.4 * args.bestMentionsSimilarity;
  return 0;
}
