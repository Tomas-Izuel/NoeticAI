import { useCallback, useEffect } from "react";
import { useMatches, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getSubjects } from "../api/subjects";
import type { Subject } from "../api/subjects";

const LS_KEY = "noeticai.activeSubjectId";

function lsGet(): string | null {
  try {
    return localStorage.getItem(LS_KEY);
  } catch {
    return null;
  }
}

function lsSet(id: string): void {
  try {
    localStorage.setItem(LS_KEY, id);
  } catch {
    // Ignore storage errors (e.g. private-mode restrictions).
  }
}

/**
 * Resolves the active subject with priority:
 *   1. URL `subjectId` param (from any matched route)
 *   2. localStorage `noeticai.activeSubjectId`
 *   3. subjects[0]?.id
 *   4. null
 *
 * `setActiveSubjectId` writes localStorage AND navigates to `/audit/<id>`.
 * Side-effect: when the URL has a subjectId, it is persisted to localStorage.
 */
export function useActiveSubject(): {
  activeSubjectId: string | null;
  activeSubject: Subject | null;
  setActiveSubjectId: (id: string) => void;
  subjects: Subject[];
  isLoading: boolean;
} {
  const navigate = useNavigate();

  const subjectsQuery = useQuery({
    queryKey: ["subjects"],
    queryFn: getSubjects,
    staleTime: 60 * 1000,
  });

  const subjects: Subject[] = subjectsQuery.data?.subjects ?? [];

  // Scan all matched routes for a subjectId param.
  const matches = useMatches();
  let urlSubjectId: string | null = null;
  for (const match of matches) {
    const params = match.params as Record<string, string | undefined>;
    if (params.subjectId) {
      urlSubjectId = params.subjectId;
      break;
    }
  }

  // Side-effect: persist URL subjectId to localStorage when present.
  useEffect(() => {
    if (urlSubjectId) {
      lsSet(urlSubjectId);
    }
  }, [urlSubjectId]);

  // Resolution order: URL param → localStorage → subjects[0] → null.
  const lsId = lsGet();
  const activeSubjectId: string | null =
    urlSubjectId ?? lsId ?? subjects[0]?.id ?? null;

  const activeSubject: Subject | null =
    subjects.find((s) => s.id === activeSubjectId) ?? null;

  const setActiveSubjectId = useCallback(
    (id: string) => {
      lsSet(id);
      void navigate({ to: "/audit/$subjectId", params: { subjectId: id } });
    },
    [navigate],
  );

  return {
    activeSubjectId,
    activeSubject,
    setActiveSubjectId,
    subjects,
    isLoading: subjectsQuery.isLoading,
  };
}
