/**
 * Phase 2 eval gate (implementation.md §"Phase 2 / Validation gate"):
 *   - Concept-extraction precision ≥ 0.85 vs. golden labels (Bedrock only)
 *   - On Ollama: precision > 0 (smoke test only); logs observed precision.
 *   - Requires: apps/server/__eval__/syllabus-fixture.pdf (user-provided)
 *               apps/server/__eval__/syllabus-golden.json (user-provided)
 *   - Self-skips if either fixture file is absent or NOETICAI_EVAL_LIVE != "1".
 *
 * The golden JSON shape:
 *   { "concepts": string[] }   — list of canonical concept names (lowercase)
 *
 * Fuzzy match: normalise both sides to lowercase + trim; a concept is a "hit"
 * if an extracted name shares ≥ 0.75 of characters via normalised Levenshtein
 * similarity, or if one string is a substring of the other (≥ 4 chars).
 */
import { test, expect } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { schema } from "@noeticai/db";
import { db } from "../src/db";
import { runSyllabusExtraction } from "../src/syllabus/job";
import { env } from "../src/env";

const EVAL_DIR = import.meta.dir;
const FIXTURE_PDF = join(EVAL_DIR, "syllabus-fixture.pdf");
const GOLDEN_JSON = join(EVAL_DIR, "syllabus-golden.json");

const LIVE = process.env.NOETICAI_EVAL_LIVE === "1";

interface Golden {
  concepts: string[];
}

// ---------------------------------------------------------------------------
// Minimal Levenshtein-based similarity (inline, no external deps)
// ---------------------------------------------------------------------------

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]!;
      } else {
        dp[i]![j] =
          1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
      }
    }
  }
  return dp[m]![n]!;
}

function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

function normalise(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-záéíóúüñ\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Returns true if the extracted concept name fuzzy-matches any golden concept.
 * Criteria (either):
 *   - normalised Levenshtein similarity ≥ 0.75
 *   - one is a substring of the other (≥ 4 chars)
 */
function matchesGolden(extracted: string, golden: string[]): boolean {
  const norm = normalise(extracted);
  for (const g of golden) {
    const normG = normalise(g);
    if (similarity(norm, normG) >= 0.75) return true;
    if (
      norm.length >= 4 &&
      normG.length >= 4 &&
      (norm.includes(normG) || normG.includes(norm))
    ) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test("Phase 2 syllabus extraction precision", async () => {
  if (!LIVE) {
    // eslint-disable-next-line no-console
    console.log("skipping live eval — set NOETICAI_EVAL_LIVE=1 to run");
    return;
  }

  if (!existsSync(FIXTURE_PDF)) {
    // eslint-disable-next-line no-console
    console.log(
      `skipping — fixture PDF not found at ${FIXTURE_PDF}\n` +
        "Provide __eval__/syllabus-fixture.pdf to run this eval.",
    );
    return;
  }

  if (!existsSync(GOLDEN_JSON)) {
    // eslint-disable-next-line no-console
    console.log(
      `skipping — golden JSON not found at ${GOLDEN_JSON}\n` +
        "Provide __eval__/syllabus-golden.json to run this eval.",
    );
    return;
  }

  // Load golden concepts.
  const golden = JSON.parse(
    readFileSync(GOLDEN_JSON, "utf8"),
  ) as Golden;
  expect(golden.concepts.length).toBeGreaterThan(0);

  // Resolve a real user_id from the auth table.
  const userRow = await db.execute<{ id: string }>(sql`
    SELECT id FROM "user" ORDER BY created_at ASC LIMIT 1
  `);
  const userId = userRow.rows[0]?.id;
  if (!userId) {
    throw new Error("no users found — sign up via the web UI first");
  }

  // Build a temporary syllabus row pointing at the fixture PDF.
  // We use a deterministic ID so re-runs reuse the same row (idempotent).
  const fixtureHash = createHash("sha256")
    .update(readFileSync(FIXTURE_PDF))
    .digest("hex")
    .slice(0, 24);
  const syllabusId = `eval-${fixtureHash}`;

  // Ensure a placeholder subject exists.
  const placeholderSubjectId = createHash("sha256")
    .update(userId + "eval-syllabus-fixture")
    .digest("hex")
    .slice(0, 24);

  await db.execute(sql`
    INSERT INTO ${schema.subjects} (id, user_id, name, lang)
    VALUES (${placeholderSubjectId}, ${userId}, 'eval-syllabus-fixture', 'es')
    ON CONFLICT (id) DO NOTHING
  `);

  // Relative path from SERVER_ROOT is what the job uses to open the file.
  // The job resolves absolute = join(SERVER_ROOT, relativePath).
  // Our fixture sits at __eval__/syllabus-fixture.pdf. SERVER_ROOT is
  // apps/server (two levels above src/syllabus), so the relative path
  // that resolves back to the fixture is:
  //   "__eval__/syllabus-fixture.pdf"
  // (no leading slash — join(SERVER_ROOT, "__eval__/...") resolves correctly).
  const relativePath = join("__eval__", "syllabus-fixture.pdf");

  await db.execute(sql`
    INSERT INTO ${schema.syllabuses} (
      id, subject_id, version, status, source_path, source_filename, is_active
    )
    VALUES (
      ${syllabusId},
      ${placeholderSubjectId},
      1,
      'queued',
      ${relativePath},
      'syllabus-fixture.pdf',
      FALSE
    )
    ON CONFLICT (id) DO UPDATE SET
      status = 'queued',
      subject_id = ${placeholderSubjectId}
  `);

  // Run extraction inline (not through BullMQ).
  const result = await runSyllabusExtraction({ syllabusId, userId });

  expect(result.conceptCount).toBeGreaterThan(0);

  // Fetch extracted concept names.
  const conceptRows = await db.execute<{ name: string }>(sql`
    SELECT name FROM ${schema.concepts}
    WHERE syllabus_id = ${syllabusId}
  `);
  const extractedNames = conceptRows.rows.map((r) => r.name);

  // Compute precision = extracted-that-match-golden / total-extracted.
  let hits = 0;
  const misses: string[] = [];
  for (const name of extractedNames) {
    if (matchesGolden(name, golden.concepts)) {
      hits += 1;
    } else {
      misses.push(name);
    }
  }

  const precision = extractedNames.length > 0 ? hits / extractedNames.length : 0;

  // eslint-disable-next-line no-console
  console.log(
    `\nPhase 2 extraction precision: ${(precision * 100).toFixed(1)}%` +
      ` (${hits}/${extractedNames.length} concepts matched golden)\n`,
  );

  if (misses.length > 0) {
    // eslint-disable-next-line no-console
    console.log("unmatched concepts:\n  " + misses.join("\n  "));
  }

  // On Ollama (dev): just assert > 0 and log — don't enforce 0.85.
  // On Bedrock (prod): must meet the Phase 2 quality gate.
  if (env.NOETICAI_AI_BACKEND === "ollama") {
    expect(precision).toBeGreaterThan(0);
  } else {
    expect(precision).toBeGreaterThanOrEqual(0.85);
  }
}, 300_000);
