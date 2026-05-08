export interface FetchedUrl {
  text: string;
  externalUrl: string;
  byteCount: number;
}

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const FETCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;

// Minimal HTML entity decoder (amp/lt/gt/quot/apos/nbsp).
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ");
}

/**
 * Strip HTML tags and boilerplate, returning plain paragraph text.
 *
 * v1 — crude tag-strip only. No @mozilla/readability (deferred to v1.1 if
 * source-recall eval drops below 0.8 specifically on URL fixtures).
 */
function stripHtml(html: string): string {
  // Remove <script>…</script> and <style>…</style> blocks (greedy, case-insensitive).
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");

  // Remove structural boilerplate blocks.
  text = text
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
    .replace(/<form[\s\S]*?<\/form>/gi, " ");

  // Strip remaining tags.
  text = text.replace(/<[^>]+>/g, " ");

  // Decode HTML entities.
  text = decodeHtmlEntities(text);

  // Collapse whitespace.
  text = text.replace(/\s+/g, " ").trim();

  return text;
}

/**
 * Fetch a URL and return stripped plain text suitable for chunking.
 *
 * Throws with a descriptive message for all failure modes so the job
 * can persist failure_reason verbatim.
 */
export async function fetchUrl(rawUrl: string): Promise<FetchedUrl> {
  // Validate: must be http(s).
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`URL must use http or https (got ${parsed.protocol})`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(parsed.href, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "NoeticAI/1.0 (bibliography-ingest)",
      },
    });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`URL fetch timed out after ${FETCH_TIMEOUT_MS / 1000}s`);
    }
    throw new Error(`URL fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  clearTimeout(timer);

  if (!response.ok) {
    throw new Error(`URL returned HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  const isHtml = contentType.includes("text/html");
  const isText = contentType.includes("text/plain");

  if (!isHtml && !isText) {
    throw new Error(`URL is not HTML or plain text (got ${contentType})`);
  }

  // Read body with a size cap.
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("URL response has no body");
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.length;
    if (totalBytes > MAX_BYTES) {
      reader.cancel().catch(() => {});
      throw new Error("URL response exceeds 5 MB cap");
    }
    chunks.push(value);
  }

  const bodyBuffer = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bodyBuffer.set(chunk, offset);
    offset += chunk.length;
  }

  const bodyText = new TextDecoder("utf-8").decode(bodyBuffer);

  let plainText: string;
  if (isHtml) {
    plainText = stripHtml(bodyText);
  } else {
    plainText = bodyText.trim();
  }

  if (plainText.length < 200) {
    throw new Error(
      "URL produced no extractable text (likely paywalled or JS-only)",
    );
  }

  // Canonical URL is the final redirected URL.
  const externalUrl = response.url || parsed.href;

  return {
    text: plainText,
    externalUrl,
    byteCount: plainText.length,
  };
}
