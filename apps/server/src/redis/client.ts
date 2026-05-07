import IORedis from "ioredis";
import { env } from "../env";

// BullMQ requires maxRetriesPerRequest: null on the connection it uses.
// We use one shared connection for both BullMQ and ad-hoc cache reads.
export const redis = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  lazyConnect: false,
});

redis.on("error", (err) => {
  // eslint-disable-next-line no-console
  console.error("[redis] error:", err.message);
});

export default redis;
