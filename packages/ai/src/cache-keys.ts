// Content-addressable cache helpers (plan.md §4.4). Pure functions.

export function subjectContextKey(opts: {
  subjectId: string;
  syllabusVersion: number;
  thresholdsHash: string;
}): string {
  return `subj:${opts.subjectId}:v${opts.syllabusVersion}:t${opts.thresholdsHash}`;
}

export function conceptContextKey(opts: {
  conceptId: string;
  version: number;
}): string {
  return `cncpt:${opts.conceptId}:v${opts.version}`;
}
