import type { LogEvent } from "../providers/types.js";
import { normalizeMessage } from "./normalize.js";
import { computeTimeline, type TimeBucket } from "./timeline.js";

export interface ErrorGroupStats {
  pattern: string;
  count: number;
  firstSeen: Date;
  lastSeen: Date;
  sample: string;
}

export interface SummaryResult {
  logGroup: string;
  timeWindow: { start: Date; end: Date };
  totalEvents: number;
  truncated: boolean;
  groups: ErrorGroupStats[];
  timeline?: TimeBucket[];
}

export function aggregateEvents(
  logGroup: string,
  start: Date,
  end: Date,
  events: readonly LogEvent[],
  truncated: boolean,
  bucketMs?: number
): SummaryResult {
  const groups = new Map<string, ErrorGroupStats>();
  for (const e of events) {
    const pattern = normalizeMessage(e.message);
    const current = groups.get(pattern);
    const next: ErrorGroupStats = current
      ? {
          ...current,
          count: current.count + 1,
          firstSeen: e.timestamp < current.firstSeen ? e.timestamp : current.firstSeen,
          lastSeen: e.timestamp > current.lastSeen ? e.timestamp : current.lastSeen,
        }
      : { pattern, count: 1, firstSeen: e.timestamp, lastSeen: e.timestamp, sample: e.message };
    groups.set(pattern, next);
  }
  return {
    logGroup,
    timeWindow: { start, end },
    totalEvents: events.length,
    truncated,
    groups: [...groups.values()].sort((a, b) => b.count - a.count),
    ...(bucketMs !== undefined
      ? { timeline: computeTimeline(events, { start, end }, bucketMs) }
      : {}),
  };
}
