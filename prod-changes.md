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
- [ ] **Pin Bedrock model IDs** by reading them off the Bedrock → Model access page in your AWS account. The IDs in `.env.example` are AWS-native Nova / Titan defaults; for Nova Pro + Nova Lite prefer the cross-region inference profile form (`us.amazon.nova-*-v1:0`) once `aws bedrock list-inference-profiles --region us-east-1` confirms availability.
- [ ] **Re-embed everything**. Local dev produced rows under `model_id = bge-m3`. Production reads under `model_id = amazon.titan-embed-text-v2:0`. Either:
  - Run a one-off re-embed job (preferred — no data loss, model_id is per-row).
  - Or `DELETE FROM note_fragment_embeddings WHERE model_id IN ('bge-m3', 'cohere.embed-multilingual-v3')` then re-ingest. The `cohere…` filter clause covers any prior Bedrock smoke-test data; if the operator never ran the prior Bedrock smoke, only `bge-m3` will match.

## 2. Model-quality gates that were skipped on Ollama

These eval thresholds were calibrated against Bedrock (Sonnet/Haiku/Opus) and CANNOT pass on local Gemma. Ship is gated on:

- [ ] **Calibration warning (Nova migration)**: the verdict, citation, hallucination, and cache-hit gates below were originally calibrated against Anthropic Claude (Opus/Sonnet/Haiku) responses and Cohere v3 cosines. The migration to Amazon Nova + Titan v2 may shift pass/fail rates. **Treat eval gate results as informational on the first post-migration run** — do NOT block deploy on a regressed gate this round; capture deltas and re-tune thresholds in a follow-up. See plan.md §4.6 + `apps/web/src/lib/cost-rates.ts` for the cost-UI corollary.

- [ ] **Phase 2 — syllabus extraction precision ≥ 0.85** vs. golden corpus (`apps/server/__eval__/syllabus-fixture.pdf` + golden labels). Re-run with `NOETICAI_AI_BACKEND=bedrock` once Nova Pro is live.
  - **Dev caveat**: `llm.opus(...)` routes through `gemma4:e4b` when `NOETICAI_AI_BACKEND=ollama`. The
    extraction prompt is instrumented for JSON-only output but the smaller model will produce noisier
    concept trees — incomplete units, merged concepts, or spurious top-level prose. This is expected
    and acceptable for smoke-testing the pipeline plumbing; it is NOT acceptable as a quality signal.
    The 0.85 precision gate only counts on Bedrock.
  - **JSON leniency warning**: `apps/server/src/syllabus/job.ts` `parseLlmResponse()` strips markdown
    fences and falls back to a first-`{…}`-block regex extraction to survive Ollama's output quirks.
    This leniency may mask a contract regression in the Bedrock Nova Pro response when you flip the
    backend. Re-run the eval harness immediately after switching to Bedrock to catch this.
- [ ] **Phase 3 — verdict accuracy ≥ 0.85** on the 200-tuple golden corpus. *(Threshold authored against Haiku; treat first Nova Micro run as informational per the calibration warning above.)*
- [ ] **Phase 5 — citation precision ≥ 0.95** on the 30-tuple corpus. *(Authored against Sonnet + Cohere v3; treat first Nova Lite + Titan v2 run as informational.)*
- [ ] **Phase 5 — hallucination guard fixture returns null 100%** of the time. *(Cohere-v3-calibrated similarity floor; treat first run as informational.)*
- [ ] **Phase 5 — cache-hit rate ≥ 70%** on a sequential 80-concept sweep (Bedrock Converse usage fields). *(Requires Nova cachePoint smoke-test pass; see §4 below.)*

Two of these are kill criteria (Phase 3, Phase 5). Ollama can run the plumbing; only Bedrock can satisfy the gates.

## 3. Quota tickets

- [ ] File AWS Service Quotas increases for **Amazon Nova Lite** and **Amazon Nova Micro** in `us-east-1` — both "On-demand model inference requests per minute" and "…tokens per minute". Defaults are tight; ask for ~5×.
- [ ] Verify Titan v2 embed quota holds during a real-data ingest (default TPM for Titan v2 is generous; the prior Cohere risk is moot but still worth a smoke check).
- [ ] Nova Pro inference is rare (syllabus extraction only); default quota is fine unless you batch-import a backlog.

## 4. Prompt caching

- [ ] **Nova cachePoint smoke check**: after Bedrock cutover, run the smoke-test in deploy.md §12 against all three Nova tier IDs with a small cachePoint-bearing Converse call. If any tier returns a 4xx for the `cachePoint` marker, set `NOETICAI_NOVA_CACHE_DISABLED=1` and add a defensive stripper in `packages/ai/src/bedrock.ts` that removes `cachePoint` blocks when `modelId` matches `^amazon\.nova-` and the env flag is set. **Do not lean on the cost model (plan.md §4.5) until this check passes.**
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
  Nova Pro returns bare JSON as instructed; remove the regex fallback if it stops being needed — its
  presence masks prompt-contract drift.
- [ ] **Extraction system prompt is in English** (`apps/server/src/syllabus/prompt.ts`): the
  original Spanish system prompt caused gemma to translate JSON keys (`subject` → `titulo`,
  `units` → `unidades`, `concepts` → `conceptos`), breaking the zod parser. Switching to an
  English system prompt with explicit "do not translate the keys" guidance fixed it.
  Once on Bedrock with Nova Pro, the Spanish prompt should also work; revisit if you want a
  pure-Spanish dev experience.
- [ ] **`maxTokens` raised to 16384 for syllabus extraction** (`apps/server/src/syllabus/job.ts`):
  gemma is verbose and was clipping mid-string at 8K. Bedrock Nova Pro returns much tighter JSON;
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
  against the Titan v2 model (`amazon.titan-embed-text-v2:0`) after switching to Bedrock. Old rows
  stay inert under their `model_id`; new rows write fresh. See §1 re-embed checklist above.

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
  may also mask Nova Micro contract drift. After the Bedrock cutover, re-run the
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
  audit fan-out (Nova Micro × 80 concepts) to keep the in-process Bun event loop
  responsive while the HTTP server shares the same process. Once we split
  workers into `apps/worker` (already tracked in §7), lift `audit` to ≥4 and
  the per-Nova-Micro-concurrency cap inside `align.ts` becomes the new bottleneck
  (currently 4; bump to 8 once Bedrock quotas are increased).
- [ ] **Local PDF storage already covered** — Phase 3 doesn't add new
  storage. Bibliography uploads in Phase 4 will trip the same shortcut
  (already tracked in §6).
- [ ] **Bedrock cache-points still stubbed** — Phase 3 doesn't lean on
  prompt caching (Nova Micro's verdict prompts are small enough to be cheap
  uncached). Phase 5 grounded completion will. The `cachePoints` arg in
  `packages/ai/src/bedrock.ts` remains a stub (already tracked in §4).
- [ ] **Verdict-batch graceful degradation**. `apps/server/src/audit/align.ts`
  catches empty/unparseable Nova Micro responses per concept, logs a warning, and
  skips the concept (treats all its candidates as off-topic, so the
  mastery_score lands red). This is dev resilience for gemma occasionally
  refusing array-output prompts. On Bedrock + Nova Micro the catch should
  effectively never trigger — if it does fire in production, the
  kill-criterion eval will degrade silently. Add a counter / metric for
  `verdict_batch_failed` per audit run before shipping, and fail the run if
  > 5 % of batches degrade.
- [ ] **Backend-aware audit thresholds**. `apps/server/src/audit/router.ts`
  picks `DEV_OLLAMA_THRESHOLDS` (`greenDepth=0.6`, `amberDepth=0.4`,
  `hallucinationGuardSimilarity=0.7`) when `NOETICAI_AI_BACKEND=ollama`,
  and the spec defaults (`0.78 / 0.55 / 0.85` from
  `@noeticai/audit-core`'s `DEFAULT_THRESHOLDS`) on Bedrock. bge-m3
  produces lower absolute cosine scores than Titan v2 — without this
  override, dogfood audits land all-red even when the pipeline is
  healthy. **Implication for the kill-criterion gate**: the Phase 3
  eval (verdict accuracy ≥ 0.85, gap precision/recall ≥ 0.85) must run
  with `NOETICAI_AI_BACKEND=bedrock` so it scores against
  `DEFAULT_THRESHOLDS`, not the dev override. Delete
  `DEV_OLLAMA_THRESHOLDS` once Phase 7e ships per-subject threshold
  tuning — the user surface replaces the env-toggled override.
- [ ] **Titan v2 cosine distribution NOT re-calibrated**. `DEFAULT_THRESHOLDS`
  in `@noeticai/audit-core` (greenDepth=0.78, amberDepth=0.55,
  hallucinationGuardSimilarity=0.85) were authored against Cohere v3 cosines.
  Titan v2 cosines may run higher or lower; `normalize: false` was picked
  specifically to keep the distribution close to v3 but it is NOT verified.
  Add a calibration sweep against the Phase 3 golden corpus AFTER the first
  real Nova/Titan audit run, then either retune the constants or accept the
  shift. Block: this requires real Bedrock data; cannot be done on Ollama.

---

## Phase 4 dev shortcuts

These items are intentional shortcuts taken during Phase 4 implementation to keep
the dev loop fast on Ollama. Each must be closed before shipping.

- [ ] **Bibliography PDF storage is local filesystem** (`apps/server/src/bibliography/storage.ts`). Files
  go to `apps/server/uploads/sources/` on disk. Switch to S3/R2 for production (already
  tracked in §6 above). The `storeSourcePdf` function is the only call site; swap the impl there.
- [ ] **Source chunk embeddings use Ollama `bge-m3`** in dev (`model_id = bge-m3`). Run a re-embed
  job against the Titan v2 model (`amazon.titan-embed-text-v2:0`) after switching to Bedrock.
  The §1 re-embed plan must now cover **three** tables: `note_fragment_embeddings`,
  `concept_embeddings`, and `source_chunk_embeddings`. Without all three under the same
  `model_id`, Phase 5 retrieval finds zero matches.
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
  doesn't throttle); it becomes load-bearing once we hit Titan v2 quota.

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
- [ ] **`apps/web/src/lib/cost-rates.ts` is hardcoded** to **Nova Lite** us-east-1
  rates as of 2026-05-17 (post-cutover values). The constants are still named
  `SONNET_*` because they represent the tier role, not the underlying family.
  When AWS publishes rate changes or distinct Nova cache-read/cache-write SKUs,
  update this file. Promote to a server-config endpoint when the `cost_events`
  table lands (Phase 7g).
- [ ] **Completion worker concurrency=1**: `apps/server/src/queue/index.ts` caps
  the completion worker at concurrency 1 (matches the existing audit pattern).
  Spec (`plan.md` §9) calls for concurrency 6. Lift to 4 once `apps/worker` is
  split per §7 above; lift to 6 once Nova Lite quota raises land.
- [ ] **Completion `attempts: 1` (no retry)**: `enqueueCompletion` enqueues with
  `attempts: 1` rather than the spec's `attempts: 5, exponential backoff`.
  Reasoning: Nova Lite calls are cheap but we want guard-failure visibility, not
  silent retry to success. Once we have a way to distinguish transient infra
  errors (Bedrock 503, Titan v2 quota) from model misbehavior (telemetry from
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
  cosines ~0.10–0.20 lower than Titan v2, so the spec floor returns zero chunks even for
  relevant sources during dev. Same root cause as `DEV_OLLAMA_THRESHOLDS` in
  `apps/server/src/audit/router.ts`. Delete the override once Phase 7e ships per-subject
  threshold tuning, OR fold it into the same per-subject threshold snapshot the audit reads.
  **Calibration callout (Nova migration)**: the Bedrock branch floor (`0.55`) was authored
  against Cohere v3. Titan v2 (`normalize: false`) is expected to land in the same band but
  is NOT verified — treat the first post-migration Phase 5 retrieval eval as a calibration
  baseline, not a pass/fail.
- [ ] **No re-similarity caching for the guard**: each guard call re-embeds
  `(paragraph, cited_chunk)` pairs to compute similarity. On Bedrock with Titan
  v2 these embed calls cost ~$0.0002 per completion in extra embed (under
  Titan v2 the extra embed cost drops from ~$0.001 to ~$0.0002/completion;
  deprioritize until Phase 7g cost dashboards land).
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

---

## Phase 6 dev shortcuts

These items are intentional shortcuts taken during Phase 6 implementation.
Each must be closed before shipping the Notion integration to real users.

- [ ] **Notion OAuth credentials not set in dev**. `NOTION_CLIENT_ID`,
  `NOTION_CLIENT_SECRET`, `NOTION_OAUTH_REDIRECT_URI` are commented out in
  `apps/server/.env`. All three OAuth endpoints return 503 with a clear message
  until you create a public Notion integration at https://www.notion.so/my-integrations
  and fill in the values. Phase 0–5 features (stub connector, audit, completion)
  work without them.
  - Setup: Notion integration → Type = "Public" → set redirect URI to
    `http://localhost:8080/api/oauth/notion/callback` → copy client_id + secret.

- [ ] **No webhook subscriptions** (poll-on-demand only). Notion changes are
  picked up only when the user explicitly triggers ingest (`POST /api/subjects/:id/ingest`
  or `POST /dev/ingest`). Real-time sync via Notion webhooks is out of v1 per
  plan §D4. Add webhook subscriptions when Notion's public webhook API is GA.

- [ ] **`listTopLevelResources` returns first 100 results per kind** (no beyond-100
  pagination implemented). Most workspaces fit within 100 databases + 100 pages;
  users with very large workspaces may not see all resources in the wizard.
  Full cursor-based pagination already exists in the `while (cursor)` loop — extend
  to remove the implicit limit when needed.

- [ ] **Connector concurrency = 1 in BullMQ** (unchanged from previous phases).
  Notion API calls inside the ingest worker are serial. Spec calls for per-user
  parallelism once the worker process splits. Tracked in §7 above.

- [ ] **`suggestConfig` heuristic is positional** (first DB = subjects, second = units).
  A proper heuristic should fetch database titles via `/databases/:id` and match
  against `/subject/i` / `/unit/i`. Deferred because it requires an extra Notion API
  call per DB during discovery. The Phase 7a wizard should render a "confirm mapping"
  step where the user can override the suggestion.

- [ ] **`resolveNoteContent` does not recurse into child blocks** of toggled or
  nested blocks (e.g. toggles that contain bullets). Phase 6 extracts only top-level
  block children of a page. Deeply nested blocks are silently skipped. Add recursive
  child-page/block expansion in Phase 7a when the note content quality gate is defined.

- [ ] **OAuth state cleanup job not implemented**. Expired `oauth_states` rows
  accumulate until manually pruned. The `expires_at` index is in place for a
  scheduled `DELETE FROM oauth_states WHERE expires_at < NOW()` job (add to a
  cron worker in Phase 7+).

- [ ] **`POST /api/connections/:id/mappings` deactivates ALL active mappings**
  for a connection when a new mapping is created. This is correct for the single-
  mapping-per-connection v1 model. Multi-mapping support (e.g. mapping multiple
  subjects to different DBs in one workspace) is out of scope until Phase 7a.

- [ ] **`resolveNoteContent` uses externalId as title fallback**. When the note
  title can't be resolved from child_page block metadata (Notion doesn't always
  include `child_page.title` in block children responses), the Notion page ID is
  used as the title. A proper fix: fetch `GET /pages/:id` to read the page title.
  Deferred because it doubles the API calls during note listing.

---

## Phase 6 frontend dev shortcuts

These items are intentional shortcuts taken during Phase 6 frontend
implementation. Each must be closed or reviewed before shipping.

- [ ] **Connect routes are under `_auth/` layout (full shell)**. `/connect/start`
  and `/connect/done` render inside the full app shell (Topbar + NavRail).
  For a cleaner wizard UX, these should use a minimal shell (no nav rail).
  Low priority — the wizard works; it's just slightly over-framed.

- [ ] **`/connect/done` wizard uses component-local `WizardStep` state**.
  If the user refreshes mid-wizard (e.g. on step 2 — discovery), the wizard
  resets to step 1. The `connectionId` is in the URL so recovery is possible,
  but the user has to re-pick the strategy. Consider persisting `strategyKey`
  in a search param (`?strategyKey=...`) so a refresh lands back on step 2.

- [ ] **`useTriggerIngest` in `connect/done` fires on mount with no retry
  circuit-breaker**. The `useEffect` in `IngestStep` enqueues once; if the
  network hiccup causes the POST to fail, the user sees an error and must
  manually retry. The existing `useTriggerIngest` mutation has no built-in
  retry policy. Add `attempts: 2` on the mutation when BullMQ ingest becomes
  reliable enough to distinguish transient from permanent failures.

- [ ] **`StrategyForm` does not reset when `schema` or `defaults` props change**.
  State is seeded from props on first render only (via `useState(() => {...})`).
  In Phase 7a when the strategy picker allows switching strategies, the form
  will still show the previous strategy's values. Fix by passing a `key` prop
  to `StrategyForm` that changes with the strategy key, forcing a remount.

- [ ] **Discovery `ResourceList` shows only `externalId` (the raw Notion UUID)**.
  `ResourceRef` from the server doesn't include a human-readable name. The
  Phase 6 backend shortcut (`suggestConfig` is positional, not title-based)
  means we can't easily resolve names. In Phase 7a, fetch database titles from
  Notion and include them in `ResourceRef` (or as a separate `displayName` field
  on the discovery response) so the wizard shows recognisable names.

- [ ] **`/settings` shows `Reconnect` as an `<a>` tag** (not a router `<Link>`).
  Works fine but bypasses TanStack Router's client-side navigation. Replace
  with `<Link to="/connect/start" search={{ source: "notion" }}>` once the
  reconnect flow is more mature and this cosmetic issue matters.

- [ ] **`useConnections` staleTime is 30s** — slightly aggressive for a settings
  page where the user expects up-to-date connection status. A freshly
  disconnected workspace might still show as "active" for up to 30s. Lower
  to 5s on the `/settings` route or call `queryClient.invalidateQueries`
  on route mount.

- [ ] **No `@noeticai/connector-core` package dep in `apps/web`**. The frontend
  defines its own `FieldDescriptor` / `StrategyDescriptor` types locally
  (in `api/strategies.ts`) rather than importing from `@noeticai/connector-core`.
  The server-side `StrategyDescriptor.configSchema` field is typed `unknown`
  in connector-core, so importing it wouldn't help without augmenting. If
  connector-core exports a frontend-safe `SerializedConfigSchema` type in a
  future phase, add `"@noeticai/connector-core": "workspace:*"` to
  `apps/web/package.json` and remove the duplicate local type.

---

## Phase 7a — Additional Notion Strategies (dev shortcuts + known limitations)

Four new strategies shipped alongside `notion.db-subjects-db-units`. Each needs
real-data validation before being trusted for production workspaces.

- [ ] **`notion.single-db-tagged` — select vs. status fallback is untested on real data**.
  The strategy tries a `select` filter first and falls back to `status` on any API error.
  A Notion workspace that uses a `status` column (not `select`) for the type property will
  trigger the fallback on every query — extra round trips. In Phase 7a, introspect the
  database schema via `GET /databases/:id` to determine the property type up front and
  skip the fallback path. The config wizard should show a note if a `status` property is
  detected.

- [ ] **`notion.single-db-tagged` — self-referencing relation filter returns all matching
  rows regardless of depth**. If a workspace has multi-level relations (Subject → Unit →
  Sub-unit → Note) the relation filter on `Parent` will match at any depth, not just
  direct children. This is benign for well-structured workspaces but can cause unexpected
  results in deep trees. v1.1 mitigation: add a `depth` guard or require users to configure
  separate `parentRelationProperty` values per level.

- [ ] **`notion.page-hierarchy` `suggestConfig` picks the first page**, not the most-recently-
  edited one. `topRes` from `listTopLevelResources` doesn't carry `last_edited_time`, so the
  "most recently edited" heuristic in the spec is deferred. When the connector's
  `listTopLevelResources` is extended to include timestamps or display names (tracked in
  Phase 6 frontend shortcuts), update `suggestConfig` to sort by `last_edited_time` descending
  and pick the top result.

- [ ] **`notion.page-hierarchy` depth=2 synthetic unit id (`${subjectId}:notes`) may collide**
  with a real Notion page id if a user names a page with a UUID that ends in `:notes`. This is
  cosmetically possible but practically impossible (Notion UUIDs are server-assigned hex UUIDs
  without colons). The `:notes` suffix is safe in practice; document this as a known assumption.

- [ ] **`notion.db-subjects-pages-units` metadata property sniffing** (`courseProperty`,
  `termProperty`, `glyphProperty`) is case-insensitive regex against the exact property names
  `Course`, `Term`, `Glyph/Icon/Emoji`. Workspaces using other naming conventions (e.g.,
  "Course Name", "Semester") will not be auto-detected. The user can still type the correct
  property name in the wizard. A Bedrock-assisted heuristic could match fuzzier names — deferred
  to v1.1 once model quality on property-name disambiguation is validated.

- [ ] **`notion.three-dbs` suggestConfig title-matching is greedy and order-dependent**.
  If a workspace has a DB titled "Course Notes" it will match `/notes?|pages?/i` (notesDbId)
  before the subjects heuristic sees it. The matching loop processes DBs in topRes order and
  stops once all three slots are filled. Ambiguous workspaces (e.g., "Notes on Subjects") may
  get incorrect slot assignment. A wizard "confirm mapping" step (Phase 7a) is the recommended
  fix — let the user swap the assignments before saving.

- [ ] **`notion.three-dbs` `noteToUnitRelProperty` fallback**: if the Notes DB's relation
  property points to subjects (not units), `resolveNotes` will return an empty list when called
  with `unitId`. The wizard should surface this case with a clear error rather than silently
  returning zero notes. Add schema introspection to validate that the configured relation
  property target matches the configured `unitsDbId`.

- [ ] **`resolveNoteContent` in all four new strategies does not recurse** into toggle/synced
  blocks. Same limitation as `notion.db-subjects-db-units` (already tracked in Phase 6
  shortcuts). Recursive child-block expansion is a shared v1.1 improvement.

- [ ] **`suggestConfig` in `notion.db-subjects-pages-units` and `notion.three-dbs` fetches
  DB metadata** via `GET /databases/:id` for each DB in `topRes`. This adds N API calls on
  each discovery request (one per database). Acceptable for workspaces with < 20 databases;
  may hit rate limits on large workspaces. Add a cache layer (Redis or in-memory per-request)
  for DB metadata in Phase 7a.

---

## Phase 6 wizard UX upgrade — rich discovery + field pickers

These items were addressed or deferred during the Phase 6b (wizard UX) work that
replaced raw UUID/property-name text inputs with database/page/property pickers.

### What shipped

- **`SerializedField` discriminated union** (`kind: "database" | "page" | "property" | "select-option" | "enum" | "text"`)
  replaces the old `{ type: "string" }` flat shape. The `type` field is gone; use `kind`.
  Frontend must be updated to consume `kind` instead of `type`.

- **`uiSchema` on each strategy** is now served as `descriptor.configSchema` from
  `GET /api/connections/:id/strategies`. All five strategies have an explicit `uiSchema`
  that maps field keys to their picker kind. `serialize-schema.ts` was deleted (it
  is no longer used by anything).

- **`GET /api/connections/:id/strategies/:key/discovery`** now returns
  `{ databases: NotionDatabaseRef[], pages: NotionPageRef[], suggestedConfig }` instead
  of `{ resources: ResourceRef[], suggestedConfig }`. The old `resources` key is gone.
  Frontend discovery step must be updated to use `databases` / `pages`.

- **`suggestConfig` signature changed**: now receives `{ databases, pages, notionClient }`
  instead of `{ topRes, notionClient }`. Old callers passing `topRes` will not compile.

- **`listTopLevelResourcesRich`** is a new export from `connector.ts` — separate from
  `listTopLevelResources` (ingest pipeline, still returns `ResourceRef[]`).
  Uses Redis cache key `notion:topResRich:${connectionId}` (5 min TTL).

- **Two new endpoints** added to `connections/router.ts`:
  - `GET /api/connections/:id/databases/:dbId/schema` → `{ properties: PropertyDescriptor[] }`
  - `GET /api/connections/:id/databases/:dbId/properties/:propName/options`
    → `{ options: { value, label, color? }[] }`
  Both use Redis cache (5 min TTL: `notion:dbSchema:${dbId}`, `notion:propOptions:${dbId}:${propName}`).
  Both require auth + ownership check (404 otherwise).

- **`suggestConfig` upgraded** across all five strategies to use titles from the rich
  discovery list (no extra API calls needed for `db-subjects-db-units` and `three-dbs`;
  `db-subjects-pages-units` still fetches one DB for property sniffing when a title match
  is found).

### Deferred / known limitations

- [ ] **Frontend wizard not yet updated** to consume `kind`-based `SerializedField` or
  the new `databases`/`pages` discovery shape. The backend contract is final; the frontend
  wizard still renders generic text inputs from the old shape. Phase 7a frontend work.

- [ ] **`GET /strategies` `configSchema` field** on `StrategyDescriptor` is typed `unknown`
  in `@noeticai/connector-core`. Now it carries a `SerializedConfigSchema` (the uiSchema).
  When `connector-core` is next versioned, narrow the type to `SerializedConfigSchema`.

- [ ] **`notion:topResRich` cache is separate from `notion:topRes`**. Both caches are
  populated on independent calls (one for ingest, one for discovery). They are not
  invalidated together. If a user connects a new workspace and immediately opens the
  wizard, they may see a stale rich list for up to 5 min while the regular topRes cache
  is also stale. Acceptable for v1; add a cache invalidation on `POST /api/oauth/notion/callback`
  in Phase 7+.

- [ ] **`db-subjects-pages-units` `suggestConfig` still makes one extra `/databases/:id`
  fetch** when a title match is found (to sniff property names). This is a single call
  per discovery, not N calls, which is acceptable. The `notion.three-dbs` strategy no
  longer makes extra calls (title matching is now done from the rich discovery list directly).

- [ ] **`select-option` fields require two prior picks** (database then property) before
  the wizard can show options. The schema and options endpoints are lazy (called on
  demand by the frontend). If the user picks a database and then immediately tries to
  pick a select-option value without first picking the type property, the wizard must
  enforce the dependency order. This is a frontend concern; the backend endpoints are
  stateless.

- [ ] **Property picker does not validate that the user-selected property name actually
  exists in the database** at mapping save time. The Zod config schema only validates
  that the value is a non-empty string. Full validation (e.g., "does `subjectRefPropOnUnit`
  exist in `unitsDbId` and is it of type `relation`?") requires an extra Notion API call
  at `POST /api/connections/:id/mappings` time. Deferred to Phase 7a.

Last updated: 2026-05-15 (Phase 6 wizard UX upgrade).

---

## Multi-subject selection (Phase 6b)

### What shipped

- **`POST /api/connections/:id/mappings` contract changed**: no longer auto-creates a
  subject row or returns `subjectId`. Returns `{ mappingId, availableSubjectsCount }`
  instead. Frontend connect wizard must now advance to a subject-picker step.

- **`GET /api/connections/:id/mappings/:mappingId/available-subjects`**: new endpoint
  returning all subjects visible in the workspace, annotated with `tracked: true` if
  the subject row already exists for this user. Cached 30s in Redis under
  `notion:availableSubjects:<mappingId>`. Shared by the wizard and settings panel.

- **`POST /api/connections/:id/mappings/:mappingId/subjects/sync`**: new endpoint that
  reconciles the tracked subject set to the provided `externalIds` list.
  Inserts new rows (hydrated from the 30s cache), hard-deletes rows that were created
  via THIS connection but are absent from the list. If `kickIngest: true`, enqueues
  one BullMQ job per newly added subject.

- **`subjects.connection_id` column** added (TEXT NULL, FK to `source_connections` with
  `ON DELETE SET NULL`). Migration: `0008_phase6_multi_subject.sql`. Existing rows keep
  `NULL` (created via stub or dev paths).

- **`runIngest` signature changed**: now requires `subjectExternalId: string`. Each job
  processes ONE subject. `POST /api/subjects/:id/ingest` passes the subject id directly.
  `POST /dev/ingest` auto-detects the stub's single subject when `source === "stub"` for
  backward compatibility (stub-only convenience).

### Deferred to v1.1

- [ ] **Soft-delete instead of hard-delete** for un-tracked subjects. v1 hard-deletes the
  subject row and all descendants (units, notes, fragments, embeddings, syllabuses, audit
  runs, etc.) via FK cascades. A soft-delete (`archived_at`) + async purge job would give
  a recovery window. Defer until first production incident.
- [ ] **Batch-ingest progress aggregation**. When `subjects/sync` enqueues N jobs, there
  is no aggregated progress endpoint. The frontend must poll each `jobId` individually
  (via `GET /api/jobs/:id`). A batch-job wrapper (BullMQ Flow) that rolls up N per-subject
  jobs under one parent job id would simplify the UI.
- [ ] **Re-ingest on demand** for already-tracked subjects. `subjects/sync` only enqueues
  ingest for newly added subjects. If the user wants to force a re-ingest of an already-
  tracked subject, they must use `POST /api/subjects/:id/ingest`. A `forceReingest: true`
  flag on `subjects/sync` could cover this.
- [ ] **Webhook-driven invalidation of the 30s available-subjects cache**. When the
  connector reports a workspace change, the cache should be purged so the user sees fresh
  data immediately. Currently the cache is 30s TTL with no external invalidation.
- [ ] **Per-subject ingest status on the settings panel**. The settings "Manage subjects"
  panel (wired by the frontend agent) currently has no per-subject ingest state. Add a
  `last_ingested_at` column to `subjects` and surface it in `GET /available-subjects`.

---

## Phase 6 syllabus fix

Corrects the double-subject bug introduced when the syllabus upload path pre-dated
the Notion connect wizard.  `POST /api/syllabus` now requires an existing `subjectId`
and validates ownership (404/403) instead of auto-creating a synthetic subject.
The extraction job (`syllabus/job.ts`) no longer touches the `subjects` table;
the subject row created via the Notion wizard remains the single source of truth.

- [ ] **Existing dev subjects created via the old syllabus path may need manual cleanup**.
  A one-shot SQL to find them (no Notion connection, created via the synthetic hash path):
  ```sql
  DELETE FROM subjects WHERE connection_id IS NULL AND id NOT IN (
    SELECT DISTINCT user_id FROM "user" -- adapt to your seed data
  );
  ```
  Or simply wipe and re-onboard dev data (recommended — faster than surgical cleanup).
- [ ] **No NOT NULL constraint added to `syllabuses.subject_id`** — the column was already
  `NOT NULL` per the Phase 2 schema (`curriculum.ts`). No migration needed.

Last updated: 2026-05-16 (Phase 6 syllabus fix).
