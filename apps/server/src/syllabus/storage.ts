import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

// Resolve the server root from this file's location:
//   src/syllabus/storage.ts → two levels up → apps/server
const SERVER_ROOT = (() => {
  const here = fileURLToPath(new URL(".", import.meta.url));
  return join(here, "..", "..");
})();

const UPLOADS_DIR = join(SERVER_ROOT, "uploads", "syllabuses");

export interface StoredFile {
  relativePath: string;
  absolutePath: string;
  filename: string;
  bytes: number;
}

/**
 * Sanitize a user-supplied filename for safe on-disk storage.
 * - Strips any path separators (prevents directory traversal).
 * - Replaces non-alphanumeric characters (except hyphens/underscores) with
 *   hyphens so the result is a valid, readable slug.
 * - Always appends .pdf to enforce the extension.
 * - Caps at 64 characters before the extension.
 */
function safeFilename(original: string): string {
  // Drop path components a malicious client might include.
  const base = original
    .replace(/[/\\]/g, "-")
    .replace(/\.pdf$/i, "")
    .trim();

  // Slug-ify: keep letters, digits, hyphens, underscores.
  const slugged = base
    .replace(/[^a-zA-Z0-9\-_À-ɏ]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

  return (slugged.length > 0 ? slugged : "syllabus") + ".pdf";
}

/**
 * Write a syllabus PDF to the local uploads directory and return path info.
 *
 * The stored filename is:
 *   `<randomUUID>-<sanitized-original-name>`
 *
 * relativePath is relative to SERVER_ROOT (e.g. "uploads/syllabuses/...")
 * absolutePath is the full filesystem path.
 *
 * NOTE (prod-changes.md §6): this writes to local filesystem. Production
 * should swap this module for an S3/R2-backed implementation with signed URLs.
 */
export async function storeSyllabusPdf(opts: {
  bytes: Uint8Array;
  originalFilename: string;
}): Promise<StoredFile> {
  await mkdir(UPLOADS_DIR, { recursive: true });

  const safe = safeFilename(opts.originalFilename);
  const filename = `${randomUUID()}-${safe}`;
  const absolutePath = join(UPLOADS_DIR, filename);
  const relativePath = join("uploads", "syllabuses", filename);

  await writeFile(absolutePath, opts.bytes);

  return {
    relativePath,
    absolutePath,
    filename,
    bytes: opts.bytes.length,
  };
}
