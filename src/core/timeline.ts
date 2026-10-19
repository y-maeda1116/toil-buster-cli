import type { LogEvent } from "../providers/types.js";

export interface TimeBucket {
  start: Date;
  end: Date;
  count: number;
}

export const MAX_BUCKETS = 200;

export function computeTimeline(
  events: readonly LogEvent[],
  window: { start: Date; end: Date },
  bucketMs: number
): TimeBucket[] {
  const windowMs = window.end.getTime() - window.start.getTime();
  const bucketCount = Math.ceil(windowMs / bucketMs);
  if (bucketCount > MAX_BUCKETS) {
    throw new Error(
      `バケット数が多すぎます (${bucketCount} > ${MAX_BUCKETS})。--bucket にもっと大きい幅を指定してください (例: 5m, 15m, 1h)`
    );
  }
  const buckets: TimeBucket[] = Array.from({ length: bucketCount }, (_, i) => ({
    start: new Date(window.start.getTime() + i * bucketMs),
    end: new Date(Math.min(window.start.getTime() + (i + 1) * bucketMs, window.end.getTime())),
    count: 0,
  }));
  for (const e of events) {
    const offset = e.timestamp.getTime() - window.start.getTime();
    if (offset < 0 || offset >= windowMs) continue;
    buckets[Math.floor(offset / bucketMs)]!.count += 1;
  }
  return buckets;
}
