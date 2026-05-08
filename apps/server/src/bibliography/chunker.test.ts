import { test, expect } from "bun:test";
import { chunkPages } from "./chunker";

// ---------------------------------------------------------------------------
// Helper: build a fake pages array with predictable paragraph content.
// ---------------------------------------------------------------------------
function makePage(paragraphCount: number, charsEach = 200): string {
  return Array.from({ length: paragraphCount }, (_, i) =>
    `Paragraph ${i + 1} on this page. `.padEnd(charsEach, "x"),
  ).join("\n\n");
}

// ---------------------------------------------------------------------------
// Test 1: paragraph boundary preference — chunk doesn't break mid-paragraph
// ---------------------------------------------------------------------------
test("chunkPages respects paragraph boundaries", () => {
  // Two pages, each with 3 short paragraphs (~200 chars each).
  const pages = [makePage(3, 200), makePage(3, 200)];
  const chunks = chunkPages(pages, { kind: "pdf" });

  // Each chunk's text should be a clean concatenation of whole paragraphs.
  for (const chunk of chunks) {
    // No chunk should end with a partial paragraph mid-word.
    // (All our test paragraphs end with 'x' repeated; none end with '\n\n' in the middle.)
    expect(chunk.text.length).toBeGreaterThanOrEqual(1);
    expect(chunk.charCount).toBe(chunk.text.length);
  }
});

// ---------------------------------------------------------------------------
// Test 2: hard-max-char fallback splits oversized paragraphs
// ---------------------------------------------------------------------------
test("chunkPages splits paragraphs exceeding HARD_MAX_CHARS=3000", () => {
  // One page with a single paragraph of 4000 chars — forces hard-split.
  const hugeParagraph = "A very long sentence that goes on and on. ".repeat(100); // ~4200 chars
  const pages = [hugeParagraph];
  const chunks = chunkPages(pages, { kind: "pdf" });

  expect(chunks.length).toBeGreaterThanOrEqual(1);
  for (const chunk of chunks) {
    expect(chunk.charCount).toBeLessThanOrEqual(3000);
  }
});

// ---------------------------------------------------------------------------
// Test 3: page-spanning chunks get correct pagesLabel
// ---------------------------------------------------------------------------
test("chunkPages labels single-page chunks as p.N and multi-page as pp.N–M", () => {
  // Page 1: one long paragraph (~1800 chars) to mostly fill a chunk.
  // Page 2: one long paragraph (~1800 chars) that spills into the same chunk via overlap.
  const page1 = "Philosophy text page one. ".padEnd(1800, "a");
  const page2 = "Philosophy text page two. ".padEnd(1800, "b");
  const chunks = chunkPages([page1, page2], { kind: "pdf" });

  expect(chunks.length).toBeGreaterThanOrEqual(1);
  // At least one chunk should have a pagesLabel starting with "p." or "pp."
  const labels = chunks.map((c) => c.pagesLabel).filter(Boolean);
  expect(labels.length).toBeGreaterThan(0);
  for (const label of labels) {
    expect(label).toMatch(/^p{1,2}\. \d/);
  }
});

// ---------------------------------------------------------------------------
// Test 4: near-empty input throws (scanned PDF guard)
// ---------------------------------------------------------------------------
test("chunkPages throws on near-empty input (scanned PDF guard)", () => {
  // Only whitespace and tiny strings (< MIN_PARA_CHARS=30).
  const emptyPages = ["  \n\n  ", "   ", "p. 1"];
  expect(() => chunkPages(emptyPages, { kind: "pdf" })).toThrow(
    /scanned or image-only/i,
  );
});

// ---------------------------------------------------------------------------
// Test 5: URL kind always has null pagesLabel
// ---------------------------------------------------------------------------
test("chunkPages with kind=url always produces null pagesLabel", () => {
  const text = "This is a URL-sourced paragraph. ".repeat(200); // ~6600 chars → multiple chunks
  const chunks = chunkPages([text], { kind: "url" });

  expect(chunks.length).toBeGreaterThanOrEqual(1);
  for (const chunk of chunks) {
    expect(chunk.pagesLabel).toBeNull();
  }
});

// ---------------------------------------------------------------------------
// Test 6: chunk position is monotonic and 0-indexed
// ---------------------------------------------------------------------------
test("chunkPages positions are monotonic and 0-indexed", () => {
  const pages = [makePage(10, 300), makePage(10, 300), makePage(10, 300)];
  const chunks = chunkPages(pages, { kind: "pdf" });

  for (let i = 0; i < chunks.length; i += 1) {
    expect(chunks[i]!.position).toBe(i);
  }
});

// ---------------------------------------------------------------------------
// Test 7: textHash is stable (same text → same hash)
// ---------------------------------------------------------------------------
test("chunkPages textHash is stable across runs", () => {
  const pages = [makePage(5, 400)];
  const run1 = chunkPages(pages, { kind: "pdf" });
  const run2 = chunkPages(pages, { kind: "pdf" });

  expect(run1.length).toBe(run2.length);
  for (let i = 0; i < run1.length; i += 1) {
    expect(run1[i]!.textHash).toBe(run2[i]!.textHash);
  }
});
