# NoeticAI eval harness

This directory holds eval fixtures and live integration tests. Tests self-skip
when `NOETICAI_EVAL_LIVE !== "1"` or when required fixture files are missing,
so `bun test` in CI stays green without infra.

## Running evals

```bash
# From apps/server
NOETICAI_EVAL_LIVE=1 bun test __eval__/retrieval-recall.test.ts
NOETICAI_EVAL_LIVE=1 bun test __eval__/source-recall.test.ts __eval__/source-rerun.test.ts
```

## Phase 4 fixture PDF

`source-fixture.pdf` must be added by hand — it cannot be generated automatically.
The file goes here: `apps/server/__eval__/source-fixture.pdf`

**Requirements:**
- ~50 pages of philosophy-domain text in English
- Selectable/searchable text (NOT a scanned image-only PDF — `unpdf` requires extractable text)
- Public domain or Creative Commons licensed

**Suggested candidates:**

1. **Stanford Encyclopedia of Philosophy** — most SEP articles are ~15–30 pages as PDF.
   Combine 2–3 articles on epistemology (e.g. "Epistemology", "Foundationalist Theories of
   Epistemic Justification", "Coherentism in Epistemology") into a single PDF.
   URL: https://plato.stanford.edu/

2. **Project Gutenberg philosophy texts** — Hume's *An Enquiry Concerning Human Understanding*
   (https://www.gutenberg.org/ebooks/9662) is ~100 pages; use the first 50.
   Descartes' *Meditations on First Philosophy* (~40 pages, padded with translator's preface)
   is another option.

3. **Open-access journal articles** — PhilArchive (https://philarchive.org/) and PhilPapers
   (https://philpapers.org/) host many open-access epistemology papers in PDF.

**After adding the file:**

1. Update `source-spotchecks.json` with hand-labeled `expectedPagesLabel` values matching
   the actual chunk positions in YOUR fixture (current values are placeholders for
   BonJour 1985).
2. Update `source-recall.json` queries to match passages in your fixture.
3. Run `NOETICAI_EVAL_LIVE=1 bun test __eval__/source-recall.test.ts` to verify.

## Test files

| File | Phase | Gate |
|------|-------|------|
| `retrieval-recall.test.ts` | 1 | Fragment retrieval top-1 recall ≥ 8/10 |
| `source-recall.test.ts` | 4 | Source chunk count 35–75, pages_label ≥ 8/10, retrieval recall ≥ 8/10 |
| `source-rerun.test.ts` | 4 | Rerun produces zero new chunks/embeddings |
| `syllabus-extraction.test.ts` | 2 | Extraction precision ≥ 0.85 (Bedrock only) |
| `verdicts.test.ts` | 3 | Verdict accuracy ≥ 0.85 (Bedrock only) |
| `gaps.test.ts` | 3 | Gap detection precision/recall ≥ 0.85 (Bedrock only) |
| `smoke.test.ts` | all | Smoke tests — no NOETICAI_EVAL_LIVE required |
