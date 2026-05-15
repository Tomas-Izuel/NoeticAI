# Production cutover punch list

> The local dev stack runs on Ollama because AWS credits aren't active yet.
> When credits land and Bedrock model access is granted, this file is the
> checklist for what flips back to production behavior.
>
> Add a row every time you take a shortcut for dev. Strike one when you've
> verified it works on Bedrock + closed it.

## 1. AI backend

- [ ] **Flip `NOETICAI_AI_BACKEND=bedrock`** in production env. Currently `ollama` in `apps/server/.env`.
- [ ] **Replace AWS placeholders** in env: real `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (or use IAM role on the compute), and `AWS_REGION=us-east-1`.
- [ ] **Pin Bedrock model IDs** by reading them off the Bedrock → Model access page in your AWS account. The IDs in `.env.example` are placeholders. For Opus + Sonnet prefer the cross-region inference profile form (`us.anthropic.…`).
- [ ] **Re-embed everything**. Local dev produced rows under `model_id = bge-m3`. Production reads under `model_id = cohere.embed-multilingual-v3`. Either:
  - Run a one-off re-embed job (preferred — no data loss, model_id is per-row).
  - Or `DELETE FROM note_fragment_embeddings WHERE model_id = 'bge-m3'` then re-ingest.

## 2. Model-quality gates that were skipped on Ollama

These eval thresholds were calibrated against Bedrock (Sonnet/Haiku/Opus) and CANNOT pass on local Gemma. Ship is gated on:

- [ ] **Phase 2 — syllabus extraction precision ≥ 0.85** vs. golden corpus (`apps/server/__eval__/syllabus-fixture.pdf` + golden labels). Re-run with `NOETICAI_AI_BACKEND=bedrock` once Opus is live.
  - **Dev caveat**: `llm.opus(...)` routes through `gemma4:e4b` when `NOETICAI_AI_BACKEND=ollama`. The
    extraction prompt is instrumented for JSON-only output but the smaller model will produce noisier
    concept trees — incomplete units, merged concepts, or spurious top-level prose. This is expected
    and acceptable for smoke-testing the pipeline plumbing; it is NOT acceptable as a quality signal.
    The 0.85 precision gate only counts on Bedrock.
  - **JSON leniency warning**: `apps/server/src/syllabus/job.ts` `parseLlmResponse()` strips markdown
    fences and falls back to a first-`{…}`-block regex extraction to survive Ollama's output quirks.
    This leniency may mask a contract regression in the Bedrock Opus response when you flip the
    backend. Re-run the eval harness immediately after switching to Bedrock to catch this.
- [ ] **Phase 3 — verdict accuracy ≥ 0.85** on the 200-tuple golden corpus.
- [ ] **Phase 5 — citation precision ≥ 0.95** on the 30-tuple corpus.
- [ ] **Phase 5 — hallucination guard fixture returns null 100%** of the time.
- [ ] **Phase 5 — cache-hit rate ≥ 70%** on a sequential 80-concept sweep (Bedrock Converse usage fields).

Two of these are kill criteria (Phase 3, Phase 5). Ollama can run the plumbing; only Bedrock can satisfy the gates.

## 3. Quota tickets

- [ ] File AWS Service Quotas increases for **Claude Sonnet** and **Claude Haiku** in `us-east-1` — both "On-demand model inference requests per minute" and "…tokens per minute". Defaults are tight; ask for ~5×.
- [ ] Verify Cohere Embed quota holds during a real-data ingest. Re-evaluate if it throttles.

## 4. Prompt caching

- [ ] Wire `cachePoints` arg in `packages/ai/src/bedrock.ts` into Bedrock Converse `cachePoint` markers (currently a stub). Layers: `system` / `subject context` / `concept context`. Retrieved chunks **never** cached.
- [ ] Add a CI gate: cache-hit rate on a fixed corpus drops > 10 points → fail.

## 5. Cost tracking

- [ ] `packages/ai/src/budget.ts` is a `console.log` stub. Replace with writes to a `cost_events` table (Phase 7g). Aggregate per user/org; expose admin dashboard.
- [ ] Add per-org monthly hard cutoff (Phase 7g spend cap).

## 6. Storage

- [ ] **Syllabus PDFs**: dev stores them in `apps/server/uploads/` on local filesystem. Production should switch to S3/R2 with a signed-URL upload flow. Update `apps/server/src/syllabus/storage.ts` (when it exists) to support both.
- [ ] **Bibliography sources** (Phase 4): same pattern. PDF blobs go to object storage, not the DB.

## 7. Process model

- [ ] **Split `apps/worker` from `apps/server`**. Currently BullMQ workers run in the same Bun process as the HTTP server. Phase 3's audit fan-out (80 concepts × ~20 candidates each) can spike CPU and block the HTTP loop. Recommended preflight at the start of Phase 3.

## 8. CORS + origins

- [ ] `apps/server/src/index.ts` allows `localhost:5173` (landing) and `env.WEB_URL`. In production, trim to actual production hostnames. No `localhost:*` in prod.

## 9. Observability

- [ ] Replace `console.log` in `[ai]`, `[db]`, `[queue]`, `[budget]` paths with structured logs (pino/whatever). Capture trace IDs. Wire Bedrock latency + token-usage to a metrics sink.

## Phase 2 dev shortcuts

These items are intentional shortcuts taken during Phase 2 implementation to keep
the dev loop fast on Ollama. Each must be closed before shipping.

- [ ] **Syllabus extraction quality**: `llm.opus()` routes to `gemma4:e4b` in dev. Concept trees
  will be noisy (incomplete, merged, or hallucinated). Don't evaluate quality on Ollama output.
  Re-run the eval harness (`apps/server/__eval__/syllabus-extraction.test.ts`) on Bedrock.
- [ ] **JSON leniency in `parseLlmResponse`** (`apps/server/src/syllabus/job.ts`): strips markdown
  fences and falls back to first-`{…}`-block regex to handle Ollama output. Once on Bedrock, verify
  Opus returns bare JSON as instructed; remove the regex fallback if it stops being needed — its
  presence masks prompt-contract drift.
- [ ] **Extraction system prompt is in English** (`apps/server/src/syllabus/prompt.ts`): the
  original Spanish system prompt caused gemma to translate JSON keys (`subject` → `titulo`,
  `units` → `unidades`, `concepts` → `conceptos`), breaking the zod parser. Switching to an
  English system prompt with explicit "do not translate the keys" guidance fixed it.
  Once on Bedrock with Opus, the Spanish prompt should also work; revisit if you want a
  pure-Spanish dev experience.
- [ ] **`maxTokens` raised to 16384 for syllabus extraction** (`apps/server/src/syllabus/job.ts`):
  gemma is verbose and was clipping mid-string at 8K. Bedrock Opus returns much tighter JSON;
  consider lowering back to 8192 in production to save output tokens (the cost-budget table in
  plan.md §4.5 assumes ~2K out per syllabus).
- [ ] **`trySalvageTruncatedJson` recovery in `parseLlmResponse`** (`apps/server/src/syllabus/job.ts`):
  appends `]}` to the last `}` when the LLM output got cut by maxTokens. Strictly a dev safety
  net — masks a real "raise maxTokens" signal. Remove on Bedrock and let the parse fail loudly
  so the cost-budget signal survives.
- [ ] **Syllabus PDF storage is local filesystem** (`apps/server/src/syllabus/storage.ts`). Files
  go to `apps/server/uploads/syllabuses/` on disk. Switch to S3/R2 for production (item already
  tracked in §6 above). The `storeSyllabusPdf` function is the only call site; swap the impl there.
- [ ] **Concept embeddings use Ollama `bge-m3`** in dev (`model_id = bge-m3`). Run a re-embed job
  against the Cohere multilingual model after switching to Bedrock. Old rows stay inert under their
  `model_id`; new rows write fresh. See §1 re-embed checklist above.

---

## Phase 3 dev shortcuts

These items are intentional shortcuts taken during Phase 3 implementation to keep
the dev loop fast on Ollama. Each must be closed before shipping.

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
- [ ] **Verdict-batch graceful degradation**. `apps/server/src/audit/align.ts`
  catches empty/unparseable Haiku responses per concept, logs a warning, and
  skips the concept (treats all its candidates as off-topic, so the
  mastery_score lands red). This is dev resilience for gemma occasionally
  refusing array-output prompts. On Bedrock + Haiku the catch should
  effectively never trigger — if it does fire in production, the
  kill-criterion eval will degrade silently. Add a counter / metric for
  `verdict_batch_failed` per audit run before shipping, and fail the run if
  > 5 % of batches degrade.
- [ ] **Backend-aware audit thresholds**. `apps/server/src/audit/router.ts`
  picks `DEV_OLLAMA_THRESHOLDS` (`greenDepth=0.6`, `amberDepth=0.4`,
  `hallucinationGuardSimilarity=0.7`) when `NOETICAI_AI_BACKEND=ollama`,
  and the spec defaults (`0.78 / 0.55 / 0.85` from
  `@noeticai/audit-core`'s `DEFAULT_THRESHOLDS`) on Bedrock. bge-m3
  produces lower absolute cosine scores than Cohere v3 — without this
  override, dogfood audits land all-red even when the pipeline is
  healthy. **Implication for the kill-criterion gate**: the Phase 3
  eval (verdict accuracy ≥ 0.85, gap precision/recall ≥ 0.85) must run
  with `NOETICAI_AI_BACKEND=bedrock` so it scores against
  `DEFAULT_THRESHOLDS`, not the dev override. Delete
  `DEV_OLLAMA_THRESHOLDS` once Phase 7e ships per-subject threshold
  tuning — the user surface replaces the env-toggled override.

---

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

---

## Phase 5 dev shortcuts

These items are intentional shortcuts taken during Phase 5 implementation to keep
the dev loop fast on Ollama. Each must be closed before shipping.

- [ ] **Sonnet routing on Ollama**: `llm.sonnet()` routes to the env-configured
  Ollama model in dev. The Phase 5 kill-criterion gates (citation precision ≥ 0.95,
  hallucination guard 100% null) **do not apply on gemma** — re-run all of
  `apps/server/__eval__/citation-precision.test.ts`,
  `apps/server/__eval__/hallucination-guard.test.ts`,
  `apps/server/__eval__/cache-hit-sweep.test.ts`, and
  `apps/server/__eval__/cost-per-completion.test.ts` after flipping
  `NOETICAI_AI_BACKEND=bedrock`. The eval tests skip with a clear "BEDROCK REQUIRED"
  message on Ollama. Ollama runs are smoke-tests of the plumbing only.
- [ ] **Eval fixtures unauthored**. `apps/server/__eval__/citations.json` and
  `apps/server/__eval__/hallucination-guard.json` ship with empty `tuples: []` /
  `cases: []` arrays plus a TODO in `_meta`. Hand-label 30 citation tuples and 10
  hallucination cases against `apps/server/__eval__/source-fixture.pdf` before the
  kill-criterion gates can run. Tests fail loudly with `expect(0).toBeGreaterThan(0)`
  while the corpus is empty so CI surfaces this.
- [ ] **Hallucination-guard threshold (per-subject override)**:
  `hallucinationGuardSimilarity` defaults to 0.85 on Bedrock
  (`@noeticai/audit-core` `DEFAULT_THRESHOLDS`); the existing
  `DEV_OLLAMA_THRESHOLDS` in `apps/server/src/audit/router.ts` lowers it to 0.7
  for bge-m3. Phase 5 reads the same threshold from `audit_runs.thresholds_json`
  (snapshotted at audit-run time). The Phase 5 kill-criterion gate must run on
  Bedrock so it scores against 0.85, not 0.7. Delete the override once Phase 7e
  ships per-subject threshold tuning.
- [ ] **Cache-points still bypassed on Ollama**: `packages/ai/src/ollama.ts`
  `ollamaConverse` inlines `args.layeredContext` (subject + concept + userTurn)
  into a single user message but ignores `cachePoints`. The cache-hit metric
  (`cacheReadInputTokens`/`cacheWriteInputTokens`) is always 0 on Ollama — the
  cache-hit gate (≥ 70%) only counts on Bedrock. The cachePoint wiring on Bedrock
  is implemented in `packages/ai/src/bedrock.ts` (closing `prod-changes.md` §4).
- [ ] **`apps/web/src/lib/cost-rates.ts` is hardcoded** to Sonnet 4 us-east-1
  rates as of the Phase 5 implementation date. When AWS publishes rate changes,
  update this file. Promote to a server-config endpoint when the `cost_events`
  table lands (Phase 7g).
- [ ] **Completion worker concurrency=1**: `apps/server/src/queue/index.ts` caps
  the completion worker at concurrency 1 (matches the existing audit pattern).
  Spec (`plan.md` §9) calls for concurrency 6. Lift to 4 once `apps/worker` is
  split per §7 above; lift to 6 once Sonnet quota raises land.
- [ ] **Completion `attempts: 1` (no retry)**: `enqueueCompletion` enqueues with
  `attempts: 1` rather than the spec's `attempts: 5, exponential backoff`.
  Reasoning: Sonnet calls are expensive and we want guard-failure visibility, not
  silent retry to success. Once we have a way to distinguish transient infra
  errors (Bedrock 503, Cohere quota) from model misbehavior (telemetry from
  Phase 7c), revisit this.
- [ ] **`recordUsage` is still a `console.log` stub** (already tracked under §5
  above). Phase 5 is the first feature that makes `recordUsage` *load-bearing*
  for cost tracking — call sites are wired up in
  `apps/server/src/completion/job.ts`. The dev-only cost badge on the completion
  card reads tokens from the `completions` row directly (not from `recordUsage`);
  when the `cost_events` table lands (Phase 7g), the badge should switch to
  reading from there.
- [ ] **Retrieval similarity floor is backend-dependent**. `apps/server/src/completion/retrieve.ts`
  hardcodes `SIMILARITY_FLOOR = 0.4` when `NOETICAI_AI_BACKEND === "ollama"` and `0.55` on
  Bedrock. Spec (`plan.md` §1.6) calls for 0.55 — the override exists because bge-m3 produces
  cosines ~0.10–0.20 lower than Cohere v3, so the spec floor returns zero chunks even for
  relevant sources during dev. Same root cause as `DEV_OLLAMA_THRESHOLDS` in
  `apps/server/src/audit/router.ts`. Delete the override once Phase 7e ships per-subject
  threshold tuning, OR fold it into the same per-subject threshold snapshot the audit reads.
- [ ] **No re-similarity caching for the guard**: each guard call re-embeds
  `(paragraph, cited_chunk)` pairs to compute similarity. On Bedrock with Cohere
  v3 these embed calls cost real money (~$0.001 per completion in extra embed).
  Acceptable for v1; cache the per-paragraph embedding by content hash if Phase
  7g cost dashboards show this as significant.
- [ ] **`thresholdsHash` derivation is `String(hallucinationGuardSimilarity)`**.
  In `apps/server/src/completion/job.ts` the cache key thresholds-hash is the
  raw threshold value as a string. This is stable for the same threshold value
  and changes when the threshold changes — semantically correct but coarse. If
  per-subject threshold tuning (Phase 7e) introduces multi-dimensional thresholds
  affecting completion, switch to a deterministic hash of the full thresholds
  object.
- [ ] **`modelId: "n/a"` for the zero-chunks short-circuit**.
  `apps/server/src/completion/job.ts` writes `model_id = "n/a"` on the
  `null_no_grounding` row when no LLM call was made (no source chunks above
  similarity floor). The `model_id` column is NOT NULL. v1.1: introduce a
  separate `model_id` sentinel or make the column nullable for these rows.
- [ ] **Bibliography PDF storage still local filesystem** (already tracked in §6).
  The `GET /api/sources/:sid/chunks/:chunkId` endpoint reads chunk text from the
  DB, not the PDF, so this is not a Phase 5 blocker — but the citation drawer
  shows extracted text only. v1.1 enhancement: serve a signed-URL link to the
  PDF page from the drawer.
- [ ] **`concepts.neighborhood` may be empty or stale**: Phase 2 syllabus
  extraction populates this field but quality varies. Phase 5 retrieval uses
  neighborhood as a bonus query expansion; if neighborhood is null/empty,
  retrieval falls back to `name + LO` only. **Flagged as v1.1**: re-derive
  neighborhood after each audit run via cosine top-2 over `concept_embeddings`
  (a deterministic alternative to LLM-derived neighborhood).
- [ ] **Merge / Edit / Reject buttons are no-op stubs**.
  `apps/web/src/screens/concept/CompletionHero.tsx` wires the three action
  buttons but their handlers `alert()` the user that v1 is local-only per
  `plan.md` D19 (connector write-back is out of v1). The completion lifecycle
  status stays at `pending` indefinitely. v1.1: add `POST /api/completions/:cid/merge`,
  `POST /api/completions/:cid/reject`, and a `PATCH /api/completions/:cid` for edits;
  drop the `alert()` and swap in real mutations.

---

Last updated: 2026-05-08 (Phase 5 grounded completion).
