# Phase 4 implementation playbook — Bibliography ingest (PDF + URL → chunks → embeddings → retrieval)

> Reader assumed to have `implementation.md` (Phase 4 starts at line 185) and
> `plan.md` (§1.6 retrieval, §3 module layout, §5 schema, §10 D13) open.
> No completion code in this phase — Phase 5 consumes what we build here.
> Validation gate: 50-page fixture chunk count in expected range; chapter/pages
> match on ≥ 8/10 spot checks; source-retrieval recall ≥ 0.8 on
> `__eval__/source-recall.json`; status pill updates without reload; polling
> stops when no source is mid-processing.
>
> Two engineering agents will execute this:
> - `senior-backend-engineer` owns sections 1–6, 8, 10.
> - `frontend-react-craftsman` owns section 7.
>
> Path conventions: every path below is absolute relative to the repo root
> `/Users/tomasizuel/Documents/Self/episteme/`. Backend in `apps/server/`
> (Bun + Hono), web app in `apps/web/` (Vite SPA, TanStack Router/Query),
> shared packages in `packages/`.

---

## 0. TL;DR for both agents

- Mirror the **`syllabus/` module** for upload + storage + extract + job + router. Mirror the **`audit/` module** for the multi-step job orchestration (status lifecycle persisted in DB; failure_reason on error). Mirror the **ingest pipeline** for the embed batch + concurrency loop.
- One queue named `source-ingest`, **concurrency = 2** (justified §2.4). Single job that runs the whole pipeline (extract → chunk → embed → mark ready) — no fan-out.
- One Drizzle schema file at `packages/db/src/schema/bibliography.ts`. One SQL migration `packages/db/migrations/0005_phase4_bibliography.sql`. HNSW cosine index on `source_chunk_embeddings.vector`.
- Single entry endpoint `POST /api/sources` with a discriminator (multipart for PDF; JSON for URL). Recommended over two endpoints — see §6.1.
- v1 URL ingest = server-side fetch + crude HTML-tag-strip. **Do not** add `@mozilla/readability` yet (recommended v1.1 upgrade — §4).
- Frontend: `subjectId` resolves from a search-param on `/bibliography?subjectId=…`, with a fallback to "first subject from `GET /api/subjects`" so the screen is not broken when the topbar switcher does not exist yet (§7.1).
- v1 chunking = page-aware extraction (per-page text via `unpdf`'s default `mergePages: false`), paragraph-aware sliding window of ~2000 chars (~500 tokens) with ~200-char overlap. **Skip chapter-label detection in v1 — leave `chapter_label = null`** (§3.4). Punt is tracked in prod-changes.md.
- All embed work uses `embed.defaultModelId` (the same model on both sides of alignment per `plan.md` §4.2). Re-use the batch pattern from `apps/server/src/syllabus/job.ts` (BATCH_SIZE=8, CONCURRENCY=2). Idempotent skip-if-already-embedded.

---

## 1. DB schema additions

### 1.1 Migration file

Create `packages/db/migrations/0005_phase4_bibliography.sql`. The migration runner is `runMigrations(pool)` invoked from `apps/server/src/index.ts:51` at boot — it discovers files in `packages/db/migrations/` lexicographically. No further wiring needed beyond dropping the file in.

```sql
-- Phase 4 — bibliography: sources, chunks, chunk embeddings.
-- Builds on Phase 1's subjects table.

-- ---------------------------------------------------------------------------
-- sources: one row per uploaded PDF or pasted URL. The blob/text is
-- materialised by the ingest job; the row is created in 'uploading' state at
-- POST time and walks the lifecycle:
--   uploading → chunking → embedded → ready
--                ↘ failed                 (terminal, with failure_reason)
--                ↘ partial                (terminal — extracted some text but hit a recoverable cap;
--                                          rare in v1, reserved for v1.1 OCR/long-PDF fallback)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                        -- pdf|url
  title TEXT NOT NULL,                       -- user-supplied or filename / URL host fallback
  author TEXT,                               -- v1: nullable; populated by user later if surfaced in UI
  year INTEGER,                              -- v1: nullable
  status TEXT NOT NULL,                      -- uploading|chunking|embedded|ready|failed|partial
  -- For PDFs: relative path under apps/server/uploads/sources/ (mirrors syllabuses pattern).
  source_path TEXT,
  source_filename TEXT,
  -- For URLs: the canonical URL we fetched, plus the on-disk cached HTML/text.
  external_url TEXT,
  fetched_at TIMESTAMP,
  page_count INTEGER,
  byte_count INTEGER,
  failure_reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sources_subject_idx ON sources(subject_id);
CREATE INDEX IF NOT EXISTS sources_subject_status_idx ON sources(subject_id, status);

-- ---------------------------------------------------------------------------
-- source_chunks: one row per content slice. position is monotonic within a
-- source. chapter_label is NULL in v1 (chapter detection deferred — see
-- prod-changes.md). pages_label is "p. 12" or "pp. 12–14" — built from the
-- per-page extraction. text is plain UTF-8.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS source_chunks (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  chapter_label TEXT,                        -- v1: always NULL; reserved
  pages_label TEXT,                          -- "p. 12" or "pp. 12–14"; NULL for URL kind
  text TEXT NOT NULL,
  text_hash TEXT NOT NULL,                   -- sha256(text) — drives skip-if-already-embedded
  char_count INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (source_id, position)
);

CREATE INDEX IF NOT EXISTS source_chunks_source_idx ON source_chunks(source_id);

-- ---------------------------------------------------------------------------
-- source_chunk_embeddings: one vector per (chunk, model_id). Same shape as
-- note_fragment_embeddings + concept_embeddings (dim 1024). HNSW cosine
-- index for retrieval. Row is added by the embed step; a chunk with no row
-- under the active model has not been embedded yet under that model.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS source_chunk_embeddings (
  chunk_id TEXT NOT NULL REFERENCES source_chunks(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  dim INTEGER NOT NULL,
  vector vector(1024) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chunk_id, model_id)
);

-- HNSW for cosine retrieval. m=16, ef_construction=64 match the existing
-- note_fragment_embeddings + concept_embeddings indexes — keep the knobs
-- consistent across all embedding tables until a recall regression forces
-- per-table tuning.
CREATE INDEX IF NOT EXISTS source_chunk_embeddings_vector_hnsw
  ON source_chunk_embeddings
  USING hnsw (vector vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

### 1.2 Drizzle schema file

Create `packages/db/src/schema/bibliography.ts`:

```ts
import {
  pgTable, text, integer, timestamp, primaryKey, unique, index,
} from "drizzle-orm/pg-core";
import { subjects } from "./ingest";
import { vector } from "./types";

export const sources = pgTable(
  "sources",
  {
    id: text("id").primaryKey(),
    subjectId: text("subject_id").notNull().references(() => subjects.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),                // pdf|url
    title: text("title").notNull(),
    author: text("author"),
    year: integer("year"),
    status: text("status").notNull(),            // uploading|chunking|embedded|ready|failed|partial
    sourcePath: text("source_path"),
    sourceFilename: text("source_filename"),
    externalUrl: text("external_url"),
    fetchedAt: timestamp("fetched_at"),
    pageCount: integer("page_count"),
    byteCount: integer("byte_count"),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    bySubject: index("sources_subject_idx").on(t.subjectId),
    bySubjectStatus: index("sources_subject_status_idx").on(t.subjectId, t.status),
  }),
);

export const sourceChunks = pgTable(
  "source_chunks",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id").notNull().references(() => sources.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    chapterLabel: text("chapter_label"),
    pagesLabel: text("pages_label"),
    text: text("text").notNull(),
    textHash: text("text_hash").notNull(),
    charCount: integer("char_count").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    bySource: index("source_chunks_source_idx").on(t.sourceId),
    sourcePositionUq: unique("source_chunks_source_position_uq").on(t.sourceId, t.position),
  }),
);

export const sourceChunkEmbeddings = pgTable(
  "source_chunk_embeddings",
  {
    chunkId: text("chunk_id").notNull().references(() => sourceChunks.id, { onDelete: "cascade" }),
    modelId: text("model_id").notNull(),
    dim: integer("dim").notNull(),
    vector: vector("vector", 1024).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.chunkId, t.modelId] }) }),
);
```

Then add `export * from "./bibliography";` to `packages/db/src/schema/index.ts` (after the existing audit export). The `vector` helper at `packages/db/src/schema/types.ts` is already in use by `concept_embeddings` + `note_fragment_embeddings` — re-use it as-is.

### 1.3 Status state machine

Single column, enum-by-convention (text + check at app layer; matches existing `syllabuses.status` discipline):

```
        ┌─────────────┐
POST → │ uploading   │  (row created at POST time, before queue ack)
        └──────┬──────┘
               │ enqueueSourceIngest succeeds → job pulls row
               ▼
        ┌─────────────┐
        │ chunking    │  (extract text, slice into chunks, persist source_chunks)
        └──────┬──────┘
               │ chunks persisted; embed step starts
               ▼
        ┌─────────────┐
        │ embedded    │  (all chunks have an embedding row under embed.defaultModelId)
        └──────┬──────┘
               │ no further work — terminal "happy" state
               ▼
        ┌─────────────┐
        │ ready       │  (final terminal — UI renders pill green; equivalent to embedded
        │             │   for v1, kept distinct so a future "verify retrievable" step can
        │             │   sit between embedded and ready without breaking the UI)
        └─────────────┘

Any step throws → status='failed' + failure_reason (mirrors processSyllabusJob /
processAuditJob). 'partial' is reserved for v1.1 (e.g. text extracted but
embed quota throttled mid-run).
```

**Decision: keep `embedded` and `ready` distinct.** v1 transitions `embedded → ready` immediately at end-of-job (single SQL update). v1.1 gets a chance to insert a verification step (e.g. "run a smoke retrieval against this source's chunks; mark ready only if it returns at least one match for its own title"). This shape costs zero now and saves a migration later.

**Status invariants at the DB level**: the migration above does NOT add a CHECK constraint on `status`. The audit + syllabus tables don't have one either; we keep that consistency. App-layer responsibility.

---

## 2. Server module layout — `apps/server/src/bibliography/`

### 2.1 Files to add

```
apps/server/src/bibliography/
  router.ts        — Hono router, mounts under /api/sources + /dev
  storage.ts       — local-FS PDF blob storage (mirrors syllabus/storage.ts)
  fetch-url.ts     — server-side URL fetch + crude HTML strip (v1 only)
  extract.ts       — page-aware PDF extraction via unpdf (returns {pages: string[], pageCount})
  chunker.ts       — pure fn: pages | text → SourceChunk[] (paragraph-aware sliding window)
  job.ts           — processSourceIngestJob: runs extract → chunk → embed → ready
  retrieve.ts      — pure fn: query string → top-k chunk rows (used by /dev/retrieve-source)
```

These files mirror the syllabus + audit + ingest patterns one-to-one. The folder boundary is the same as `plan.md` §3 (`apps/server/src/bibliography/` is the module). No new package — promotion to `packages/` only if a second consumer appears (per `plan.md` §3 "no `@noeticai/grounding` package" rationale).

### 2.2 Wiring into `apps/server/src/index.ts`

Add (in import order matching the existing file):

```ts
import { bibliographyRouter } from "./bibliography/router";
// …
app.route("/", bibliographyRouter);
```

No middleware changes. Auth is per-route (mirror `syllabusRouter`).

### 2.3 Queue wiring — `apps/server/src/queue/index.ts`

Add to the `queues` object and to `startWorkers`:

```ts
import { processSourceIngestJob, type SourceIngestResult } from "../bibliography/job";

export interface SourceIngestJobData {
  sourceId: string;
  userId: string;
}

// In the queues object:
sourceIngest: new Queue<SourceIngestJobData, SourceIngestResult>("source-ingest", {
  connection: redis,
}),

// In startWorkers (mirror syllabusWorker pattern):
const sourceIngestWorker = new Worker<SourceIngestJobData, SourceIngestResult>(
  "source-ingest",
  async (job) => processSourceIngestJob(job.data),
  { connection: redis, concurrency: 2 },   // see §2.4 rationale
);
sourceIngestWorker.on("error", (err) => {
  console.error("[queue:source-ingest] worker error:", err.message);
});
sourceIngestWorker.on("failed", (job, err) => {
  console.error(`[queue:source-ingest] job=${job?.id} failed:`, err.message);
});

export async function enqueueSourceIngest(
  data: SourceIngestJobData,
  opts?: JobsOptions,
): Promise<string> {
  const job = await queues.sourceIngest.add("source:ingest", data, opts);
  if (!job.id) throw new Error("BullMQ did not return a job id");
  return job.id;
}
```

**`lookupJob` already iterates over `queues` — no change needed**; the new queue is auto-discovered.

### 2.4 Concurrency choice — **2** (NOT 1 like syllabus, NOT 4)

| Queue | Concurrency | Reason |
|-------|-------------|--------|
| `syllabus` | 1 | Opus is heavy + rare; one Opus call at a time keeps cost predictable |
| `audit` | 1 | Haiku × 80 fan-out per run; serialise for in-process Bun event-loop responsiveness (prod-changes §7) |
| `ingest` | 2 | Cohere-quota-friendly fixture ingest |
| **`source-ingest`** | **2** | See below |

A bibliography source ingest is **embed-heavy, not LLM-heavy** — a 50-page PDF chunks to ~150 chunks at ~500 tokens each, which is ~19 `embed.embed()` calls at BATCH_SIZE=8 (well under Cohere's 96-text limit). PDF extraction itself is CPU-bound but fast (<2s for 50 pages with `unpdf`). Two jobs in flight saturates one of:

- Cohere/Bedrock embed quota (the binding limit at scale).
- The Bun event loop while two `unpdf` parses run concurrently.

Justification for 2 over 1: a user pasting two URLs in quick succession should not wait for the first to complete before the second starts — this is exactly what a queue is for. Justification for 2 over 4: prod-changes.md §7 still has us in the single-process model; we share CPU with the HTTP server and the audit worker. Lift to 4 in the same PR that splits `apps/worker` from `apps/server`, alongside the audit-worker bump tracked in prod-changes.md §7.

**Retry policy**: pass `attempts: 1` from `enqueueSourceIngest` (mirror audit's `enqueueAuditRun` call site) for v1. The job's own try/catch persists `failure_reason`. Auto-retry on transient errors (Bedrock 503, Cohere quota throttle) is a v1.1 task — exponential backoff per `plan.md` §9 retry block — not phase-4 scope. Document the gap in prod-changes.md.

### 2.5 Idempotency

Three points where idempotency matters:

1. **Source row creation at POST**: content-addressed `id` = `sha256(subjectId + kind + (sourcePath or externalUrl)).slice(0, 24)`. `INSERT … ON CONFLICT (id) DO NOTHING`. A double-POST (network retry on the client) returns the same id and a 200, not a 409.
2. **Chunk insertion in the job**: chunk `id` = `sha256(sourceId + position + textHash).slice(0, 24)`. `ON CONFLICT (id) DO NOTHING`. A re-run after partial failure does not duplicate chunks.
3. **Embedding step**: same skip-if-already-embedded pattern as `apps/server/src/syllabus/job.ts:237-246` and `apps/server/src/ingest/pipeline.ts:108-130`. Filter `source_chunk_embeddings WHERE model_id = $1 AND chunk_id = ANY($2::text[])`, embed only the missing ones.

A `POST /api/sources/:id/reindex` (§6.5) DELETEs all chunks + embeddings for the source, sets `status='uploading'`, re-enqueues. Reindex is the explicit user action; the job itself is otherwise idempotent.

---

## 3. Chunking strategy

### 3.1 Page-aware extraction

Replace the merged-pages call from `apps/server/src/syllabus/extract.ts` with a per-page variant in `apps/server/src/bibliography/extract.ts`:

```ts
import { extractText, getDocumentProxy } from "unpdf";

export interface ExtractedPdfPages {
  pages: string[];        // index 0 = page 1
  pageCount: number;
}

export async function extractPdfPages(bytes: Uint8Array): Promise<ExtractedPdfPages> {
  const pdf = await getDocumentProxy(bytes);
  // mergePages: false (the default) returns text per page.
  const result = await extractText(pdf, { mergePages: false });
  // unpdf's typing on `text` differs slightly between versions; coerce.
  const pages = Array.isArray(result.text)
    ? (result.text as string[])
    : [result.text as string];
  return { pages, pageCount: result.totalPages };
}
```

Per-page extraction is the load-bearing change. It is what makes `pages_label` accurate without inventing it post-hoc.

### 3.2 Chunk shape

```ts
export interface SourceChunk {
  position: number;       // 0-indexed, monotonic within source
  text: string;           // plain UTF-8, NFC-normalised, whitespace-collapsed
  textHash: string;       // sha256(text) — for skip-if-embedded
  pagesLabel: string | null;  // "p. 12" or "pp. 12–14"; null for URL ingest
  chapterLabel: string | null; // v1: always null
  charCount: number;
}
```

### 3.3 Chunking algorithm — paragraph-aware sliding window

Decision: **paragraph-aware sliding window**, NOT fixed token windows. Justification:

- Fixed token windows break sentences mid-word and degrade retrieval relevance — this matters more for the bibliography (cited as evidence) than for note fragments (signals only).
- Pure paragraph splits produce wildly varying chunk sizes (some philosophy-PDF paragraphs are 3000+ chars; others are 50). HNSW recall is more stable when chunks are size-bounded.
- Sliding window with a paragraph-respecting boundary preference is the defensible compromise.

Algorithm (in `apps/server/src/bibliography/chunker.ts`):

```
TARGET_CHARS = 2000          # ~500 tokens at ~4 chars/token; comfortably fits Cohere's per-text limit
OVERLAP_CHARS = 200          # ~50 tokens; preserves cross-boundary meaning for retrieval
HARD_MAX_CHARS = 3000        # never exceed (paragraph-respecting only when feasible)
MIN_CHARS = 200              # discard / merge dust from page footers, headers, page numbers
```

For each page (PDF) or for the whole document (URL):

1. Normalise: `\r\n → \n`, NFC, collapse runs of whitespace, trim.
2. Split on `\n{2,}` to get paragraphs. Drop paragraphs shorter than 30 chars (almost always page numbers / headers / footers).
3. Greedy accumulate paragraphs into a buffer until `buffer.length + nextPara.length > TARGET_CHARS`.
   - If the next paragraph alone exceeds `HARD_MAX_CHARS`, hard-split it on sentence boundaries (`/(?<=[.!?])\s+/`), then char-window the result if even sentences are too long.
4. Emit a chunk. Begin the next chunk with the **last paragraph** (or last ~`OVERLAP_CHARS` of paragraph text) of the previous one as overlap.
5. Track `pagesSpanned: Set<number>` per chunk by tagging each input paragraph with its source page (from the per-page extraction). Build `pagesLabel`:
   - Single page: `"p. 12"`.
   - Spans pages 12–14: `"pp. 12–14"` (en-dash). If pages are non-contiguous (rare; happens at page-break splits), use the first and last: `"pp. 12, 14"` is intentionally NOT supported in v1 — collapse to `"pp. 12–14"` and note the slight imprecision.
6. Persist as `source_chunks` row.

URL-ingest path skips per-page entirely: the entire fetched-and-stripped text is fed to the same chunker with `pagesLabel = null`.

### 3.4 Chapter-label detection — **punted for v1**

Decision: **leave `chapter_label = NULL` in v1.** Rationale:

- A heuristic regex for chapter headings (`/^(chapter\s+\d+|capítulo\s+\d+|^\d+\.\s+[A-ZÁÉÍÓÚ])/im`) over per-page text gives ~60% precision on philosophy PDFs (false positives: section numbers in footnotes, table-of-contents stragglers).
- Wrong chapter labels in citations are a **trust-burning** failure mode (per `plan.md` §12 risk 13). Better to show pages-only than to guess wrong.
- A real chapter detector needs PDF outline (bookmarks) extraction + heading-style detection, which `unpdf` exposes via `pdf.getOutline()`. v1.1 task; out of scope for hitting Phase 4's gate.
- Frontend will surface "p. 12" with no chapter alongside it cleanly. The schema column stays — populating it later is a backfill, not a migration.

**Add to prod-changes.md** (§9 below): "Bibliography chapter labels deferred — `source_chunks.chapter_label` is always NULL in v1. v1.1: use `pdf.getOutline()` from unpdf to map page → chapter."

### 3.5 Chunk size — opinionated default

`TARGET_CHARS = 2000` (~500 tokens) and `OVERLAP_CHARS = 200` (~50 tokens, ~10%) is the recommendation.

Why not the larger end of the spec's range (2400-3200 chars / ~800 tokens)?

- Cohere `embed-multilingual-v3` and `embed-english-v3` have per-text input limits (512 tokens recommended; up to ~1000 ok). Going above ~500 tokens trims relevance-per-vector AND drifts toward the input cap. We want a margin.
- Phase 5 retrieval will pull top-k=10 chunks per gap (`plan.md` §1.6.1). Smaller chunks = finer-grained citations = the citation drawer surfaces a relevant 2000-char passage rather than a 4000-char wall.

Tunable via constants at the top of `chunker.ts`. If validation gate (§10) shows recall < 0.8, the first lever is to **reduce** TARGET_CHARS to 1200 (more, finer chunks), not increase it.

### 3.6 Chunk count expectation for the 50-page fixture

The validation gate says "chunk count within expected range" but doesn't pin a number. Pin it now to remove ambiguity:

- 50 pages × ~1800 chars per page (typical academic English PDF) ≈ 90,000 chars total.
- At TARGET_CHARS=2000 with OVERLAP_CHARS=200, the effective stride is ~1800. Expected chunks ≈ 90,000 / 1800 ≈ 50.
- **Acceptance band: 35 ≤ chunkCount ≤ 75.** Outside that band = a bug in the chunker (look at paragraph splitting or page extraction).

Encode this in the eval test (`§10`).

---

## 4. URL ingest path

### 4.1 v1 — server-side fetch + crude HTML strip

`apps/server/src/bibliography/fetch-url.ts`:

```
1. Validate URL: must be http(s); reject file://, javascript:, etc.
2. fetch(url, { redirect: "follow", headers: { "User-Agent": "NoeticAI/1.0 (bibliography-ingest)" } })
   - Cap response size at 5 MB (read with a streaming reader; abort if exceeded).
   - Cap redirect chain at 5.
   - Timeout at 15 s (AbortController).
3. Read response body as text (assume UTF-8; if charset is declared in Content-Type, honour it).
4. If the response is text/plain → use the body as-is.
5. If it's text/html → strip:
   a. Remove <script>…</script> and <style>…</style> blocks (greedy, case-insensitive).
   b. Remove <nav>, <header>, <footer>, <aside>, <form> blocks (greedy).
   c. Strip remaining tags (/<[^>]+>/g → "").
   d. Decode HTML entities (use `he` package if not already present;
      otherwise hand-roll a 6-entity table: amp/lt/gt/quot/apos/nbsp).
   e. Collapse whitespace (\s+ → " "), then split on sentence-paragraph
      heuristics (period followed by capital ⇒ paragraph, OR ≥ 2 newlines).
6. Persist source_filename = null, external_url = the canonical URL,
   fetched_at = NOW(), byte_count = stripped-text length.
7. Feed the stripped text into the same chunker with pagesLabel=null.
```

**Decision: do NOT add `@mozilla/readability` in v1.** Justification:

- Readability requires JSDOM to parse HTML into a DOM. That's ~15 MB of dep weight on the server bundle and a non-trivial parse cost (~50 ms per page) — measurable for the few-sources-per-user case but not zero.
- The crude tag-strip hits ~85% of "blog post / paper abstract" pages well enough — academic SEP-style pages, blog posts, and most non-paywall paper landing pages render usable text.
- The failure mode is "extracted text is noisy" (nav menus showing up in chunks) — that surfaces as low retrieval recall, which we will see on the eval gate. If recall < 0.8 specifically because of URL-source noise, bring readability in then. Don't pre-pay the dep cost.

### 4.2 v1.1 upgrade path

Add `@mozilla/readability` + `jsdom` (or `linkedom` — lighter) when the eval shows URL-source noise dominating recall failures. Replace the strip step (4-5) with `Readability.parse()`. The chunker stays unchanged; this is a swap-in at the fetch boundary.

Track in prod-changes.md (§9 below): "URL ingest uses crude HTML-tag-strip in v1; upgrade to `@mozilla/readability` if URL-source recall regresses."

### 4.3 Failure modes surfaced to the user

- HTTP 4xx/5xx → status='failed', failure_reason="URL returned HTTP {status}".
- Content-Type not text/* → status='failed', failure_reason="URL is not HTML or plain text (got {ct})".
- Body > 5 MB → status='failed', failure_reason="URL response exceeds 5 MB cap".
- Stripped text < 200 chars after stripping → status='failed', failure_reason="URL produced no extractable text (likely paywalled or JS-only)".

These map directly to the failure-state UI in §7.

---

## 5. Embedding wiring

Mirror **`apps/server/src/syllabus/job.ts` lines 230-283** verbatim with `concept_embeddings` swapped for `source_chunk_embeddings` and `concept_id` for `chunk_id`.

```ts
const EMBED_CONCURRENCY = 2;
const EMBED_BATCH_SIZE = 8;

const modelId = embed.defaultModelId;       // SAME as Phase 1/2 — the alignment invariant

// 1. Skip-if-already-embedded.
const haveEmbeddings = new Set<string>();
if (chunksToEmbed.length > 0) {
  const existing = await pool.query<{ chunk_id: string }>(
    `SELECT chunk_id FROM source_chunk_embeddings
     WHERE model_id = $1 AND chunk_id = ANY($2::text[])`,
    [modelId, chunksToEmbed.map((c) => c.id)],
  );
  for (const r of existing.rows) haveEmbeddings.add(r.chunk_id);
}
const todo = chunksToEmbed.filter((c) => !haveEmbeddings.has(c.id));

// 2. Batch + concurrency.
const batches: Array<typeof todo> = [];
for (let i = 0; i < todo.length; i += EMBED_BATCH_SIZE) {
  batches.push(todo.slice(i, i + EMBED_BATCH_SIZE));
}

for (let i = 0; i < batches.length; i += EMBED_CONCURRENCY) {
  const slice = batches.slice(i, i + EMBED_CONCURRENCY);
  const results = await Promise.all(
    slice.map((batch) =>
      embed.embed({ texts: batch.map((b) => b.text), inputType: "search_document" }),
    ),
  );
  for (let bi = 0; bi < slice.length; bi += 1) {
    const batch = slice[bi]!;
    const embedResult = results[bi]!;
    if (embedResult.dim !== 1024) {
      throw new Error(`embed returned dim=${embedResult.dim}, expected 1024`);
    }
    for (let vi = 0; vi < batch.length; vi += 1) {
      const item = batch[vi]!;
      const vec = embedResult.vectors[vi]!;
      await pool.query(
        `INSERT INTO source_chunk_embeddings (chunk_id, model_id, dim, vector)
         VALUES ($1, $2, $3, $4::vector)
         ON CONFLICT (chunk_id, model_id) DO NOTHING`,
        [item.id, modelId, embedResult.dim, `[${vec.join(",")}]`],
      );
    }
  }
}
```

Critical invariants:

- **`inputType: "search_document"`** for chunks (matches syllabus + fragments at ingest time). The retrieval `/dev/retrieve-source` endpoint uses `"search_query"`, same asymmetric pattern as `/dev/retrieve` at `apps/server/src/dev/retrieve.ts:21`.
- **`embed.defaultModelId`** is the only model id we touch. **Do not** allow `?model=…` query params or per-call overrides in any endpoint — that breaks Phase 5's same-model retrieval invariant.
- **Bedrock (Cohere v3) returns 1024-dim**; Ollama (`bge-m3`) also returns 1024. The `dim !== 1024` throw is a paranoia rail — it means a misconfigured backend silently swapped the model.

### 5.1 Job orchestration

`apps/server/src/bibliography/job.ts` exports `processSourceIngestJob` mirroring `processSyllabusJob` (`apps/server/src/syllabus/job.ts:306`):

```
runSourceIngestJob:
  1. Load sources row by id; throw if not found.
  2. UPDATE status='chunking'.
  3. If kind='pdf': read bytes from sourcePath, call extractPdfPages.
     If kind='url': call fetchUrl, treat as single "page".
  4. Run chunker → SourceChunk[]. Set chunkCount on the source row + page_count for PDFs.
  5. Persist source_chunks rows (idempotent ON CONFLICT).
  6. Embed step (the loop above).
  7. UPDATE status='embedded'.
  8. (v1: immediate) UPDATE status='ready'.

processSourceIngestJob:
  try { return await runSourceIngestJob(opts) }
  catch (err) {
    // best-effort UPDATE status='failed', failure_reason=err.message
    throw err
  }
```

Mirror the audit job's lifecycle update pattern (`apps/server/src/audit/job.ts:38`) for the status writes — short SQL, no Drizzle wrappers, same `pool.query` style.

---

## 6. Routes — full Hono handler signatures

All handlers mounted on `bibliographyRouter` in `apps/server/src/bibliography/router.ts`. Auth via `auth.api.getSession({ headers: c.req.raw.headers })` — mirror `syllabusRouter`. Subject-ownership check on every handler that takes a `subjectId` or `:id`.

### 6.1 `POST /api/sources` — single endpoint, content-type discrimination

**Recommendation: ONE endpoint, two content types, NOT two endpoints.** Justification:

- The frontend (per `screen-bibliography.jsx`) has two buttons ("Upload PDF" / "Add from URL") that both feed the same list. Two endpoints means two TanStack Query mutations sharing one invalidation key — extra surface for no benefit.
- Content-Type discrimination is a one-line branch on the server.
- Saves the client from the awkward `if isUrl then POST /api/sources/url else POST /api/sources/upload` split.

Handler:

```ts
bibliographyRouter.post("/api/sources", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthenticated" }, 401);
  const userId = session.user.id;

  const ct = c.req.header("content-type") ?? "";

  if (ct.startsWith("multipart/form-data")) {
    // PDF path. Mirrors syllabus/router.ts POST /api/syllabus.
    // FormData fields: file (required, application/pdf, max 25 MB),
    //                  subjectId (required), title (optional, default = filename).
    // 1. Parse + validate FormData.
    // 2. Look up subject; verify ownership (userId match).
    // 3. Cap file size at 25 MB (PDFs are bigger than syllabuses).
    // 4. storeSourcePdf(bytes, originalFilename) → { relativePath, filename, bytes }.
    // 5. id = sha256(subjectId + 'pdf' + relativePath).slice(0, 24).
    // 6. INSERT INTO sources (status='uploading').
    // 7. enqueueSourceIngest({ sourceId: id, userId }).
    // 8. return c.json({ sourceId: id, jobId }, 201).
  } else if (ct.includes("application/json")) {
    // URL path.
    // Body: { subjectId: string, url: string, title?: string }
    // 1. Parse + zod-validate.
    // 2. Look up subject; verify ownership.
    // 3. Validate URL with new URL() (must be http or https).
    // 4. id = sha256(subjectId + 'url' + url).slice(0, 24).
    // 5. INSERT INTO sources (status='uploading', external_url=url).
    // 6. enqueueSourceIngest({ sourceId: id, userId }).
    // 7. return c.json({ sourceId: id, jobId }, 201).
  } else {
    return c.json({ error: "expected multipart/form-data or application/json" }, 400);
  }
});
```

Response shape: `{ sourceId: string; jobId: string }` (matches the existing `POST /api/syllabus` and `POST /api/audit/runs` shape — drives the same `useAsyncJob(jobId)` hook on the client).

### 6.2 `GET /api/sources?subjectId=…` — list

```ts
bibliographyRouter.get("/api/sources", async (c) => {
  const session = await auth.api.getSession(...);
  if (!session) return c.json({ error: "unauthenticated" }, 401);
  const userId = session.user.id;

  const subjectId = c.req.query("subjectId");
  if (!subjectId) return c.json({ error: "subjectId required" }, 400);

  // Ownership check: SELECT id FROM subjects WHERE id=$1 AND user_id=$2.
  // …

  // SELECT s.*, COUNT(sc.id) AS chunk_count FROM sources s
  //   LEFT JOIN source_chunks sc ON sc.source_id = s.id
  //   WHERE s.subject_id=$1
  //   GROUP BY s.id
  //   ORDER BY s.created_at DESC

  return c.json({
    sources: [
      {
        id: "...",
        kind: "pdf" | "url",
        title: "...",
        author: "..." | null,
        year: 1963 | null,
        status: "uploading" | "chunking" | "embedded" | "ready" | "failed" | "partial",
        externalUrl: "..." | null,
        sourceFilename: "..." | null,
        pageCount: 50 | null,
        chunkCount: 0,            // computed
        failureReason: "..." | null,
        createdAt: "...iso...",
        updatedAt: "...iso...",
      },
    ],
  });
});
```

### 6.3 `GET /api/sources/:id` — detail

Returns the source plus chunk previews (NOT full text — the UI shows a preview drawer, not a PDF reader).

```ts
bibliographyRouter.get("/api/sources/:id", async (c) => {
  // auth + ownership via JOIN to subjects.
  // SELECT source row + first 50 chunks ORDER BY position.

  return c.json({
    source: { /* same shape as list item */ },
    chunks: [
      {
        position: 0,
        chapterLabel: null,           // v1 always null
        pagesLabel: "p. 1",
        textPreview: "First 240 chars of the chunk text…",  // truncate server-side
        charCount: 1987,
      },
      // …
    ],
  });
});
```

The 50-chunk cap on the detail endpoint is a UX choice — the drawer shows a "Showing 50 of N chunks" hint when truncated. A full chunk dump is a v1.1 admin endpoint.

### 6.4 `DELETE /api/sources/:id`

```ts
bibliographyRouter.delete("/api/sources/:id", async (c) => {
  // auth + ownership.
  // DELETE FROM sources WHERE id=$1; cascade drops source_chunks + source_chunk_embeddings
  //                                  via the schema FKs.
  // Best-effort: unlink the on-disk PDF (try { await unlink(absolutePath) } catch {}).
  return c.json({ ok: true });
});
```

DELETE wipes the row + cascading children. The on-disk PDF removal is best-effort — a leftover file is a janitor problem, not a correctness problem.

### 6.5 `POST /api/sources/:id/reindex`

```ts
bibliographyRouter.post("/api/sources/:id/reindex", async (c) => {
  // auth + ownership.
  // BEGIN
  //   DELETE FROM source_chunks WHERE source_id=$1;       -- cascades to embeddings
  //   UPDATE sources SET status='uploading', failure_reason=NULL, updated_at=NOW() WHERE id=$1;
  // COMMIT
  // const jobId = await enqueueSourceIngest({ sourceId, userId });
  // return c.json({ sourceId, jobId }, 200);
});
```

Reindex covers two cases: a transient failure (bad fetch, hit cap on first try) and a manual retry from the failure-banner CTA in the UI ("Re-index Klein 1999" in `screen-bibliography.jsx:90`).

### 6.6 `GET /dev/retrieve-source?q=…&subjectId=…&k=…`

Mirror `apps/server/src/dev/retrieve.ts` exactly, swapping `note_fragment_embeddings` for `source_chunk_embeddings`:

```ts
bibliographyRouter.get("/dev/retrieve-source", async (c) => {
  const session = await auth.api.getSession(...);
  if (!session) return c.json({ error: "unauthenticated" }, 401);

  const q = c.req.query("q")?.trim();
  const subjectId = c.req.query("subjectId");
  if (!q) return c.json({ error: "missing q" }, 400);
  if (!subjectId) return c.json({ error: "missing subjectId" }, 400);
  const k = Math.min(Number(c.req.query("k") ?? 5), 20);

  // ownership check on subject.

  const result = await embed.embed({ texts: [q], inputType: "search_query" });
  const queryVec = result.vectors[0];
  if (!queryVec) return c.json({ error: "embed returned no vector" }, 500);
  const literal = `[${queryVec.join(",")}]`;

  const rows = await pool.query<{
    id: string;
    source_id: string;
    source_title: string;
    position: number;
    pages_label: string | null;
    text: string;
    distance: number;
  }>(
    `SELECT
       sc.id,
       sc.source_id,
       s.title AS source_title,
       sc.position,
       sc.pages_label,
       sc.text,
       (e.vector <=> $1::vector) AS distance
     FROM source_chunk_embeddings e
     JOIN source_chunks sc ON sc.id = e.chunk_id
     JOIN sources s ON s.id = sc.source_id
     WHERE s.subject_id = $2 AND e.model_id = $3
     ORDER BY e.vector <=> $1::vector
     LIMIT $4`,
    [literal, subjectId, result.modelId, k],
  );

  return c.json({
    query: q,
    modelId: result.modelId,
    results: rows.rows.map((r) => ({
      id: r.id,
      sourceId: r.source_id,
      sourceTitle: r.source_title,
      position: r.position,
      pagesLabel: r.pages_label,
      text: r.text,
      similarity: 1 - r.distance,
      distance: r.distance,
    })),
  });
});
```

`/dev/retrieve-source` is auth-guarded but **not** subject-ownership-guarded beyond the user-of-subject check — same posture as `/dev/retrieve`. Promote to a real `/api/sources/retrieve` only when Phase 5 wires it into completion (this is a Phase 4 dev endpoint per `implementation.md` line 195).

---

## 7. Frontend — `apps/web/src/routes/_auth/bibliography.tsx`

### 7.1 `subjectId` resolution

The route file is `apps/web/src/routes/_auth/bibliography.tsx`. The Phase-4 question: where does `subjectId` come from when there is no topbar subject switcher yet?

**Recommendation: search-param + fallback to "first subject".**

```ts
export const Route = createFileRoute("/_auth/bibliography")({
  validateSearch: (search) => ({
    subjectId: typeof search.subjectId === "string" ? search.subjectId : undefined,
  }),
  component: BibliographyRoute,
});
```

Then in the component:

1. Read `const { subjectId } = Route.useSearch()`.
2. If undefined, fire `getSubjects()` (added in §7.7 below) and use the first id.
3. Persist the chosen id back to the URL via `navigate({ search: { subjectId } })` so refreshes work.

Justification: the topbar switcher is a Phase 7 task. We don't want to ship a "no subject" empty state when the user has subjects from Phase 2 / Phase 3. The "first subject" fallback is opinionated but keeps the screen useful.

### 7.2 Component breakdown

Create the screen primitives under `apps/web/src/screens/bibliography/` (mirroring the audit-screen pattern at `apps/web/src/screens/audit/`):

```
apps/web/src/screens/bibliography/
  BibliographyHeader.tsx       — title + tagline + summary cells (count, indexed, passages-cited, most-cited)
  StatsRow.tsx                 — the 4-cell grid from screen-bibliography.jsx:18-31
  ToolbarRow.tsx               — search input + "Upload PDF" button + "Add from URL" button
  UploadPdfButton.tsx          — hidden <input type="file"> + label-as-button trigger
  AddUrlForm.tsx               — TanStack Form, controlled-popover input + Add CTA
  SourceList.tsx               — the table (grid) of sources, mirrors screen-bibliography.jsx:43-83
  SourceRow.tsx                — single row with status pill, coverage bar, click handler
  SourceDrawer.tsx             — detail drawer w/ chunk previews + retrieval-test input
  RetrievalTestInput.tsx       — debounced query → calls /dev/retrieve-source, renders top-5
  FailureBanner.tsx            — bottom panel from screen-bibliography.jsx:85-91
  StatusPill.tsx               — small wrapper around .cov-pill.{green|amber|red|neutral}
```

**`subjectId` resolution + the entry route stay in `bibliography.tsx`**; everything else is a composable. This matches the audit-screen split exactly.

### 7.3 TanStack Query keys

```
["sources", "list", subjectId]                   — getSources(subjectId)
["sources", "detail", sourceId]                  — getSource(sourceId)
["sources", "retrieve", subjectId, q]            — runRetrieve(subjectId, q)  (manual; not polled)
["subjects"]                                     — getSubjects()
```

Mutations:
- `uploadPdfMutation`: `POST /api/sources` multipart → on success, `qc.invalidateQueries({ queryKey: ["sources", "list", subjectId] })`.
- `addUrlMutation`: `POST /api/sources` JSON → same invalidation.
- `deleteSourceMutation`: `DELETE /api/sources/:id` → same invalidation.
- `reindexSourceMutation`: `POST /api/sources/:id/reindex` → invalidate list + detail.

### 7.4 Polling strategy — 10 s, stops on terminal

The validation gate explicitly says: "polling stops when no source mid-processing." Implementation:

```ts
const sourcesQ = useQuery({
  queryKey: ["sources", "list", subjectId],
  queryFn: () => getSources(subjectId),
  refetchInterval: (q) => {
    const data = q.state.data;
    if (!data) return 10_000;        // poll while loading
    const anyMidFlight = data.sources.some(
      (s) => s.status === "uploading" || s.status === "chunking" || s.status === "embedded",
    );
    return anyMidFlight ? 10_000 : false;
  },
  // 30 s staleTime so background tab returns don't double-fire.
  staleTime: 30_000,
});
```

Note: `embedded` is non-terminal in our state machine (it transitions to `ready` immediately at end-of-job, but the polling client may catch the in-between state). Treat it as still-polling. `ready`, `failed`, `partial` are terminal — polling stops.

**Do NOT use `useAsyncJob` for source ingest tracking** — that hook polls a single jobId. Here we want to track N sources at once via the list endpoint. Keep `useAsyncJob` for the individual upload-mutation flow if we want a "uploading…" inline-progress on the just-clicked item, but the list itself is the canonical state.

### 7.5 Upload form — pragmatic split

- **PDF upload**: native `<input type="file" accept="application/pdf">` + click-to-pick. No drag-drop in v1 (the audit screen and onboarding already use click-to-pick; consistency wins). On file pick, fire the mutation immediately — no separate "Upload" button, just like `screen-onboarding.jsx`'s syllabus picker.
- **URL form**: TanStack Form (matches the noeticai/web preference per `plan.md` §11.1). Single text field with zod schema (`url: z.string().url()`). Submit fires `addUrlMutation`. Inline error rendering on validation fail.

### 7.6 Detail drawer — local state, NOT a route param

**Recommendation: local state (`useState<string | null>(activeSourceId)`), NOT a route search param.**

Justification:

- The drawer is a transient UI; persisting it to the URL adds shake on browser back/forward and complicates the `subjectId` search-param contract.
- Audit screen does the same: see `apps/web/src/routes/_auth/audit.$subjectId.tsx:67` (`activeConcept` is a `useState`, not a search param).
- A "share this drawer-open" feature is a v1.1 polish; not phase-4 scope.

Drawer renders the detail-endpoint payload. It contains:

- **Top section**: title, author, year, status pill, "p.{first}–p.{last}", chunk count, byte count.
- **Chunk previews**: virtualised list of `{position, pagesLabel, textPreview}`. (TanStack-Table not needed; a plain mapped list of 50 items is fine — the cap is server-enforced.)
- **Retrieval test input**: a debounced search input. On submit (or 300 ms debounce after typing stops), POST to `/dev/retrieve-source?q=…&subjectId=…`. Render top-5 results below the input — `{sourceTitle, pagesLabel, similarity, text-preview-clamped-to-3-lines}`.
- **Footer actions**: "Re-index" button, "Delete" button (with confirm dialog).

### 7.7 New API helper file

Create `apps/web/src/api/sources.ts`:

```ts
import { apiFetch } from "./client";

export type SourceStatus = "uploading" | "chunking" | "embedded" | "ready" | "failed" | "partial";
export type SourceKind = "pdf" | "url";

export interface SourceListItem {
  id: string;
  kind: SourceKind;
  title: string;
  author: string | null;
  year: number | null;
  status: SourceStatus;
  externalUrl: string | null;
  sourceFilename: string | null;
  pageCount: number | null;
  chunkCount: number;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SourceDetail {
  source: SourceListItem;
  chunks: Array<{
    position: number;
    chapterLabel: string | null;
    pagesLabel: string | null;
    textPreview: string;
    charCount: number;
  }>;
}

export interface RetrievalResult {
  query: string;
  modelId: string;
  results: Array<{
    id: string;
    sourceId: string;
    sourceTitle: string;
    position: number;
    pagesLabel: string | null;
    text: string;
    similarity: number;
    distance: number;
  }>;
}

export function getSources(subjectId: string): Promise<{ sources: SourceListItem[] }> {
  return apiFetch(`/api/sources?subjectId=${encodeURIComponent(subjectId)}`);
}

export function getSource(sourceId: string): Promise<SourceDetail> {
  return apiFetch(`/api/sources/${encodeURIComponent(sourceId)}`);
}

export function uploadPdfSource(args: {
  subjectId: string;
  file: File;
  title?: string;
}): Promise<{ sourceId: string; jobId: string }> {
  const fd = new FormData();
  fd.set("subjectId", args.subjectId);
  fd.set("file", args.file);
  if (args.title) fd.set("title", args.title);
  return apiFetch("/api/sources", { method: "POST", body: fd });
  // NOTE: do NOT set content-type here; the browser fills in the boundary.
  // apiFetch's auto content-type-as-json branch only triggers when body
  // is set AND the header isn't present AND body is a string-ish — FormData
  // bypasses it correctly.
}

export function addUrlSource(args: {
  subjectId: string;
  url: string;
  title?: string;
}): Promise<{ sourceId: string; jobId: string }> {
  return apiFetch("/api/sources", {
    method: "POST",
    body: JSON.stringify(args),
  });
}

export function deleteSource(sourceId: string): Promise<{ ok: true }> {
  return apiFetch(`/api/sources/${encodeURIComponent(sourceId)}`, { method: "DELETE" });
}

export function reindexSource(sourceId: string): Promise<{ sourceId: string; jobId: string }> {
  return apiFetch(`/api/sources/${encodeURIComponent(sourceId)}/reindex`, { method: "POST" });
}

export function runRetrieve(subjectId: string, q: string, k = 5): Promise<RetrievalResult> {
  const params = new URLSearchParams({ subjectId, q, k: String(k) });
  return apiFetch(`/dev/retrieve-source?${params.toString()}`);
}
```

Also add a `getSubjects` helper to a new `apps/web/src/api/subjects.ts` (or extend an existing file if one is added by a parallel phase):

```ts
export interface Subject { id: string; name: string; course: string | null; }
export function getSubjects(): Promise<{ subjects: Subject[] }> {
  return apiFetch(`/api/subjects`);
}
```

Note: `GET /api/subjects` is **not in the existing server code** — it's only specified in `plan.md` §8. The frontend needs it for the subjectId fallback. **Backend agent owns adding this endpoint as a side-task** — it's a 10-line Hono handler returning `SELECT id, name, course FROM subjects WHERE user_id = $1 ORDER BY created_at DESC`. Add it to a new `apps/server/src/subjects/router.ts` (no full subjects-module needed in phase 4; just this read endpoint) and mount it from `apps/server/src/index.ts`.

### 7.8 Failure-state UI

Per the spec — the validation gate explicitly mentions "Failure-state UI for sources that fail extraction (e.g., scanned PDFs)". Three layers:

1. **Inline status pill** in the row: red "failed" pill from `screen-bibliography.jsx:54-56` style (`<span className="cov-pill red">failed</span>`).
2. **Tooltip / row-hover**: shows `failure_reason`.
3. **Bottom banner** (the `screen-bibliography.jsx:85-91` "1 source failed to index" panel): renders when any source has `status='failed'`. Lists up to 3 failed sources with a "Re-index {title}" button per row.

The "scanned PDF" case specifically: the chunker emits very few or zero chunks because `unpdf` returns near-empty page text. Add a guard at the end of the chunker step: **if `chunks.length === 0`, throw `Error("PDF appears to be scanned or image-only — no extractable text. OCR is not supported in v1.")`** before the embed step starts. The job's catch persists this as `failure_reason` and the banner shows the explanation.

### 7.9 What NOT to build in Phase 4

The design (`screen-bibliography.jsx`) shows columns for "Cited" count and "Coverage" bars based on `b.used`. Those are **Phase 5 data** (a citation only exists once a `Completion` is generated). For Phase 4, render those columns with `—` placeholder values. Wire them up in Phase 5.

The "Most cited" stat cell in the StatsRow: render `—` for v1. Same reason.

---

## 8. prod-changes.md additions

Add a new section to `prod-changes.md` (after the existing Phase 3 section, before the closing horizontal rule). Use the same `[ ]` checklist style as the existing rows:

```markdown
## Phase 4 dev shortcuts

These items are intentional shortcuts taken during Phase 4 implementation to keep
the dev loop fast on Ollama. Each must be closed before shipping.

- [ ] **Bibliography PDF storage is local filesystem** (`apps/server/src/bibliography/storage.ts`). Files
  go to `apps/server/uploads/sources/` on disk. Switch to S3/R2 for production (already
  tracked in §6 above). The `storeSourcePdf` function is the only call site; swap the impl there.
- [ ] **Source chunk embeddings use Ollama `bge-m3`** in dev (`model_id = bge-m3`). Run a re-embed
  job against the Cohere multilingual model after switching to Bedrock. The §1 re-embed plan
  must now cover **three** tables: `note_fragment_embeddings`, `concept_embeddings`, and
  `source_chunk_embeddings`. Without all three under the same `model_id`, Phase 5 retrieval
  finds zero matches.
- [ ] **No OCR for scanned PDFs**. The chunker throws if `unpdf` returns near-empty page text;
  the source row lands `status='failed'` with a clear message. v1.1 task: integrate a
  Bedrock-Textract or Tesseract path for image-only PDFs.
- [ ] **URL ingest uses crude HTML-tag-strip** (`apps/server/src/bibliography/fetch-url.ts`).
  No `@mozilla/readability`. Failure mode: nav menus / footer text leak into chunks and
  degrade retrieval. If Phase 4 source-recall eval drops below 0.8 specifically on URL
  fixtures, swap to readability + jsdom (or linkedom). The chunker is unaffected; only the
  fetch-strip layer changes.
- [ ] **Chapter labels deferred — `source_chunks.chapter_label` is always NULL in v1.**
  Auto-detection from heading regex over per-page text was punted (~60% precision; trust-
  burning false positives). v1.1: use `pdf.getOutline()` from unpdf to map page → chapter,
  then UPDATE source_chunks SET chapter_label = … as a backfill. Schema column already
  exists; this is a backfill, not a migration.
- [ ] **Source-ingest worker concurrency=2**. Lift to ≥4 once `apps/worker` is split per §7.
- [ ] **Source-ingest auto-retry not wired**. Failed jobs require manual reindex. Add
  exponential-backoff retry per `plan.md` §9 retry block (`attempts: 5, backoff: { type:
  'exponential', delay: 2000 }`) on transient errors only — distinguish HTTP 503 / quota
  throttle from "URL returned 404". Pre-Bedrock-cutover, this is moot (Ollama embed
  doesn't throttle); it becomes load-bearing once we hit Cohere quota.
```

Also flip the Phase-4 reference in §6 ("Bibliography sources (Phase 4): same pattern…") from a forward note into a closed checkbox once the storage shortcut is wired.

---

## 9. Out of scope clarifications

- **Using these chunks for grounded completion** — Phase 5. Phase 4 stops at "chunks are queryable." `POST /api/concepts/:id/complete`, the hallucination guard, the `Completion` + `Citation` rows: all Phase 5.
- **OCR for scanned PDFs** — v1.1. Phase 4 surfaces the failure clearly; no fallback path.
- **Reranking on top of HNSW retrieval** — v1.1 (`plan.md` §1.6.2). Phase 4 retrieves with raw cosine; the eval gate validates that's good enough.
- **Per-chunk citation drilling** (the citation drawer that opens to a specific chunk on click) — Phase 5. Phase 4 ships the drawer that lists all chunks with previews; the "click a citation in a Completion → highlight this chunk in the bibliography" flow is Phase 5 wiring on top of phase-4 surfaces.
- **`@mozilla/readability` for URL ingest** — v1.1 if needed (§4).
- **Chapter-label detection** — v1.1 via `pdf.getOutline()` (§3.4).
- **Connector-side bibliography import** (e.g., Notion → Source) — out of v1 entirely. Bibliography is upload-only per `plan.md` D13.
- **Bibliography content search bar** (the `screen-bibliography.jsx:34` search input) — render the input but do not wire it. v1.1 task; the audit *is* the search per `plan.md` §13.
- **Author / year auto-extraction from PDF metadata** — out. Author/year columns in v1 are user-edited or null; the columns exist for Phase 5+ citation rendering.

---

## 10. Validation gate operationalisation

### 10.1 Fixtures to add

**`apps/server/__eval__/source-recall.json`** — new file, 10-query fixture matching the existing `retrieval-recall.json` shape:

```json
{
  "_meta": {
    "phase": 4,
    "fixtureSource": "phil411-bibliography",
    "language": "en",
    "embedModel": "cohere.embed-multilingual-v3",
    "passThreshold": 8,
    "totalQueries": 10,
    "description": "Each query's expected source must appear in top-3 (NOT top-1 — sources are longer than fragments and exact passage retrieval is harder). Eight or more passes the gate."
  },
  "queries": [
    {
      "q": "the regress problem and three escapes",
      "expectedSourceTitle": "BonJour 1985 — The Structure of Empirical Knowledge",
      "expectedPagesLabel": "pp. 18–22"
    },
    // … nine more, hand-curated against the fixture PDF + 1–2 URL fixtures
  ]
}
```

The fixture PDF goes to `apps/server/__eval__/source-fixture.pdf` — 50 pages, philosophy-domain text (e.g., a SEP article PDF or a chapter from a Creative-Commons philosophy book). The shape "expectedSourceTitle in top-3" is more forgiving than fragment retrieval's "expectedExternalId top-1" because chunks within a single source are often near-duplicates in cosine — top-1 is too brittle.

### 10.2 Spot-check script

**`apps/server/__eval__/source-spotchecks.json`** — a 10-row fixture with hand-labeled `pages_label` for sampled chunks of the 50-page PDF:

```json
{
  "_meta": {
    "phase": 4,
    "fixtureSource": "phil411-bibliography",
    "passThreshold": 8,
    "description": "For each chunk position, the actual extracted pages_label must match the human-labeled value."
  },
  "spotchecks": [
    { "chunkPosition": 0, "expectedPagesLabel": "p. 1" },
    { "chunkPosition": 5, "expectedPagesLabel": "pp. 8–9" },
    // … 8 more
  ]
}
```

### 10.3 Eval test file

**`apps/server/__eval__/source-recall.test.ts`** — mirror `retrieval-recall.test.ts`. Skips when `NOETICAI_EVAL_LIVE !== "1"`. Three assertions:

1. **Chunk count band**: ingest the fixture; assert 35 ≤ `count(*) FROM source_chunks WHERE source_id=$1` ≤ 75.
2. **pages_label spot checks**: for each row in `source-spotchecks.json`, fetch the chunk at that position, compare `pages_label` with `expectedPagesLabel`. Pass if ≥ 8/10 match.
3. **Retrieval recall**: for each query in `source-recall.json`, embed → top-3 chunks → assert `expectedSourceTitle` is among the source titles. Pass if ≥ 8/10.

**`apps/server/__eval__/source-rerun.test.ts`** — separate test asserting:

4. **Rerun = no new embeddings**: after a successful ingest, calling `runSourceIngest` again on the same source row produces zero new `source_chunks` and zero new `source_chunk_embeddings`. (Skip-if-already-embedded check works.)

### 10.4 Test command

```bash
NOETICAI_EVAL_LIVE=1 cd apps/server && bun test __eval__/source-recall.test.ts __eval__/source-rerun.test.ts
```

(Match the existing `retrieval-recall.test.ts` invocation form.)

CI runs the eval skeleton without `NOETICAI_EVAL_LIVE=1` — tests self-skip. The Phase 4 gate is verified by hand via `bun test` after the implementer wires the fixtures and is on Bedrock. Document this in the Phase-4 closeout in implementation.md when checking off the gate.

### 10.5 UI smoke (the "polling stops" gate)

Manual smoke, not automated:

1. With no sources mid-processing, open the network tab on `/bibliography`. Confirm `GET /api/sources?subjectId=…` fires once on mount and stops (no 10-s repeat).
2. Upload a PDF. Confirm polling kicks back in (request every 10 s).
3. When the upload reaches `ready`, confirm polling stops again within 10–20 s of the last terminal transition.

If automation is desired in v1.1: a Playwright test stubbing the API to return a "uploading → ready" sequence and asserting `fetch` call count.

---

## 11. Sequencing for the implementers

### 11.1 Backend agent (`senior-backend-engineer`) — ordered checklist

Each step ends with a green typecheck. Do not advance until the prior step compiles and the relevant test passes (where applicable).

1. **Migration first.** Drop `packages/db/migrations/0005_phase4_bibliography.sql`. Boot the server (`pnpm dev` in `apps/server/`); confirm `runMigrations` applied it (check `\d sources` in psql). 0 LOC of TypeScript yet.
2. **Drizzle schema.** Add `packages/db/src/schema/bibliography.ts` and re-export from `packages/db/src/schema/index.ts`. `pnpm typecheck` clean.
3. **Storage helper.** `apps/server/src/bibliography/storage.ts` — `storeSourcePdf({ bytes, originalFilename })` returns `{ relativePath, absolutePath, filename, bytes }`. Mirrors `apps/server/src/syllabus/storage.ts` 1-to-1 with path swap (`uploads/sources/`).
4. **PDF extractor.** `apps/server/src/bibliography/extract.ts` — `extractPdfPages` returning per-page text (mergePages: false).
5. **URL fetcher.** `apps/server/src/bibliography/fetch-url.ts` — fetch + size cap + tag strip. Pure fn returning `{ text, externalUrl, byteCount }` or throws with classified errors.
6. **Chunker.** `apps/server/src/bibliography/chunker.ts` — pure fn `chunkPages(pages: string[], { kind: 'pdf' | 'url' }): SourceChunk[]`. Add a `apps/server/src/bibliography/chunker.test.ts` next to it (mirror `apps/server/src/ingest/fragments.test.ts`) with 4-5 unit tests on a hand-built input — covers paragraph boundary preference, hard-max-char fallback, page-spanning chunks, near-empty-input throw, URL kind null pages_label.
7. **Job.** `apps/server/src/bibliography/job.ts` — `processSourceIngestJob` orchestrating extract → chunk → embed → status updates. Mirror `processSyllabusJob` for the catch-and-persist pattern.
8. **Queue wiring.** Update `apps/server/src/queue/index.ts` per §2.3. `pnpm typecheck` clean.
9. **Routes.** `apps/server/src/bibliography/router.ts` — implement `POST /api/sources`, `GET /api/sources`, `GET /api/sources/:id`, `DELETE /api/sources/:id`, `POST /api/sources/:id/reindex`, `GET /dev/retrieve-source`. Mount in `apps/server/src/index.ts`.
10. **Subjects read endpoint.** `apps/server/src/subjects/router.ts` — `GET /api/subjects` returning the user's subjects. Mount in `apps/server/src/index.ts`. (Side task for the frontend's subjectId fallback.)
11. **prod-changes.md** — append the Phase 4 section per §8.
12. **Eval fixtures.** Add `__eval__/source-recall.json`, `__eval__/source-spotchecks.json`, the 50-page `source-fixture.pdf`, and the two test files. Run `NOETICAI_EVAL_LIVE=1 bun test __eval__/source-recall.test.ts` locally to confirm shape (it will pass on Ollama with relaxed thresholds — the kill-style 0.85 number is a Bedrock-only gate, mirror Phase 3's discipline).
13. **Smoke test end-to-end on Ollama**: `curl -F file=@some.pdf -F subjectId=… /api/sources`, poll `GET /api/sources/:id`, confirm transitions, hit `/dev/retrieve-source?q=…`.

### 11.2 Frontend agent (`frontend-react-craftsman`) — ordered checklist

Wait for backend step 9 (routes deployable). Steps 1-2 below can technically run in parallel with backend 1-9 by stubbing the API responses, but this risks divergence — recommend gating on backend completion.

1. **Route shell.** Replace `apps/web/src/routes/_auth/bibliography.tsx` placeholder with a route that: (a) defines `validateSearch` for `subjectId`, (b) reads search param, (c) falls back to `getSubjects().subjects[0].id` if absent, (d) renders a `<BibliographyScreen subjectId={…}>` placeholder.
2. **API client.** Add `apps/web/src/api/sources.ts` (full content per §7.7). Add `apps/web/src/api/subjects.ts` for `getSubjects`.
3. **Header + StatsRow + Toolbar.** Build `BibliographyHeader.tsx`, `StatsRow.tsx`, `ToolbarRow.tsx` per the design markup. StatsRow placeholders for "Most cited" / "Passages cited" (`—`) until Phase 5.
4. **SourceList + SourceRow.** The grid table from `screen-bibliography.jsx:43-83`. StatusPill renders the cov-pill class.
5. **Polling hook in the route.** TanStack Query with `refetchInterval` per §7.4. Verify in network tab that polling stops at terminal.
6. **UploadPdfButton + AddUrlForm.** Wire the mutations. Optimistic insert is NOT recommended — the 10-s poll picks up the new row quickly enough; optimistic adds risk inconsistent state on failure.
7. **SourceDrawer + chunk previews.** Local `useState<string | null>` for the active source. On open, fire `getSource(sourceId)` — its own query key, no polling.
8. **RetrievalTestInput.** Inside the drawer. Debounced 300 ms. On enter or debounce, fire `runRetrieve(subjectId, q)`. Render top-5 with similarity bar.
9. **FailureBanner.** Bottom of the screen, conditional on any source.status === 'failed'. Wires the reindex mutation.
10. **Reindex + Delete actions.** From the row hover menu (or in-drawer footer). Both invalidate the list query; reindex bumps the source back into `uploading` and polling resumes.
11. **Failure-state UI.** Confirm:
    - Failed pill renders red + tooltip shows `failure_reason`.
    - Banner shows the failed source(s) with re-index CTA.
    - Empty-state for no sources yet (use the audit screen's `EmptyAuditState` style — friendly copy + the two upload CTAs).

### 11.3 Done = these gates pass, in order

- [ ] Backend step 13: end-to-end ingest works on Ollama.
- [ ] Frontend step 11: a manual click-through of the `/bibliography` screen exhibits the validation-gate behaviours.
- [ ] On Bedrock (when AWS access lands): `NOETICAI_EVAL_LIVE=1 bun test __eval__/source-recall.test.ts __eval__/source-rerun.test.ts` passes — chunk count in band, ≥ 8/10 pages_label spot checks, ≥ 8/10 source-recall, zero re-embeds on rerun.
- [ ] Status pill updates without page reload when a source transitions in the background. Confirmed in the network tab by watching the polling cadence.
- [ ] Polling stops within 20 s of the last source reaching a terminal state.

When all five check, Phase 4 is closed. Move to Phase 5.

---

## Appendix A — Concrete file inventory (paths the implementers will touch)

**Created:**
- `/Users/tomasizuel/Documents/Self/episteme/packages/db/migrations/0005_phase4_bibliography.sql`
- `/Users/tomasizuel/Documents/Self/episteme/packages/db/src/schema/bibliography.ts`
- `/Users/tomasizuel/Documents/Self/episteme/apps/server/src/bibliography/router.ts`
- `/Users/tomasizuel/Documents/Self/episteme/apps/server/src/bibliography/storage.ts`
- `/Users/tomasizuel/Documents/Self/episteme/apps/server/src/bibliography/extract.ts`
- `/Users/tomasizuel/Documents/Self/episteme/apps/server/src/bibliography/fetch-url.ts`
- `/Users/tomasizuel/Documents/Self/episteme/apps/server/src/bibliography/chunker.ts`
- `/Users/tomasizuel/Documents/Self/episteme/apps/server/src/bibliography/chunker.test.ts`
- `/Users/tomasizuel/Documents/Self/episteme/apps/server/src/bibliography/job.ts`
- `/Users/tomasizuel/Documents/Self/episteme/apps/server/src/subjects/router.ts`
- `/Users/tomasizuel/Documents/Self/episteme/apps/server/__eval__/source-recall.json`
- `/Users/tomasizuel/Documents/Self/episteme/apps/server/__eval__/source-spotchecks.json`
- `/Users/tomasizuel/Documents/Self/episteme/apps/server/__eval__/source-fixture.pdf`
- `/Users/tomasizuel/Documents/Self/episteme/apps/server/__eval__/source-recall.test.ts`
- `/Users/tomasizuel/Documents/Self/episteme/apps/server/__eval__/source-rerun.test.ts`
- `/Users/tomasizuel/Documents/Self/episteme/apps/server/uploads/sources/` (directory; created by storage.ts on first write)
- `/Users/tomasizuel/Documents/Self/episteme/apps/web/src/api/sources.ts`
- `/Users/tomasizuel/Documents/Self/episteme/apps/web/src/api/subjects.ts`
- `/Users/tomasizuel/Documents/Self/episteme/apps/web/src/screens/bibliography/BibliographyHeader.tsx`
- `/Users/tomasizuel/Documents/Self/episteme/apps/web/src/screens/bibliography/StatsRow.tsx`
- `/Users/tomasizuel/Documents/Self/episteme/apps/web/src/screens/bibliography/ToolbarRow.tsx`
- `/Users/tomasizuel/Documents/Self/episteme/apps/web/src/screens/bibliography/UploadPdfButton.tsx`
- `/Users/tomasizuel/Documents/Self/episteme/apps/web/src/screens/bibliography/AddUrlForm.tsx`
- `/Users/tomasizuel/Documents/Self/episteme/apps/web/src/screens/bibliography/SourceList.tsx`
- `/Users/tomasizuel/Documents/Self/episteme/apps/web/src/screens/bibliography/SourceRow.tsx`
- `/Users/tomasizuel/Documents/Self/episteme/apps/web/src/screens/bibliography/SourceDrawer.tsx`
- `/Users/tomasizuel/Documents/Self/episteme/apps/web/src/screens/bibliography/RetrievalTestInput.tsx`
- `/Users/tomasizuel/Documents/Self/episteme/apps/web/src/screens/bibliography/FailureBanner.tsx`
- `/Users/tomasizuel/Documents/Self/episteme/apps/web/src/screens/bibliography/StatusPill.tsx`

**Modified:**
- `/Users/tomasizuel/Documents/Self/episteme/packages/db/src/schema/index.ts` (add bibliography re-export)
- `/Users/tomasizuel/Documents/Self/episteme/apps/server/src/queue/index.ts` (add source-ingest queue + worker + enqueueSourceIngest)
- `/Users/tomasizuel/Documents/Self/episteme/apps/server/src/index.ts` (mount bibliographyRouter + subjectsRouter)
- `/Users/tomasizuel/Documents/Self/episteme/apps/web/src/routes/_auth/bibliography.tsx` (replace placeholder with real route)
- `/Users/tomasizuel/Documents/Self/episteme/prod-changes.md` (append Phase 4 dev shortcuts section)
- `/Users/tomasizuel/Documents/Self/episteme/implementation.md` (check Phase 4 gate boxes once eval passes — done in closeout)

**Untouched (deliberately):**
- `apps/web/src/lib/useAsyncJob.ts` — reused as-is for the upload-mutation flow if desired; the list polling does not use it.
- `apps/server/src/syllabus/*`, `apps/server/src/audit/*`, `apps/server/src/ingest/*` — patterns mirrored, not modified.
