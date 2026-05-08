import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Chunking constants — tunable. If recall < 0.8, reduce TARGET_CHARS first.
// ---------------------------------------------------------------------------
const TARGET_CHARS = 2000;     // ~500 tokens at ~4 chars/token
const OVERLAP_CHARS = 200;     // ~50 tokens; preserves cross-boundary meaning
const HARD_MAX_CHARS = 3000;   // never exceed (paragraph-respecting only when feasible)
const MIN_CHARS = 200;         // discard dust: page footers, headers, lone page numbers
const MIN_PARA_CHARS = 30;     // drop paragraphs shorter than this (page numbers, headers)

export interface SourceChunk {
  position: number;         // 0-indexed, monotonic within source
  text: string;             // plain UTF-8, NFC-normalised, whitespace-collapsed
  textHash: string;         // sha256(text) — for skip-if-embedded idempotency check
  pagesLabel: string | null; // "p. 12" or "pp. 12–14"; null for URL ingest
  chapterLabel: string | null; // v1: always null; reserved
  charCount: number;
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Normalise a block of text: NFC, collapse runs of whitespace, trim.
 */
function normalise(s: string): string {
  return s
    .replace(/\r\n/g, "\n")
    .normalize("NFC")
    .replace(/[^\S\n]+/g, " ") // collapse non-newline whitespace
    .trim();
}

/**
 * Build a pages_label from a set of 1-indexed page numbers.
 * Single page → "p. 12". Range → "pp. 12–14" (en-dash).
 */
function buildPagesLabel(pageNums: Set<number>): string {
  if (pageNums.size === 0) return "p. 1";
  const sorted = Array.from(pageNums).sort((a, b) => a - b);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  if (first === last) return `p. ${first}`;
  return `pp. ${first}–${last}`; // en-dash
}

/**
 * Split a long paragraph on sentence boundaries first, then hard-char-window
 * anything that still exceeds HARD_MAX_CHARS.
 */
function splitLongParagraph(para: string): string[] {
  // Split on sentence boundaries.
  const sentences = para.split(/(?<=[.!?])\s+/);

  const result: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (current.length === 0) {
      current = sentence;
    } else if (current.length + 1 + sentence.length <= HARD_MAX_CHARS) {
      current += " " + sentence;
    } else {
      if (current.length > 0) result.push(current);
      current = sentence;
    }
  }
  if (current.length > 0) result.push(current);

  // Hard-char-window anything still too long.
  const final: string[] = [];
  for (const chunk of result) {
    if (chunk.length <= HARD_MAX_CHARS) {
      final.push(chunk);
    } else {
      let i = 0;
      while (i < chunk.length) {
        final.push(chunk.slice(i, i + HARD_MAX_CHARS));
        i += HARD_MAX_CHARS;
      }
    }
  }
  return final;
}

interface TaggedParagraph {
  text: string;
  pageNum: number; // 1-indexed
}

/**
 * For PDF: tag each paragraph with the page it came from.
 * For URL: tag all paragraphs with pageNum=0 (no page tracking).
 */
function buildTaggedParagraphs(
  pages: string[],
  kind: "pdf" | "url",
): TaggedParagraph[] {
  const result: TaggedParagraph[] = [];

  if (kind === "url") {
    // Single combined text; treat as pageNum=0 (no page tracking).
    const combined = pages.join("\n\n");
    const normalised = normalise(combined);
    const paras = normalised.split(/\n{2,}/);
    for (const para of paras) {
      const trimmed = para.trim();
      if (trimmed.length >= MIN_PARA_CHARS) {
        result.push({ text: trimmed, pageNum: 0 });
      }
    }
    return result;
  }

  // PDF: process page by page, preserving page origin.
  for (let i = 0; i < pages.length; i += 1) {
    const pageNum = i + 1; // 1-indexed
    const pageText = normalise(pages[i] ?? "");
    const paras = pageText.split(/\n{2,}/);
    for (const para of paras) {
      const trimmed = para.trim();
      if (trimmed.length >= MIN_PARA_CHARS) {
        result.push({ text: trimmed, pageNum });
      }
    }
  }
  return result;
}

/**
 * Pure function: turn pages (PDF) or a single text block (URL) into chunks.
 *
 * Algorithm:
 * 1. Build tagged paragraphs (paragraph text + source page number).
 * 2. Greedy-accumulate paragraphs into a buffer until TARGET_CHARS.
 *    - Paragraphs > HARD_MAX_CHARS are split first.
 * 3. Emit chunk with overlap = last paragraph (or last OVERLAP_CHARS slice).
 * 4. Track pagesSpanned per chunk → pagesLabel.
 * 5. Discard chunks shorter than MIN_CHARS (dust from OCR/extraction noise).
 * 6. If zero chunks produced, throw (PDF is likely scanned/image-only).
 */
export function chunkPages(
  pages: string[],
  opts: { kind: "pdf" | "url" },
): SourceChunk[] {
  const taggedParas = buildTaggedParagraphs(pages, opts.kind);

  if (taggedParas.length === 0) {
    throw new Error(
      "PDF appears to be scanned or image-only — no extractable text. OCR is not supported in v1.",
    );
  }

  // Expand any paragraph that exceeds HARD_MAX_CHARS.
  const expandedParas: TaggedParagraph[] = [];
  for (const tp of taggedParas) {
    if (tp.text.length > HARD_MAX_CHARS) {
      const parts = splitLongParagraph(tp.text);
      for (const part of parts) {
        expandedParas.push({ text: part, pageNum: tp.pageNum });
      }
    } else {
      expandedParas.push(tp);
    }
  }

  const chunks: SourceChunk[] = [];
  let position = 0;

  // Current buffer state.
  let bufferParas: TaggedParagraph[] = [];
  let bufferLen = 0;
  let pagesSpanned = new Set<number>();

  const flushBuffer = () => {
    const text = bufferParas.map((p) => p.text).join("\n\n");
    if (text.length < MIN_CHARS) return; // discard dust

    const label =
      opts.kind === "pdf" && pagesSpanned.size > 0
        ? buildPagesLabel(pagesSpanned)
        : null;

    chunks.push({
      position,
      text,
      textHash: sha256Hex(text),
      pagesLabel: label,
      chapterLabel: null, // v1: always null
      charCount: text.length,
    });
    position += 1;
  };

  for (const para of expandedParas) {
    const addLen = bufferLen === 0 ? para.text.length : 1 + para.text.length; // +1 for \n\n sep

    if (bufferLen > 0 && bufferLen + addLen > TARGET_CHARS) {
      // Flush current buffer.
      flushBuffer();

      // Build overlap: carry forward the last paragraph (or last OVERLAP_CHARS).
      const lastPara = bufferParas[bufferParas.length - 1];
      if (lastPara) {
        const overlapText =
          lastPara.text.length > OVERLAP_CHARS
            ? lastPara.text.slice(-OVERLAP_CHARS)
            : lastPara.text;
        bufferParas = [{ text: overlapText, pageNum: lastPara.pageNum }];
        bufferLen = overlapText.length;
        pagesSpanned = new Set([lastPara.pageNum]);
      } else {
        bufferParas = [];
        bufferLen = 0;
        pagesSpanned = new Set();
      }
    }

    bufferParas.push(para);
    bufferLen = bufferParas.reduce((sum, p) => sum + p.text.length, 0)
      + Math.max(0, bufferParas.length - 1) * 2; // account for \n\n separators
    if (para.pageNum > 0) pagesSpanned.add(para.pageNum);
  }

  // Flush remaining buffer.
  flushBuffer();

  if (chunks.length === 0) {
    throw new Error(
      "PDF appears to be scanned or image-only — no extractable text. OCR is not supported in v1.",
    );
  }

  return chunks;
}
