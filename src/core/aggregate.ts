import type { LogEvent } from "../providers/types.js";
import { normalizeMessage } from "./normalize.js";
import { computeTimeline, type TimeBucket } from "./timeline.js";
import type { ComparedGroup } from "./compare.js";
import { isIgnored, type IgnoreSpec } from "./ignore.js";

/** 既知エラーの抑制設定。showIgnored: true は --show-ignored 相当 (除外せず表示)。 */
export interface AggregateIgnoreOptions {
  specs: readonly IgnoreSpec[];
  showIgnored?: boolean;
}

export interface ErrorGroupStats {
  pattern: string;
  count: number;
  firstSeen: Date;
  lastSeen: Date;
  sample: string;
}

export interface ComparisonResult {
  timeWindow: { start: Date; end: Date };
  totalEvents: number;
  groups: ComparedGroup[];
}

export interface SummaryResult {
  logGroup: string;
  timeWindow: { start: Date; end: Date };
  totalEvents: number;
  truncated: boolean;
  groups: ErrorGroupStats[];
  /** ignore パターンで除外 (または showIgnored 時に検出) したイベント数。 */
  ignoredEvents?: number;
  timeline?: TimeBucket[];
  comparison?: ComparisonResult;
}

export function aggregateEvents(
  logGroup: string,
  start: Date,
  end: Date,
  events: readonly LogEvent[],
  truncated: boolean,
  bucketMs?: number,
  ignore?: AggregateIgnoreOptions
): SummaryResult {
  const specs = ignore?.specs ?? [];
  const groups = new Map<string, ErrorGroupStats>();
  const visible: LogEvent[] = [];
  let ignoredEvents = 0;
  for (const e of events) {
    const pattern = normalizeMessage(e.message);
    if (specs.length > 0 && isIgnored(pattern, specs)) {
      ignoredEvents++;
      if (!ignore?.showIgnored) continue;
    }
    visible.push(e);
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
    ...(ignoredEvents > 0 ? { ignoredEvents } : {}),
    ...(bucketMs !== undefined
      ? { timeline: computeTimeline(visible, { start, end }, bucketMs) }
      : {}),
  };
}
