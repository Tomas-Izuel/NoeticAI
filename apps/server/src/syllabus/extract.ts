import { extractText, getDocumentProxy } from "unpdf";

export interface ExtractedPdf {
  text: string;
  pageCount: number;
}

/**
 * Extract plain text + page count from a PDF buffer using unpdf.
 * `mergePages: true` concatenates all page texts into a single string,
 * which is what the Opus extraction prompt expects.
 */
export async function extractPdfText(bytes: Uint8Array): Promise<ExtractedPdf> {
  const pdf = await getDocumentProxy(bytes);
  const result = await extractText(pdf, { mergePages: true });
  return {
    text: result.text,
    pageCount: result.totalPages,
  };
}
