import { useQuery } from "@tanstack/react-query";
import { getAuditLatest } from "../api/audit";

/**
 * Finds the top-1 open-gap concept for the active subject.
 * Priority: red first, then amber.
 * Returns null if no audit has been run or no gap concepts exist.
 */
export function useTopGapConcept(subjectId: string | null): {
  conceptId: string | null;
  isLoading: boolean;
} {
  const query = useQuery({
    queryKey: ["audit", "latest", subjectId],
    queryFn: () => getAuditLatest(subjectId!),
    enabled: !!subjectId,
    staleTime: 30 * 1000,
  });

  if (!query.data) {
    return { conceptId: null, isLoading: query.isLoading };
  }

  const allConcepts = query.data.units.flatMap((u) => u.concepts);

  const topConcept =
    allConcepts.find((c) => c.state === "red") ??
    allConcepts.find((c) => c.state === "amber") ??
    null;

  return {
    conceptId: topConcept?.id ?? null,
    isLoading: query.isLoading,
  };
}
