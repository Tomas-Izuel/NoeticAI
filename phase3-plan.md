# Phase 3 implementation playbook — alignment + scoring + gaps + audit screen

> Reader assumed to have `implementation.md` (Phase 3) and `plan.md` open.
> No completions in this phase. Kill-criterion gate: verdict accuracy ≥ 0.85
> on the 200-tuple golden corpus, gap precision/recall ≥ 0.85, run < 60s.
>
> Two engineering agents will execute this:
> - `senior-backend-engineer` owns sections 1–6, 8.
> - `frontend-react-craftsman` owns section 7.
>
> Path conventions: every path below is absolute relative to the repo root
> `/Users/tomasizuel/Documents/Self/episteme/`. The backend lives in
> `apps/server/` (Bun + Hono); the web app in `apps/web/` (Vite SPA, TanStack
> Router/Query); shared packages in `packages/`.

---

## 1. New tables + migration

### 1.1 Migration file

Create `packages/db/migrations/0004_phase3_audit.sql`. The migration runner is
`runMigrations(pool)` invoked from `apps/server/src/index.ts` at boot — it
discovers files in `packages/db/migrations/` lexicographically. No further
wiring needed beyond dropping the file in.

```sql
-- Phase 3 — audit: runs, concept-fragment links, mastery scores, gaps.
-- Builds on Phase 1 (notes/fragments) + Phase 2 (syllabuses/concepts).

-- ---------------------------------------------------------------------------
-- audit_runs: one row per audit invocation. Snapshots thresholds + model ids
-- so a re-score is reproducible after thresholds change.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_runs (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  syllabus_id TEXT NOT NULL REFERENCES syllabuses(id) ON DELETE CASCADE,
  status TEXT NOT NULL,                    -- queued|running|succeeded|failed
  thresholds_json JSONB NOT NULL,          -- snapshot of CoverageThresholds
  models_json JSONB NOT NULL,              -- { embed, haiku } at run time
  failure_reason TEXT,
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS audit_runs_subject_idx
  ON audit_runs(subject_id, started_at DESC);
-- Used by GET /api/subjects/:id/audit/latest — pulls the newest succeeded run.
CREATE INDEX IF NOT EXISTS audit_runs_subject_status_idx
  ON audit_runs(subject_id, status, finished_at DESC);

-- ---------------------------------------------------------------------------
-- concept_fragment_links: N:M (concept × fragment) per audit run.
-- One row per (run, concept, fragment) survivor of the two-stage alignment.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS concept_fragment_links (
  audit_run_id TEXT NOT NULL REFERENCES audit_runs(id) ON DELETE CASCADE,
  concept_id   TEXT NOT NULL REFERENCES concepts(id)   ON DELETE CASCADE,
  fragment_id  TEXT NOT NULL REFERENCES note_fragments(id) ON DELETE CASCADE,
  similarity   NUMERIC(6,4) NOT NULL,           -- cosine score 0..1
  verdict      TEXT NOT NULL,                   -- engages|mentions|tangential|off-topic
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (audit_run_id, concept_id, fragment_id)
);

-- Per-concept lookup for the audit-detail trace and scoring step.
CREATE INDEX IF NOT EXISTS concept_fragment_links_run_concept_idx
  ON concept_fragment_links(audit_run_id, concept_id);
-- For fragment-side joins (e.g. "which concepts does this fragment cover?").
CREATE INDEX IF NOT EXISTS concept_fragment_links_fragment_idx
  ON concept_fragment_links(fragment_id);

-- ---------------------------------------------------------------------------
-- mastery_scores: per (audit_run, concept) summary.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mastery_scores (
  audit_run_id TEXT NOT NULL REFERENCES audit_runs(id) ON DELETE CASCADE,
  concept_id   TEXT NOT NULL REFERENCES concepts(id)   ON DELETE CASCADE,
  state        TEXT NOT NULL,                   -- green|amber|red
  depth        NUMERIC(6,4) NOT NULL,           -- 0..1
  mentions     INTEGER NOT NULL DEFAULT 0,
  sources      INTEGER NOT NULL DEFAULT 0,
  fragments    INTEGER NOT NULL DEFAULT 0,
  conflict     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (audit_run_id, concept_id)
);

-- Per-run pulls grouped by state for the audit screen.
CREATE INDEX IF NOT EXISTS mastery_scores_run_state_idx
  ON mastery_scores(audit_run_id, state);

-- ---------------------------------------------------------------------------
-- gaps: an open item per concept whose state ∈ {amber, red}. Idempotent
-- across runs — one row per concept whose status='open'; updated each run
-- with current_state and latest_run_id.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gaps (
  id                       TEXT PRIMARY KEY,
  concept_id               TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  first_detected_in_run    TEXT NOT NULL REFERENCES audit_runs(id) ON DELETE CASCADE,
  latest_run_id            TEXT NOT NULL REFERENCES audit_runs(id) ON DELETE CASCADE,
  current_state            TEXT NOT NULL,        -- amber|red (never green)
  status                   TEXT NOT NULL,        -- open|dismissed|completed|snoozed
  first_detected_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  last_seen_at             TIMESTAMP NOT NULL DEFAULT NOW(),
  dismissed_at             TIMESTAMP,
  completed_at             TIMESTAMP
);

-- One open gap per concept, enforced at the DB level (so re-runs UPSERT cleanly).
CREATE UNIQUE INDEX IF NOT EXISTS gaps_concept_open_uq
  ON gaps(concept_id) WHERE status = 'open';

CREATE INDEX IF NOT EXISTS gaps_latest_run_idx
  ON gaps(latest_run_id);
```

**Notes on shape**:

- `audit_runs.id` is content-addressable: `sha256(subjectId + syllabusId + Date.now()).slice(0,24)` (mirrors `syllabuses.id` style). Pre-generated server-side; not a serial.
- `concept_fragment_links` PK is `(audit_run_id, concept_id, fragment_id)`. `(run_id, concept_id)` is the most-frequent read shape (per-concept trace, scoring), so the index on it is non-redundant with the PK because PK indexes on multi-column PKs are not free for prefix scans on (run, concept) when the leading column is fine but the planner prefers a narrow covering index for the JOIN to `note_fragments`.
- `mastery_scores` does not store the verdict distribution; the audit-detail endpoint joins back to `concept_fragment_links` for that. Keeps the row narrow and the audit-screen list response cheap.
- `gaps` uses a partial unique index on `concept_id WHERE status = 'open'`. This is the idempotency contract: at most one open gap per concept. Closed/dismissed gaps remain for history.
- All FKs cascade from `subject_id` and `concept_id`, so deleting a subject (or an old syllabus) wipes audit history cleanly. Acceptable for v1 — audit history is derived data.

### 1.2 Drizzle schema additions

Create `packages/db/src/schema/audit.ts`:

```ts
import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  numeric,
  jsonb,
  primaryKey,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { subjects, noteFragments } from "./ingest";
import { syllabuses, concepts } from "./curriculum";

export const auditRuns = pgTable(
  "audit_runs",
  {
    id: text("id").primaryKey(),
    subjectId: text("subject_id")
      .notNull()
      .references(() => subjects.id, { onDelete: "cascade" }),
    syllabusId: text("syllabus_id")
      .notNull()
      .references(() => syllabuses.id, { onDelete: "cascade" }),
    status: text("status").notNull(), // queued|running|succeeded|failed
    thresholdsJson: jsonb("thresholds_json").notNull(),
    modelsJson: jsonb("models_json").notNull(),
    failureReason: text("failure_reason"),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    finishedAt: timestamp("finished_at"),
  },
  (t) => ({
    bySubject: index("audit_runs_subject_idx").on(t.subjectId, t.startedAt),
    bySubjectStatus: index("audit_runs_subject_status_idx").on(
      t.subjectId,
      t.status,
      t.finishedAt,
    ),
  }),
);

export const conceptFragmentLinks = pgTable(
  "concept_fragment_links",
  {
    auditRunId: text("audit_run_id")
      .notNull()
      .references(() => auditRuns.id, { onDelete: "cascade" }),
    conceptId: text("concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
    fragmentId: text("fragment_id")
      .notNull()
      .references(() => noteFragments.id, { onDelete: "cascade" }),
    similarity: numeric("similarity", { precision: 6, scale: 4 }).notNull(),
    verdict: text("verdict").notNull(), // engages|mentions|tangential|off-topic
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.auditRunId, t.conceptId, t.fragmentId] }),
    byRunConcept: index("concept_fragment_links_run_concept_idx").on(
      t.auditRunId,
      t.conceptId,
    ),
    byFragment: index("concept_fragment_links_fragment_idx").on(t.fragmentId),
  }),
);

export const masteryScores = pgTable(
  "mastery_scores",
  {
    auditRunId: text("audit_run_id")
      .notNull()
      .references(() => auditRuns.id, { onDelete: "cascade" }),
    conceptId: text("concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
    state: text("state").notNull(), // green|amber|red
    depth: numeric("depth", { precision: 6, scale: 4 }).notNull(),
    mentions: integer("mentions").notNull().default(0),
    sources: integer("sources").notNull().default(0),
    fragments: integer("fragments").notNull().default(0),
    conflict: boolean("conflict").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.auditRunId, t.conceptId] }),
    byRunState: index("mastery_scores_run_state_idx").on(t.auditRunId, t.state),
  }),
);

export const gaps = pgTable(
  "gaps",
  {
    id: text("id").primaryKey(),
    conceptId: text("concept_id")
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
    firstDetectedInRun: text("first_detected_in_run")
      .notNull()
      .references(() => auditRuns.id, { onDelete: "cascade" }),
    latestRunId: text("latest_run_id")
      .notNull()
      .references(() => auditRuns.id, { onDelete: "cascade" }),
    currentState: text("current_state").notNull(), // amber|red
    status: text("status").notNull(), // open|dismissed|completed|snoozed
    firstDetectedAt: timestamp("first_detected_at").notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
    dismissedAt: timestamp("dismissed_at"),
    completedAt: timestamp("completed_at"),
  },
  (t) => ({
    openConcept: uniqueIndex("gaps_concept_open_uq")
      .on(t.conceptId)
      .where(sql`${t.status} = 'open'`),
    byLatestRun: index("gaps_latest_run_idx").on(t.latestRunId),
  }),
);
```

### 1.3 Re-export

Edit `packages/db/src/schema/index.ts`:

```ts
export * from "./auth";
export * from "./ingest";
export * from "./curriculum";
export * from "./audit";              // NEW
export { vector } from "./types";
```

No change to the migration runner. `pnpm --filter @noeticai/db build` is required after editing the schema package — the server imports `schema` as a barrel.

---

## 2. `@noeticai/audit-core` changes

### 2.1 Threshold-shape mismatch with plan

`plan.md` §1.4 + §7 define `CoverageThresholds` with five fields:
`greenSimilarity`, `greenMinFragments`, `amberSimilarity`, `conflictMinFragments`,
`hallucinationGuardSimilarity`.

Existing `Thresholds` (`packages/audit-core/src/types.ts`) is the
old three-field shape: `greenDepth`, `amberDepth`, `minFragmentsForGreen`.

Decision: **do not break the existing shape**. Phase 3 only needs scoring +
gaps. Conflict detection is deferred to Phase 7b. Hallucination guard is
Phase 5. Add the missing fields as **optional** with defaults exported alongside
`DEFAULT_THRESHOLDS`. This keeps the existing `deriveState` callers working
and makes the new fields available without a code-wide rename.

### 2.2 Type and default updates

Edit `packages/audit-core/src/types.ts`:

```ts
export interface Thresholds {
  // Phase 0–2 fields (Phase 2 used these names; preserved for back-compat).
  greenDepth: number;             // alias for greenSimilarity. default 0.78
  amberDepth: number;             // alias for amberSimilarity. default 0.55
  minFragmentsForGreen: number;   // alias for greenMinFragments. default 2
  // Phase 3 + Phase 5 fields (defaults shipped; usage gated to those phases).
  conflictMinFragments?: number;            // default 3 — Phase 7b
  hallucinationGuardSimilarity?: number;    // default 0.85 — Phase 5
}
```

Edit `packages/audit-core/src/thresholds.ts`:

```ts
export const DEFAULT_THRESHOLDS: Thresholds = {
  greenDepth: 0.78,
  amberDepth: 0.55,
  minFragmentsForGreen: 2,
  conflictMinFragments: 3,
  hallucinationGuardSimilarity: 0.85,
};
```

`deriveState` body unchanged — it only consumes the three Phase 2 fields.

### 2.3 New helpers

Append to `packages/audit-core/src/index.ts` (new file `verdict-helpers.ts`,
re-exported):

```ts
// packages/audit-core/src/verdict-helpers.ts
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
```

Re-export from `packages/audit-core/src/index.ts`:

```ts
export * from "./verdict";
export * from "./types";
export * from "./thresholds";
export * from "./verdict-helpers";   // NEW
```

`pnpm --filter @noeticai/audit-core build` after editing.

---

## 3. Server module layout: `apps/server/src/audit/`

Create a new directory with six files. Each section below specifies one file.

### 3.1 `apps/server/src/audit/align.ts`

**Purpose**: produce `(concept × fragment)` rows with similarity + verdict for
one audit run.

**Key exports**:

```ts
import type { ConceptFragmentVerdict } from "@noeticai/audit-core";

export interface AlignmentInput {
  auditRunId: string;
  subjectId: string;
  syllabusId: string;
  modelId: string;             // embed.defaultModelId at run time
  thresholds: {
    amberSimilarity: number;   // 0.55
  };
}

export interface AlignmentCandidate {
  conceptId: string;
  conceptName: string;
  conceptLearningObjective: string | null;
  fragmentId: string;
  fragmentText: string;
  similarity: number;
}

export interface AlignedLink {
  auditRunId: string;
  conceptId: string;
  fragmentId: string;
  similarity: number;
  verdict: ConceptFragmentVerdict;
}

/**
 * Stage 1: pgvector top-k=20 cosine matches per concept, filtered by:
 *   - concept.syllabus_id = input.syllabusId (active syllabus only)
 *   - concept_embeddings.model_id = input.modelId
 *   - note_fragment_embeddings.model_id = input.modelId
 *   - similarity >= input.thresholds.amberSimilarity (drop tail)
 *   - fragment.note.subject_id = input.subjectId (multi-tenant scoping)
 *
 * Returned grouped by conceptId.
 */
export async function fetchAlignmentCandidates(
  input: AlignmentInput,
): Promise<Map<string, AlignmentCandidate[]>>;

/**
 * Stage 2: per concept, batch all candidates into one Haiku verdict call;
 * cap parallel calls (=4). Persists rows to `concept_fragment_links` in
 * batches, drops any pair whose verdict is "off-topic" or "tangential".
 *
 * Returns the count of persisted links for telemetry. Errors propagate.
 */
export async function runAlignment(input: AlignmentInput): Promise<{
  candidatesConsidered: number;
  linksPersisted: number;
  haikuCalls: number;
}>;
```

**The pgvector query** (write directly with `pool.query`, not Drizzle —
template SQL is clearer for a CTE + window function, and we need the
`<=>` operator):

```sql
WITH concept_vecs AS (
  SELECT c.id AS concept_id, c.name, c.learning_objective, ce.vector
  FROM concepts c
  JOIN concept_embeddings ce ON ce.concept_id = c.id
  WHERE c.syllabus_id = $1
    AND ce.model_id = $2
),
fragment_vecs AS (
  SELECT
    nf.id AS fragment_id,
    nf.text AS fragment_text,
    nfe.vector
  FROM note_fragments nf
  JOIN notes n ON n.id = nf.note_id
  JOIN note_fragment_embeddings nfe ON nfe.fragment_id = nf.id
  WHERE n.subject_id = $3
    AND nfe.model_id = $2
    AND nf.kind <> 'code'
),
ranked AS (
  SELECT
    cv.concept_id,
    cv.name AS concept_name,
    cv.learning_objective,
    fv.fragment_id,
    fv.fragment_text,
    1 - (cv.vector <=> fv.vector) AS similarity,
    ROW_NUMBER() OVER (
      PARTITION BY cv.concept_id
      ORDER BY cv.vector <=> fv.vector ASC
    ) AS rk
  FROM concept_vecs cv
  CROSS JOIN fragment_vecs fv
)
SELECT concept_id, concept_name, learning_objective,
       fragment_id, fragment_text, similarity
FROM ranked
WHERE rk <= 20 AND similarity >= $4
ORDER BY concept_id, similarity DESC;
```

Parameters: `$1 = syllabusId`, `$2 = modelId`, `$3 = subjectId`, `$4 = amberSimilarity (0.55)`.

> Why `<=>` (cosine distance) and `1 - (<=>)` (cosine similarity): pgvector's
> cosine distance is in `[0, 2]`. `1 - distance` gives a `[-1, 1]` cosine
> similarity, but for normalized vectors (Cohere v3 + bge-m3 are both
> normalized) this clamps to `[0, 1]`. Treat values < 0 as outliers if seen
> in eval; they are unexpected.
>
> Why `CROSS JOIN`: with HNSW indexes pgvector cannot use the index for a
> per-row top-k join in a single statement. For Phase 3 sizes (≤ 80 concepts
> × ≤ 250 fragments = 20K pairs) the cross-join is fine. **If a real-world
> Subject crosses ~1K fragments, the cross-join is O(N×M) and we should
> switch to an in-process loop (one query per concept, `ORDER BY vector <=> $3
> LIMIT 20`)** — flag that as a follow-up if eval shows the query > 2s.

**Stage 2 batching**:

- One Haiku call per concept. Batch all `≤20` candidate fragments into a
  single prompt (see `prompt.ts`).
- Concurrency cap: `pLimit(4)` (or a hand-rolled semaphore — no new dep).
  Justification: Bedrock Haiku quota is tight on default account; eval will
  not hit other LLM calls in parallel.
- For each Haiku response, **drop verdicts ∈ {"off-topic", "tangential"}**;
  persist only `engages` and `mentions`. Per-row UPSERT into
  `concept_fragment_links` (PK `(audit_run_id, concept_id, fragment_id)`,
  `ON CONFLICT DO NOTHING` — no resume mid-run for v1).

**Edge cases / invariants**:

- If the subject has **no active syllabus**: caller (`router.ts`) refuses
  with HTTP 409 *before* enqueueing. `align.ts` assumes the syllabus exists.
- If `concept_vecs` is empty (concepts exist but were never embedded): the
  CTE returns 0 rows. `linksPersisted = 0`; downstream `score.ts` produces
  all-red mastery. Surface this in the audit-run `failure_reason` only if
  expected concepts > 0 (sanity check). Better: return `succeeded` with all
  red — it's the correct, observable answer.
- If `fragment_vecs` is empty (no notes ingested yet): same thing, all red.
  Acceptable.
- **Critical model_id invariant**: both `concept_embeddings.model_id` and
  `note_fragment_embeddings.model_id` must equal `input.modelId`. After a
  Bedrock cutover, BOTH sides need a re-embed sweep before audits return
  non-empty results. Item already tracked in `prod-changes.md` §1; we restate
  it in §8 below.
- The current Ollama dev `model_id = bge-m3` produces 1024-dim vectors; the
  Bedrock `cohere.embed-multilingual-v3` is also 1024-dim. Same column shape;
  different content. Filtering on `model_id` is what keeps these from
  cross-contaminating.

### 3.2 `apps/server/src/audit/score.ts`

**Purpose**: collapse `concept_fragment_links` for one run into per-concept
`MasteryScore` rows.

**Key exports**:

```ts
import type { Thresholds } from "@noeticai/audit-core";

export interface ScoringInput {
  auditRunId: string;
  syllabusId: string;
  thresholds: Thresholds;
}

export interface ScoringResult {
  scoredConcepts: number;
  greenCount: number;
  amberCount: number;
  redCount: number;
}

/**
 * For every concept in the syllabus (whether or not it received any links),
 * compute mentions / sources / fragments / depth, derive state via
 * `deriveState`, and INSERT a row into mastery_scores.
 *
 * Single SQL query: GROUP BY concept_id over the run's links, aggregating
 * verdicts. LEFT JOIN against concepts so concepts with zero links emit
 * a (mentions=0, sources=0, depth=0, state=red) row.
 *
 * Conflict detection deferred to Phase 7b — emit conflict=false for all rows.
 */
export async function runScoring(input: ScoringInput): Promise<ScoringResult>;
```

**The scoring SQL** (one statement, idempotent via `ON CONFLICT DO UPDATE`):

```sql
INSERT INTO mastery_scores (
  audit_run_id, concept_id, state, depth, mentions, sources, fragments, conflict
)
SELECT
  $1 AS audit_run_id,
  c.id AS concept_id,
  CASE
    WHEN agg.depth >= $2 AND agg.mentions >= $3 THEN 'green'
    WHEN agg.depth >= $4 OR agg.mentions = 1     THEN 'amber'
    ELSE 'red'
  END AS state,
  COALESCE(agg.depth, 0) AS depth,
  COALESCE(agg.mentions, 0) AS mentions,
  COALESCE(agg.sources, 0) AS sources,
  COALESCE(agg.mentions, 0) AS fragments,    -- alias per plan.md §1.4
  FALSE AS conflict                          -- Phase 7b
FROM concepts c
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) FILTER (
      WHERE l.verdict IN ('engages', 'mentions')
    )::int AS mentions,
    COUNT(DISTINCT n.id) FILTER (
      WHERE l.verdict IN ('engages', 'mentions')
    )::int AS sources,
    GREATEST(
      COALESCE(MAX(l.similarity) FILTER (WHERE l.verdict = 'engages'),     0)::numeric,
      COALESCE(MAX(l.similarity) FILTER (WHERE l.verdict = 'mentions') * 0.4, 0)::numeric
    ) AS depth
  FROM concept_fragment_links l
  JOIN note_fragments nf ON nf.id = l.fragment_id
  JOIN notes n ON n.id = nf.note_id
  WHERE l.audit_run_id = $1 AND l.concept_id = c.id
) agg ON TRUE
WHERE c.syllabus_id = $5
ON CONFLICT (audit_run_id, concept_id) DO UPDATE SET
  state     = EXCLUDED.state,
  depth     = EXCLUDED.depth,
  mentions  = EXCLUDED.mentions,
  sources   = EXCLUDED.sources,
  fragments = EXCLUDED.fragments,
  conflict  = EXCLUDED.conflict;
```

Parameters: `$1 = auditRunId`, `$2 = greenDepth (0.78)`, `$3 = minFragmentsForGreen (2)`, `$4 = amberDepth (0.55)`, `$5 = syllabusId`.

> The state derivation is duplicated between this SQL and `deriveState()`.
> `deriveState` remains the source of truth for the web preview (Phase 7e
> threshold tuning). The SQL mirrors it for batch performance. Add a
> Vitest in `apps/server/__tests__/score.test.ts` that asserts both produce
> identical state for a representative grid of (depth, mentions) pairs.
> Drift between them = bug.

`scoredConcepts`/state-counts come from a follow-up `SELECT state, COUNT(*) ...
GROUP BY state` over the inserted rows.

**Edge cases**:

- A concept with `mentions = 0` and `depth = 0` → `red`. Correct.
- The `agg.sources` count uses `COUNT(DISTINCT n.id) FILTER (...)`. If a
  fragment's note row has been deleted (cascade), the `JOIN notes n` drops
  the row from the count — desired (orphaned fragments shouldn't count).
- `mentions` = 1 → `amber` per the plan's "OR fragments == 1" branch. The
  SQL encodes this; the helper does too.

### 3.3 `apps/server/src/audit/gaps.ts`

**Purpose**: open / refresh / never-close `gaps` rows based on this run's
`mastery_scores`.

**Key exports**:

```ts
export interface GapsInput {
  auditRunId: string;
  syllabusId: string;
}

export interface GapsResult {
  opened: number;       // brand-new gap rows inserted
  refreshed: number;    // existing open gap rows updated
}

/**
 * For every concept whose mastery_scores.state ∈ {amber, red} in this run:
 *
 *   - If a gap row exists for the concept with status='open', UPDATE its
 *     current_state, latest_run_id, last_seen_at.
 *   - Else INSERT a new gap row with first_detected_in_run=auditRunId.
 *
 * Concepts whose state is now 'green' DO NOT close their open gap. Closing
 * is a user action (Phase 5/6: "merge completion" or "dismiss"). This
 * function is one-way.
 */
export async function runGaps(input: GapsInput): Promise<GapsResult>;
```

Implementation:

```sql
-- Single UPSERT exploits the gaps_concept_open_uq partial unique index.
INSERT INTO gaps (
  id, concept_id, first_detected_in_run, latest_run_id,
  current_state, status, first_detected_at, last_seen_at
)
SELECT
  encode(sha256(($1::text || ms.concept_id)::bytea), 'hex')::text,  -- deterministic id
  ms.concept_id,
  $1,
  $1,
  ms.state,
  'open',
  NOW(),
  NOW()
FROM mastery_scores ms
JOIN concepts c ON c.id = ms.concept_id
WHERE ms.audit_run_id = $1
  AND c.syllabus_id = $2
  AND ms.state IN ('amber', 'red')
ON CONFLICT (concept_id) WHERE status = 'open'
DO UPDATE SET
  current_state = EXCLUDED.current_state,
  latest_run_id = EXCLUDED.latest_run_id,
  last_seen_at  = NOW();
```

Parameters: `$1 = auditRunId`, `$2 = syllabusId`.

`opened`/`refreshed` counts come from `RETURNING xmax` (PG trick: `xmax = 0`
means insert, `> 0` means update).

> The deterministic `id = sha256(auditRunId || conceptId)` slice is *only*
> used on the very first insert; on update the existing id is preserved
> (UPSERT updates non-key columns only). Acceptable.

**Edge cases**:

- Concept that was amber last run, green this run: its gap row remains
  `open` with the **previous** `current_state = 'amber'` and `latest_run_id`
  = the *prior* run. The audit screen filter "show open gaps" would still
  surface it. **This is intentional** — the user must consciously dismiss
  or complete it. Phase 5 introduces the close path.
- Concept that goes from amber → red: row updated, `current_state = 'red'`.
- New concept added by a later syllabus version (not active): `c.syllabus_id =
  $2` filter excludes it.

### 3.4 `apps/server/src/audit/prompt.ts`

**Purpose**: build the Haiku verdict prompt for a single concept and its
candidate fragments.

**Key exports**:

```ts
import type { ConceptFragmentVerdict } from "@noeticai/audit-core";

export interface VerdictCandidate {
  id: string;        // fragment id
  text: string;      // raw fragment text (trimmed if > 800 chars)
}

export interface VerdictBatchInput {
  conceptName: string;
  conceptLearningObjective: string | null;
  candidates: VerdictCandidate[];
}

export interface VerdictBatchOutputItem {
  id: string;
  verdict: ConceptFragmentVerdict;
}

/**
 * Returns { system, user } strings to feed into llm.haiku().
 * The system prompt is short and constant — Bedrock cache-friendly when
 * caching lands (Phase 5). The user prompt embeds the candidate JSON.
 */
export function buildVerdictPrompt(input: VerdictBatchInput): {
  system: string;
  user: string;
};
```

**System prompt** (constant; cache-friendly):

```
You are a verdict classifier. Given a concept (name + learning objective) and a
list of paragraph candidates from a student's notes, classify EACH candidate
into exactly one of these labels:

- "engages": the paragraph explains, defines, or substantively works through the concept.
- "mentions": the paragraph names or briefly references the concept without unpacking it.
- "tangential": the paragraph is in the same topical neighborhood but does not address the concept.
- "off-topic": the paragraph is unrelated to the concept.

Output ONLY a JSON array of {"id": string, "verdict": string} objects. No prose.
Output one object per input candidate, preserving order. Do not invent ids.
```

**User prompt template** (dynamic):

```
CONCEPT
name: {conceptName}
learning_objective: {conceptLearningObjective ?? "(none)"}

CANDIDATES
{JSON.stringify(candidates, null, 2)}

Return: [{"id": "...", "verdict": "engages"|"mentions"|"tangential"|"off-topic"}, ...]
```

Trim each candidate's `text` to 800 characters before stringifying — keeps
the prompt under ~16K input tokens for a 20-candidate batch with ~50-token
preamble. Eval-tunable later.

**Fragment-text de-noising note**: do NOT strip whitespace or normalise — the
fragment text is what we'll show in the trace UI. Strip only at *display*
length, not for embedding/verdict invariance.

### 3.5 `apps/server/src/audit/job.ts`

**Purpose**: BullMQ-side orchestrator. Updates `audit_runs.status` across
the lifecycle and runs alignment → scoring → gaps in order.

**Key exports**:

```ts
export interface AuditJobInput {
  auditRunId: string;
}

export interface AuditJobResult {
  auditRunId: string;
  candidatesConsidered: number;
  linksPersisted: number;
  haikuCalls: number;
  scoredConcepts: number;
  greenCount: number;
  amberCount: number;
  redCount: number;
  gapsOpened: number;
  gapsRefreshed: number;
  durationMs: number;
}

export async function runAuditJob(input: AuditJobInput): Promise<AuditJobResult>;

/**
 * Wraps runAuditJob; sets audit_runs.status='failed' + failure_reason on
 * any error before re-throwing (mirrors processSyllabusJob's pattern).
 */
export async function processAuditJob(
  input: AuditJobInput,
): Promise<AuditJobResult>;
```

**Lifecycle**:

```
queued  →  running          (UPDATE at start of runAuditJob)
running →  succeeded         (UPDATE after gaps step + finished_at = NOW())
running →  failed            (catch in processAuditJob; UPDATE failure_reason)
```

**Orchestration sequence** (inside `runAuditJob`):

1. Read the row: `SELECT subject_id, syllabus_id, thresholds_json, models_json
   FROM audit_runs WHERE id = $1`.
2. Set `status = 'running'`.
3. Re-snapshot `models_json.embed = embed.defaultModelId` *now* (the row was
   created with the same value at enqueue time, but a hot env-flip during a
   queued window would otherwise drift). Persist back via UPDATE.
4. Call `runAlignment({ auditRunId, subjectId, syllabusId, modelId, thresholds })`.
5. Call `runScoring({ auditRunId, syllabusId, thresholds })`.
6. Call `runGaps({ auditRunId, syllabusId })`.
7. Set `status = 'succeeded'`, `finished_at = NOW()`.
8. Return the aggregate result.

> No transaction wrapping. The three steps are individually idempotent
> (concept_fragment_links UPSERTs by PK; mastery_scores UPSERTs by PK; gaps
> UPSERTs by partial-unique). A crash mid-run leaves the partial state
> visible — the next run cleans it up because each step's UPSERT replaces
> per-(run, concept) rows. Acceptable for v1.

### 3.6 `apps/server/src/audit/router.ts`

**Purpose**: Hono router for the three Phase 3 endpoints.

```ts
import { Hono } from "hono";

export const auditRouter: Hono;
```

#### `POST /api/audit/runs`

Body:

```ts
{ subjectId: string }
```

Behavior:

1. `auth.api.getSession(...)` → 401 if not authenticated.
2. Verify ownership: `subjects.user_id = session.user.id`. 404 if not found,
   403 if not owned.
3. Look up the active syllabus:
   ```sql
   SELECT id FROM syllabuses
   WHERE subject_id = $1 AND is_active = TRUE
   LIMIT 1
   ```
   If none, return 409 `{ error: "no active syllabus for subject" }`.
4. Generate `auditRunId = sha256(subjectId + syllabusId + Date.now()).slice(0,24)`.
5. Insert `audit_runs` row:
   - `status = 'queued'`
   - `thresholds_json = DEFAULT_THRESHOLDS`
   - `models_json = { embed: embed.defaultModelId, haiku: <bedrock haiku id or 'ollama:gemma'> }`
6. `enqueueAuditRun({ auditRunId })` → returns `jobId`.
7. Return `201 { auditRunId, jobId }`.

#### `GET /api/audit/runs/:id`

Returns full audit-run detail including the per-concept 4-step trace.
Optional query param `?conceptId=...` narrows the trace to a single concept
(for the side drawer).

Ownership check via JOIN: `audit_runs → subjects → user.id`.

Response shape:

```ts
interface AuditRunDetail {
  run: {
    id: string;
    subjectId: string;
    syllabusId: string;
    status: "queued" | "running" | "succeeded" | "failed";
    thresholds: Thresholds;
    models: { embed: string; haiku: string };
    failureReason: string | null;
    startedAt: string;     // ISO
    finishedAt: string | null;
  };
  // present only when status='succeeded'
  concepts?: Array<{
    conceptId: string;
    conceptName: string;
    unitId: string | null;
    state: "green" | "amber" | "red";
    depth: number;
    mentions: number;
    sources: number;
    fragments: number;
    conflict: boolean;
    // 4-step trace for the side drawer:
    trace: {
      topFragments: Array<{
        fragmentId: string;
        fragmentText: string;     // first 320 chars + "…" if truncated
        noteId: string;
        noteTitle: string;
        similarity: number;
        verdict: "engages" | "mentions" | "tangential" | "off-topic";
      }>;
    };
  }>;
}
```

The default response (no `?conceptId`) returns all concepts with
`trace.topFragments` capped at top-5 by similarity. With `?conceptId=X`,
returns only that concept's row but with `trace.topFragments` capped at 20
(the original alignment cap).

Implementation: one SQL pulling `mastery_scores ⨝ concepts` and one
follow-up SQL pulling `concept_fragment_links ⨝ note_fragments ⨝ notes`
ordered `(concept_id, similarity DESC)` with a per-concept limit using
`ROW_NUMBER() OVER (PARTITION BY concept_id ORDER BY similarity DESC)`.

#### `GET /api/subjects/:id/audit/latest`

Returns the latest **succeeded** run shaped for the audit screen.

Ownership: subject must belong to session user.

Response shape (designed to render `screen-audit.jsx` directly):

```ts
interface AuditLatestResponse {
  run: {
    id: string;
    startedAt: string;
    finishedAt: string;
  } | null;          // null if subject has no succeeded run yet
  subject: {
    id: string;
    name: string;
    course: string | null;
    term: string | null;
    glyph: string | null;
  };
  totals: {
    concepts: number;
    covered: number;     // green
    partial: number;     // amber
    missing: number;     // red
  } | null;
  units: Array<{
    id: string;
    order: number;
    name: string;
    weeksLabel: string | null;
    concepts: Array<{
      id: string;
      order: number;
      name: string;
      learningObjective: string | null;
      state: "green" | "amber" | "red";
      depth: number;
      mentions: number;
      sources: number;
      fragments: number;
      conflict: boolean;
      // top-3 candidate-fragment previews bundled to power the side drawer
      // without an extra round trip on click. See §7.7 for the trade-off.
      previews: Array<{
        fragmentId: string;
        fragmentText: string;     // ≤200 chars
        similarity: number;
        verdict: "engages" | "mentions" | "tangential" | "off-topic";
      }>;
    }>;
  }>;
}
```

Implementation queries (in order):

1. Latest succeeded run id for the subject:
   ```sql
   SELECT id FROM audit_runs
   WHERE subject_id = $1 AND status = 'succeeded'
   ORDER BY finished_at DESC LIMIT 1
   ```
2. If none → return `{ run: null, totals: null, units: [...] }` with units
   pulled from the syllabus + concepts but no scores.
3. `mastery_scores ⨝ concepts ⨝ units` filtered by `audit_run_id` and
   `c.syllabus_id` (the latest run's syllabus).
4. Top-3 previews per concept: same `ROW_NUMBER` window query as above with
   limit 3.
5. Group/shape in JS.

**Edge cases**:

- Subject has a syllabus but no run yet: `run = null, totals = null`,
  `units` populated with concept rows but `state` defaulted to `"red"` and
  `depth/mentions/sources/fragments = 0` (so the empty-state UI can render
  the same shape).
- Subject has runs but only `failed` ones: same as no run yet — pick latest
  `succeeded`. The error UI renders from `useAsyncJob` failure state, not
  from `latest`.

### 3.7 Mounting

Add to `apps/server/src/index.ts`:

```ts
import { auditRouter } from "./audit/router";
// ...
app.route("/", auditRouter);
```

Place it after `syllabusRouter` (lexical ordering matches the file layout).

---

## 4. Queue wiring (`apps/server/src/queue/index.ts`)

### 4.1 Diff

Edit `apps/server/src/queue/index.ts`:

```ts
import { processAuditJob, type AuditJobResult } from "../audit/job";

// ── New job-data shape ──────────────────────────────────────────────────────
export interface AuditJobData {
  auditRunId: string;
}

// ── queues map: add 'audit' ─────────────────────────────────────────────────
export const queues = {
  noop: new Queue("noop", { connection: redis }),
  ingest: new Queue<IngestJobData, IngestResult>("ingest", { connection: redis }),
  syllabus: new Queue<SyllabusJobData, SyllabusExtractionResult>("syllabus", {
    connection: redis,
  }),
  audit: new Queue<AuditJobData, AuditJobResult>("audit", {
    connection: redis,
  }),
};

// ── inside startWorkers(): add the audit worker ─────────────────────────────
const auditWorker = new Worker<AuditJobData, AuditJobResult>(
  "audit",
  async (job) => processAuditJob(job.data),
  {
    connection: redis,
    // concurrency=1 — runs are heavy (Haiku × 80 concepts) and rare. Per-subject
    // serialisation is implicit at concurrency=1; lift to 4 when we split a
    // dedicated worker process per prod-changes.md §7.
    concurrency: 1,
  },
);
auditWorker.on("error", (err) => {
  console.error("[queue:audit] worker error:", err.message);
});
auditWorker.on("failed", (job, err) => {
  console.error(`[queue:audit] job=${job?.id} failed:`, err.message);
});

// ── enqueue helper ──────────────────────────────────────────────────────────
export async function enqueueAuditRun(
  data: AuditJobData,
  opts?: JobsOptions,
): Promise<string> {
  const job = await queues.audit.add("audit:run", data, opts);
  if (!job.id) throw new Error("BullMQ did not return a job id");
  return job.id;
}
```

`lookupJob` already iterates `Object.entries(queues)` — adding the new queue
to the map is sufficient. `JobLookup<AuditJobResult>` type-flows because the
generic on `Queue` is preserved.

### 4.2 Retry policy

Apply default attempts via `enqueueAuditRun`'s second arg:

```ts
await enqueueAuditRun(
  { auditRunId },
  { attempts: 1, removeOnComplete: { count: 200 }, removeOnFail: { count: 200 } },
);
```

`attempts: 1` because the failure modes we expect (Bedrock 429, Ollama
process down) are observable and re-runnable from the UI. Auto-retry would
mask quota issues. Defer exponential-backoff retry to Phase 4+.

---

## 5. `index.ts` mounting (already covered)

Line to add in `apps/server/src/index.ts` after the existing
`app.route("/", syllabusRouter);`:

```ts
app.route("/", auditRouter);
```

No other changes to `index.ts`.

---

## 6. Shared LLM-JSON parser

### 6.1 New file: `apps/server/src/ai/json.ts`

Extract `parseLlmResponse` + `trySalvageTruncatedJson` + `computeClosingBrackets`
verbatim from `apps/server/src/syllabus/job.ts` (lines ~57–165) into a
generic helper. The new file owns the leniency policy.

```ts
import { z } from "zod";

/**
 * Lenient LLM-JSON parser. Used by the syllabus extractor (Opus) and the
 * Phase 3 Haiku verdict step. Centralising here so a behaviour change is
 * applied to both call sites at once.
 *
 * Behaviour:
 *   1. Strip ```json ... ``` or ``` ... ``` fences if present.
 *   2. Try a direct JSON.parse on the (possibly stripped) text.
 *   3. Fall back to the outermost {…} or […] block.
 *   4. Fall back to the depth-aware truncation salvage (synthesises closing
 *      brackets for cut-mid-output responses; see syllabus/job.ts comment).
 *   5. Throw with a head/tail snippet for diagnosis.
 *
 * Strict on Bedrock / production: the leniency layers mask prompt-contract
 * drift. Re-evaluate after the AWS cutover (prod-changes.md §1).
 */
export function parseLlmJson<T>(raw: string, schema: z.ZodType<T>): T;
```

Implementation: copy/move the three functions and swap `ExtractedSyllabusSchema`
references for the generic `schema` argument. Move the "Outermost {…} block"
regex to `/[\{\[][\s\S]*[\}\]]/` so it works for both object- and array-rooted
LLM outputs (Phase 3 verdict response is an array). The truncation salvage
already only emits closes when the head ended on a `}`; for the array case
it harmlessly returns null and the caller falls through.

### 6.2 Update `apps/server/src/syllabus/job.ts`

Replace the inline `parseLlmResponse` / `trySalvageTruncatedJson` /
`computeClosingBrackets` definitions with:

```ts
import { parseLlmJson } from "../ai/json";

// ... at the existing call site:
const extracted = parseLlmJson(result.text, ExtractedSyllabusSchema);
```

Delete the inline helpers from `syllabus/job.ts`.

Run `apps/server/src/syllabus/parse.test.ts` — it should still pass against
the relocated implementation.

### 6.3 Use from the alignment step

In `apps/server/src/audit/align.ts`, define the verdict-response zod schema:

```ts
import { z } from "zod";
import { parseLlmJson } from "../ai/json";

const VerdictSchema = z.array(
  z.object({
    id: z.string().min(1),
    verdict: z.enum(["engages", "mentions", "tangential", "off-topic"]),
  }),
);

// per concept:
const result = await llm.haiku({ system, messages: [...], maxTokens: 2048 });
const verdicts = parseLlmJson(result.text, VerdictSchema);
```

After parse: filter to ids that were in the candidates list (drop any
hallucinated ids), then cross-reference back to similarities and persist.

---

## 7. Frontend playbook

### 7.1 Import the audit screen CSS

Edit `apps/web/src/styles/globals.css`:

```css
/* Imports the design CSS verbatim so the visual baseline applies unchanged.
   Path resolves through Vite from apps/web/src/styles/ → /design/styles.css. */
@import url("../../../../design/styles.css");
@import url("../../../../design/screen-audit.css");
/* Phase 5 will add: @import url("../../../../design/screen-concept.css"); */
```

> Vite resolves these as plain CSS files via the existing `@import url(...)`
> pattern; no module-graph entry needed.

### 7.2 Typed API wrappers — `apps/web/src/api/audit.ts`

```ts
import { apiFetch } from "./client";

// ── Types: mirror the server response shapes from §3.6. ─────────────────────
export type CoverageState = "green" | "amber" | "red";
export type ConceptVerdict = "engages" | "mentions" | "tangential" | "off-topic";

export interface AuditRunSummary {
  id: string;
  startedAt: string;
  finishedAt: string;
}

export interface AuditConceptPreview {
  fragmentId: string;
  fragmentText: string;
  similarity: number;
  verdict: ConceptVerdict;
}

export interface AuditConcept {
  id: string;
  order: number;
  name: string;
  learningObjective: string | null;
  state: CoverageState;
  depth: number;
  mentions: number;
  sources: number;
  fragments: number;
  conflict: boolean;
  previews: AuditConceptPreview[];
}

export interface AuditUnit {
  id: string;
  order: number;
  name: string;
  weeksLabel: string | null;
  concepts: AuditConcept[];
}

export interface AuditTotals {
  concepts: number;
  covered: number;
  partial: number;
  missing: number;
}

export interface AuditLatest {
  run: AuditRunSummary | null;
  subject: {
    id: string;
    name: string;
    course: string | null;
    term: string | null;
    glyph: string | null;
  };
  totals: AuditTotals | null;
  units: AuditUnit[];
}

export interface AuditRunDetailFragment {
  fragmentId: string;
  fragmentText: string;
  noteId: string;
  noteTitle: string;
  similarity: number;
  verdict: ConceptVerdict;
}

export interface AuditRunDetailConcept {
  conceptId: string;
  conceptName: string;
  unitId: string | null;
  state: CoverageState;
  depth: number;
  mentions: number;
  sources: number;
  fragments: number;
  conflict: boolean;
  trace: { topFragments: AuditRunDetailFragment[] };
}

export interface AuditRunDetail {
  run: {
    id: string;
    subjectId: string;
    syllabusId: string;
    status: "queued" | "running" | "succeeded" | "failed";
    thresholds: {
      greenDepth: number;
      amberDepth: number;
      minFragmentsForGreen: number;
    };
    models: { embed: string; haiku: string };
    failureReason: string | null;
    startedAt: string;
    finishedAt: string | null;
  };
  concepts?: AuditRunDetailConcept[];
}

// ── Endpoints ───────────────────────────────────────────────────────────────

export interface RunAuditResponse {
  auditRunId: string;
  jobId: string;
}

export function startAuditRun(subjectId: string): Promise<RunAuditResponse> {
  return apiFetch<RunAuditResponse>("/api/audit/runs", {
    method: "POST",
    body: JSON.stringify({ subjectId }),
  });
}

export function getAuditLatest(subjectId: string): Promise<AuditLatest> {
  return apiFetch<AuditLatest>(`/api/subjects/${subjectId}/audit/latest`);
}

export function getAuditRun(
  runId: string,
  conceptId?: string,
): Promise<AuditRunDetail> {
  const qs = conceptId ? `?conceptId=${encodeURIComponent(conceptId)}` : "";
  return apiFetch<AuditRunDetail>(`/api/audit/runs/${runId}${qs}`);
}
```

### 7.3 The audit route — `apps/web/src/routes/_auth/audit.$subjectId.tsx`

Replace the placeholder with a full implementation:

```ts
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  type AuditConcept,
  type CoverageState,
  type AuditUnit,
  getAuditLatest,
  startAuditRun,
} from "../../api/audit";
import { useAsyncJob } from "../../lib/useAsyncJob";

export const Route = createFileRoute("/_auth/audit/$subjectId")({
  component: AuditScreenRoute,
});

type Filter = "all" | CoverageState;

function AuditScreenRoute() {
  const { subjectId } = Route.useParams();
  const qc = useQueryClient();

  // 1. Latest audit data.
  const latestQ = useQuery({
    queryKey: ["audit", "latest", subjectId],
    queryFn: () => getAuditLatest(subjectId),
  });

  // 2. Run-audit mutation → returns jobId; we then poll it.
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const runMutation = useMutation({
    mutationFn: () => startAuditRun(subjectId),
    onSuccess: (res) => setActiveJobId(res.jobId),
  });

  // 3. Poll the job until terminal; on completion, invalidate latest.
  const jobQ = useAsyncJob(activeJobId, { intervalMs: 1500 });
  useEffect(() => {
    if (!jobQ.data) return;
    if (jobQ.data.state === "completed") {
      qc.invalidateQueries({ queryKey: ["audit", "latest", subjectId] });
      setActiveJobId(null);
    } else if (jobQ.data.state === "failed") {
      // Leave the activeJobId set so the failure UI surfaces; user clicks
      // "Run audit" again to clear.
    }
  }, [jobQ.data, qc, subjectId]);

  // 4. Filter chips. State derived locally from latest payload.
  const [filter, setFilter] = useState<Filter>("all");

  // ... see §7.4 for the render structure.
  return null; // placeholder for §7.4
}
```

### 7.4 Render structure (mirrors `design/screen-audit.jsx`)

The component tree, in render order, with explicit data sources:

1. **Header (`AuditHeader`)** — derived from `latestQ.data.subject` + `.totals`.
   When `totals === null` (no run yet), render the subject identity + a
   *"Run your first audit"* CTA in place of the segmented spine.
2. **Filter row** — chips for `all/red/amber/green`, with counts derived
   from `latestQ.data.totals`. View toggle (spine/map) on the right; only
   "spine" lit in Phase 3, "map" navigates to `/map/$subjectId` (Phase 7).
3. **Run-audit controls** — sticky button "Run audit" → `runMutation.mutate()`.
   When `jobQ.data?.state` is `active`/`waiting`/`delayed` show
   "Auditing… (running step: …)" with a spinner; disable the button.
4. **Unit list** — for each unit in `latestQ.data.units`, render the
   `UnitBlock`:
   - `unit-head` with weeks label + name.
   - `unit-grid-head`.
   - `unit-rows` — one `ConceptRow` per concept, filtered by the active
     filter.
5. **Side drawer** — controlled by `useState<{ conceptId: string } | null>`;
   on `ConceptRow` click sets the state. The drawer pulls preview data
   directly from the bundled `concept.previews` (see §7.7 for trade-off).
   For more than 3 fragments, fetch `getAuditRun(latestQ.data.run.id, conceptId)`
   on demand and render its `concepts[0].trace.topFragments`.

Component leaf list (one file each, under
`apps/web/src/screens/audit/` for clarity):

```
apps/web/src/screens/audit/
├── AuditHeader.tsx
├── EmptyAuditState.tsx          // shown when run === null
├── FilterRow.tsx
├── UnitBlock.tsx
├── ConceptRow.tsx
├── ConceptDrawer.tsx            // side drawer with the 4-step trace
└── DepthBar.tsx                 // tiny, mirrors design/screen-audit.jsx <DepthBar/>
```

State badges use the design's existing CSS classes:

- `.cov-pill.green` → "covered"
- `.cov-pill.amber` → "incomplete" or "conflict" (with alert icon when `concept.conflict`)
- `.cov-pill.red` → "missing"
- `.cov-dot.<state>` for the small dots
- `.cov-square.<state>` for the unit-head dot grid

These classes already exist in `design/styles.css` (the design package
defines them via the design-token system). Verify by grepping
`/Users/tomasizuel/Documents/Self/episteme/design/styles.css` for `.cov-pill`
during implementation; if missing, the design CSS file is the right place
to add them — do NOT redefine them in `apps/web/src/styles/`.

### 7.5 Loading + error states

- **Initial query loading** (`latestQ.isLoading`): render the unit-block
  skeletons — 3 unit blocks each with 5 placeholder rows. Use the
  design's existing `.t-faint` color for placeholder backgrounds.
- **Mutation pending** (`runMutation.isPending` or `jobQ.data?.state` ∈
  active/waiting/delayed): "Run audit" button shows a spinner and is
  disabled; the subhead shows "Audit in progress — this takes 30–60s".
- **Job failure** (`jobQ.data?.state === "failed"`): an inline error banner
  above the unit list, copy: *"Audit failed: {failedReason}. Try again."*
  with a retry button that re-invokes `runMutation.mutate()`.
- **Latest-query error** (`latestQ.isError`): a full-screen error card with
  a Retry button (`latestQ.refetch()`).
- **No run yet** (`latestQ.data?.run === null`): empty-state card with the
  CTA "Run your first audit". Concept ledger is hidden (no point showing
  all-red rows before the first run).

### 7.6 Filter logic

```ts
const filtered = useMemo<AuditUnit[]>(() => {
  if (!latestQ.data) return [];
  return latestQ.data.units
    .map((u) => ({
      ...u,
      concepts:
        filter === "all" ? u.concepts : u.concepts.filter((c) => c.state === filter),
    }))
    .filter((u) => u.concepts.length > 0);
}, [latestQ.data, filter]);
```

Counts shown in the chips come from `latestQ.data.totals` directly.

### 7.7 Side-drawer payload trade-off

**Recommendation: bundle top-3 previews per concept in `/audit/latest`.**

| Approach | Pros | Cons |
|---|---|---|
| **Bundle top-3 (chosen)** | Drawer opens instantly. One round trip per page load. Matches design's "click to expand" feel. | Latest payload grows by ~3 × concept-count × ~250 bytes ≈ 60 KB for an 80-concept subject. Acceptable. |
| Fetch on click | Smaller initial payload. | Extra round trip on every drawer open; user perceives latency. |

The 4-step deep trace (top-20 fragments) still uses
`GET /api/audit/runs/:id?conceptId=...` on demand — for users who click
"see all evidence" inside the drawer. So we get bundled-fast for the common
case and lazy-deep for the explore case.

If a real Subject crosses 200+ concepts, revisit: switch the bundled
preview to top-1, or page units, or move to lazy-fetch.

### 7.8 routeTree regen

After adding component imports, run `pnpm --filter @noeticai/web dev` once
locally so TanStack Router re-generates `apps/web/src/routeTree.gen.ts`. CI
should already be set up to do this; the agent does not check in
`routeTree.gen.ts` edits manually.

---

## 8. `prod-changes.md` additions

Append a new section to `/Users/tomasizuel/Documents/Self/episteme/prod-changes.md`
under a `## Phase 3 dev shortcuts` heading (mirroring the existing
`## Phase 2 dev shortcuts` section). Bullets to add, verbatim:

- [ ] **Haiku verdict routing on Ollama**: `llm.haiku()` routes to whatever
  the env-configured Ollama model is when `NOETICAI_AI_BACKEND=ollama`. The
  Phase 3 kill-criterion gate (verdict accuracy ≥ 0.85) **does not apply on
  gemma** — re-run the eval after flipping `NOETICAI_AI_BACKEND=bedrock`.
- [ ] **Verdict-prompt JSON salvage may mask Bedrock prompt-contract drift**.
  `apps/server/src/audit/align.ts` consumes the shared `parseLlmJson` helper
  in `apps/server/src/ai/json.ts` (factored out of `syllabus/job.ts` in
  Phase 3). The same leniency layers (markdown-fence stripping, outermost-
  block extraction, depth-aware truncation salvage) that mask Ollama quirks
  may also mask Haiku contract drift. After the Bedrock cutover, re-run the
  Phase 3 eval harness and remove leniency layers if they stop being needed.
- [ ] **Embedding model_id invariant**: Phase 3 alignment retrieval filters
  *both* `concept_embeddings` and `note_fragment_embeddings` on
  `embed.defaultModelId`. The Phase 0–2 re-embed plan (§1 above) MUST cover
  both tables before any audit returns non-empty results — the `model_id`
  column on each side has to match. Concretely, after flipping
  `NOETICAI_AI_BACKEND=bedrock`, run two re-embed sweeps:
  - `note_fragment_embeddings` (already covered in §1).
  - `concept_embeddings` — same shape, run identically. Without it, the
    syllabus side has rows under `model_id = bge-m3` and the audit query
    finds zero matching pairs.
- [ ] **Audit worker concurrency=1**. The audit BullMQ worker currently caps
  at `concurrency: 1` in `apps/server/src/queue/index.ts`. This serialises
  audit fan-out (Haiku × 80 concepts) to keep the in-process Bun event loop
  responsive while the HTTP server shares the same process. Once we split
  workers into `apps/worker` (already tracked in §7), lift `audit` to ≥4 and
  the per-Haiku-concurrency cap inside `align.ts` becomes the new bottleneck
  (currently 4; bump to 8 once Bedrock quotas are increased).
- [ ] **Local PDF storage already covered** — Phase 3 doesn't add new
  storage. Bibliography uploads in Phase 4 will trip the same shortcut
  (already tracked in §6).
- [ ] **Bedrock cache-points still stubbed** — Phase 3 doesn't lean on
  prompt caching (Haiku's verdict prompts are small enough to be cheap
  uncached). Phase 5 grounded completion will. The `cachePoints` arg in
  `packages/ai/src/bedrock.ts` remains a stub (already tracked in §4).

---

## 9. Out of scope (do not pull in)

The following are explicitly **NOT** in Phase 3 — the implementing agents
must reject scope creep and surface any pressure to add them as a separate
ticket:

- **Grounded completion**: Phase 5. No `POST /api/gaps/:id/completions`.
  No `completions` or `citations` tables touched. The audit screen has
  *no* "Complete the X gaps" button hooked up — leave it visible (per design)
  but inert (button disabled or routes to a Phase 5 placeholder).
- **Conflict detection**: Phase 7b. `mastery_scores.conflict` is always
  `false`. No pairwise Haiku check.
- **Map view**: Phase 7c. The `screen-map.jsx` route is unchanged from its
  current placeholder.
- **Threshold tuning UI**: Phase 7e. The audit run snapshots
  `DEFAULT_THRESHOLDS` and that's it. No `PATCH /subjects/:id/thresholds`
  endpoint.
- **Bibliography ingest**: Phase 4. No `sources` or `source_chunks` tables.
  The audit screen header copy `… and N bibliographic sources` should
  display `0` (or hide the clause when sources count is 0).
- **Connector write-back**: Phase 6+. The `screen-concept.jsx` "merge into
  note" surface is not built.
- **Activity feed**: Phase 7d. No `activity` table writes.
- **Per-subject `subjects.lang`-driven embed-model routing**: deferred. Phase
  3 uses `embed.defaultModelId` for both sides of alignment; per-call
  override lands when the multilingual eval drives it.

If anything in this list creeps in, the kill-criterion gate is the wrong
one to optimise against and we should pause and re-plan.

---

## 10. Validation gate

Restated from `implementation.md` (Phase 3) with how-to-verify steps. Two
columns: gates that MUST pass (Bedrock-only) and gates that can be smoke-
tested on Ollama for plumbing.

### 10.1 Kill-criterion gates (Bedrock-only)

These do NOT pass on Ollama/gemma — that is by design (`prod-changes.md`
§2 already documents the dev-loop ceiling). Verify each on Bedrock after
the AWS cutover.

- [ ] **Verdict accuracy ≥ 0.85 vs. 200-tuple golden corpus** at
  `apps/server/__eval__/verdicts.json`.
  - **How to verify**: run a new eval test
    `apps/server/__eval__/verdicts.test.ts` that:
    1. Loads each fixture tuple `{ conceptId, fragmentId, expectedVerdict }`.
    2. Builds a single-candidate verdict prompt via `buildVerdictPrompt`.
    3. Calls `llm.haiku(...)` with the run's concept text.
    4. Parses with `parseLlmJson(VerdictSchema)`.
    5. Computes accuracy = (correct verdicts / 200).
    6. Asserts `accuracy >= 0.85`.
  - On Ollama: expect 0.50–0.70; do not block on it.

- [ ] **Gap precision and recall both ≥ 0.85 on the fixture**.
  - **How to verify**: on the Phase-1 stub fixture (8 Spanish notes), the
    golden gap set is hand-labelled per concept. After running an audit:
    - Precision = `|emitted_gaps ∩ expected_gaps| / |emitted_gaps|`.
    - Recall = `|emitted_gaps ∩ expected_gaps| / |expected_gaps|`.
  - Add `apps/server/__eval__/gaps.test.ts`. On Ollama: expect noisy gap
    sets — verdicts produce different mention counts so amber/red distribution
    drifts. Smoke-test only.

### 10.2 Plumbing gates (verifiable on Ollama)

These verify the Phase 3 plumbing works end-to-end. They MUST pass on the
local Ollama dev stack — the agents implementing this should validate each
locally before handing off.

- [ ] **An audit run end-to-end completes without errors on the stub
  fixture**.
  - How: from the `/audit/$subjectId` route, click "Run audit". Watch
    the job progress. The job should reach `completed` within ~60s on
    Ollama (will be much faster on Bedrock).
  - Verify: `SELECT status, finished_at FROM audit_runs ORDER BY started_at
    DESC LIMIT 1` shows `status = 'succeeded'`, `finished_at IS NOT NULL`.

- [ ] **Audit run < 60s** on the fixture (matches `plan.md` §4.5 budget).
  - On Ollama, this is a soft target (gemma is slow); the budget is for
    Bedrock. Track the durationMs returned in `AuditJobResult` and log it.

- [ ] **Re-running with no changes produces identical scores**.
  - How: run audit twice in succession (no notes changed, no syllabus
    changed). For both runs:
    ```sql
    SELECT concept_id, state, depth, mentions, sources, fragments
    FROM mastery_scores WHERE audit_run_id = $RUN
    ORDER BY concept_id;
    ```
    Diff the two result sets. They MUST be identical.
  - Caveat: only true with `temperature = 0` on Haiku (set this in
    `align.ts`). On Ollama, gemma is also temperature-controllable; verify
    the env passes through.

- [ ] **`concept_fragment_links` rows persist with correct shape**.
  - How: pick one concept that should have ≥ 1 link. Query:
    ```sql
    SELECT verdict, COUNT(*), MIN(similarity), MAX(similarity)
    FROM concept_fragment_links
    WHERE audit_run_id = $RUN AND concept_id = $CONCEPT
    GROUP BY verdict;
    ```
  - Verify: `verdict` ∈ {engages, mentions} only (off-topic and tangential
    are dropped during alignment); similarity values are between
    `amberSimilarity` (0.55) and 1.0.

- [ ] **Audit screen renders with the right state per concept**.
  - How: open `/audit/$subjectId` after a run. Each concept row should
    show one `cov-pill` matching the DB's `mastery_scores.state`.
  - Verify: open three concepts (one green, one amber, one red on the
    fixture) — the badge text should be "covered", "incomplete", "missing"
    respectively.

- [ ] **Clicking a "missing" concept shows the structured trace; the trace
  cites the actual fragments considered**.
  - How: click a red-state concept. The side drawer should display the
    top fragments with similarity score + verdict pill. If the concept had
    zero matching fragments above 0.55, show empty state copy: *"No
    fragments matched. Add notes that engage with this concept to start
    building coverage."*
  - Verify: click "see all evidence" — the deep-trace fetch
    (`GET /api/audit/runs/:id?conceptId=…`) returns up to 20 fragments;
    drawer paints them.

- [ ] **The UI updates without a full reload when a run completes**.
  - How: trigger a run, watch the spinner. When `useAsyncJob` reports
    `state = 'completed'`, the `useEffect` should call
    `queryClient.invalidateQueries(["audit", "latest", subjectId])`. The
    next render must show the new totals + state badges.
  - Verify: open browser devtools; observe one new `GET /api/subjects/:id/audit/latest`
    fetch fire after the job completes. No full-page reload.

- [ ] **Failure surface renders when the job errors**.
  - How: temporarily break the prompt (e.g. set `maxTokens: 1` on the
    Haiku call) to force a parse failure. Trigger an audit. The error
    banner should render with the failure reason text. The "Run audit"
    button should be re-enabled so the user can retry.

- [ ] **Empty state when no run exists yet**.
  - How: on a fresh subject (no `audit_runs` rows), the screen should
    render the empty-state CTA, not a row of all-red concepts. Verify by
    DELETE-ing all `audit_runs` rows for the test subject and reloading.

- [ ] **Filter chips work**.
  - How: click "Missing" — only red concepts visible. Click "Covered" —
    only green concepts visible. Click "All concepts" — everything back.
  - Verify: counts in chip badges match `latestQ.data.totals`.

### 10.3 Eval-harness scaffolding (deliverable but not gating)

The agent should set up the eval-harness scaffolding even though Bedrock
isn't live. Concretely:

- Add `apps/server/__eval__/verdicts.json` — empty array OR a placeholder
  set of 5 hand-labelled tuples to prove the runner works. Real 200-tuple
  fixture lands when we have a labelling session scheduled (out of the
  agent's scope).
- Add `apps/server/__eval__/verdicts.test.ts` — the Vitest entry point.
  When the corpus has < 200 tuples, log a warning and pass; when ≥ 200,
  enforce the 0.85 gate.
- Same shape for `gaps.test.ts` and the existing
  `syllabus-extraction.test.ts` already present in Phase 2.

---

## 11. Phase 3 file checklist

Concrete additions / edits, grouped by package, for the implementing agents
to tick off:

### `packages/db/`

- [ ] `migrations/0004_phase3_audit.sql` — new file (§1.1).
- [ ] `src/schema/audit.ts` — new file (§1.2).
- [ ] `src/schema/index.ts` — re-export `audit` (§1.3).

### `packages/audit-core/`

- [ ] `src/types.ts` — extend `Thresholds` with two optional fields (§2.2).
- [ ] `src/thresholds.ts` — extend `DEFAULT_THRESHOLDS` (§2.2).
- [ ] `src/verdict-helpers.ts` — new file (§2.3).
- [ ] `src/index.ts` — re-export `verdict-helpers` (§2.3).

### `apps/server/src/`

- [ ] `ai/json.ts` — new shared LLM-JSON parser (§6.1).
- [ ] `syllabus/job.ts` — replace inline parser with `parseLlmJson` import (§6.2).
- [ ] `audit/align.ts` — new file (§3.1).
- [ ] `audit/score.ts` — new file (§3.2).
- [ ] `audit/gaps.ts` — new file (§3.3).
- [ ] `audit/prompt.ts` — new file (§3.4).
- [ ] `audit/job.ts` — new file (§3.5).
- [ ] `audit/router.ts` — new file (§3.6).
- [ ] `queue/index.ts` — add `audit` queue + worker + `enqueueAuditRun` (§4).
- [ ] `index.ts` — `app.route("/", auditRouter)` (§5).
- [ ] `__eval__/verdicts.test.ts` — eval scaffolding (§10.3).
- [ ] `__eval__/gaps.test.ts` — eval scaffolding (§10.3).

### `apps/web/src/`

- [ ] `styles/globals.css` — add `screen-audit.css` import (§7.1).
- [ ] `api/audit.ts` — new file (§7.2).
- [ ] `routes/_auth/audit.$subjectId.tsx` — replace placeholder (§7.3).
- [ ] `screens/audit/AuditHeader.tsx` — new file (§7.4).
- [ ] `screens/audit/EmptyAuditState.tsx` — new file (§7.4).
- [ ] `screens/audit/FilterRow.tsx` — new file (§7.4).
- [ ] `screens/audit/UnitBlock.tsx` — new file (§7.4).
- [ ] `screens/audit/ConceptRow.tsx` — new file (§7.4).
- [ ] `screens/audit/ConceptDrawer.tsx` — new file (§7.4).
- [ ] `screens/audit/DepthBar.tsx` — new file (§7.4).

### `prod-changes.md`

- [ ] Append `## Phase 3 dev shortcuts` section (§8).

---

## 12. Build / migration sequence for the implementing agent

When dropping all of the above in, do it in this order to minimise the
fix-the-imports churn:

1. `packages/db/src/schema/audit.ts` + `index.ts` re-export. Run
   `pnpm --filter @noeticai/db build`.
2. `packages/db/migrations/0004_phase3_audit.sql`. The next server boot
   applies it.
3. `packages/audit-core/src/*` updates. Run
   `pnpm --filter @noeticai/audit-core build`.
4. `apps/server/src/ai/json.ts` + `syllabus/job.ts` refactor. Run
   `apps/server/src/syllabus/parse.test.ts` to confirm the move.
5. `apps/server/src/audit/*` files in dependency order: `prompt.ts` →
   `align.ts` → `score.ts` → `gaps.ts` → `job.ts` → `router.ts`.
6. `apps/server/src/queue/index.ts` add the audit queue + worker +
   enqueue helper.
7. `apps/server/src/index.ts` mount the router.
8. Boot the server. The migration applies. Run a smoke audit on the stub
   fixture.
9. `apps/web/src/api/audit.ts` + screen components.
10. `apps/web/src/routes/_auth/audit.$subjectId.tsx`.
11. `apps/web/src/styles/globals.css` import.
12. `apps/web/src/routeTree.gen.ts` regenerates on `pnpm --filter
    @noeticai/web dev`.

End state: `/audit/$subjectId` renders live data; "Run audit" button works
end-to-end; clicking a concept opens the drawer with top-3 previews from
the bundled latest payload.

---

## 13. Risks, with one-liners

- **R1: Cross-join in alignment SQL exceeds 2s for large subjects.** Mitigation:
  switch to per-concept `LIMIT 20` queries in a JS loop. Triggered when
  fragment count > 1K or query latency observed > 2s.
- **R2: Haiku JSON output drifts on Bedrock vs Ollama.** Mitigation:
  shared `parseLlmJson` already absorbs both. Eval harness re-runs at the
  Bedrock cutover catch contract drift.
- **R3: Audit re-runs are not deterministic.** Mitigation: `temperature = 0`
  on Haiku, and the alignment SQL is fully deterministic (pgvector ordering
  is stable for distinct distances; ties are concept-internal and don't
  affect the verdict step).
- **R4: A subject with zero embedded fragments emits all-red.** Acceptable
  behaviour — surfaced honestly. The empty-state UI handles "no run yet";
  a "no notes ingested" surface is a Phase 1 concern.
- **R5: BullMQ audit job concurrency=1 starves while a long run is in
  flight.** Mitigation: documented in `prod-changes.md` §7. Audit runs are
  user-initiated and rare; single-concurrency is the right default until
  workers are split.
- **R6: The model_id mismatch invariant gets violated silently.** Mitigation:
  `align.ts` should `console.warn` if it received zero candidates from a
  syllabus that has > 0 concepts and > 0 fragments — likely sign of
  model_id drift between the two sides. Fast diagnostic.

---

End of Phase 3 playbook.
