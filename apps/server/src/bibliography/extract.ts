import { extractText, getDocumentProxy } from "unpdf";

export interface ExtractedPdfPages {
  pages: string[];        // index 0 = page 1
  pageCount: number;
}

/**
 * Extract per-page text from a PDF buffer using unpdf.
 * `mergePages: false` (the default) returns an array of page strings,
 * which is required for accurate pages_label tracking in the chunker.
 */
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
