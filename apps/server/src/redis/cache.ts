import { redis } from "./client";

// Generic read-through cache over Redis.
// On parse failure the cached value is treated as a miss so the loader
// re-runs — this prevents a bad write from permanently breaking a key.
export async function cacheWrap<T>(
  key: string,
  ttlSeconds: number,
  loader: () => Promise<T>,
): Promise<T> {
  const cached = await redis.get(key);
  if (cached !== null) {
    try {
      return JSON.parse(cached) as T;
    } catch {
      // Corrupt cache entry — fall through and re-load.
    }
  }

  const value = await loader();
  // Best-effort write; a Redis failure here should not surface to callers.
  try {
    await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[cache] redis write failed, continuing without cache:", err);
  }
  return value;
}
