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

Last updated: 2026-05-07 (Phase 4 bibliography ingest backend).
