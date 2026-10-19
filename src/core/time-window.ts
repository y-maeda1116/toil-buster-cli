import { parseDuration } from "./duration.js";

// 形状は「ISO 8601 の日付で始まること」だけを見る (数量子のネストを避けるため)。
// 日時部分の詳細な妥当性 (存在しない日付・時刻) は new Date() のパース結果で判定する。
const DATE_PREFIX_PATTERN = /^\d{4}-\d{2}-\d{2}/;
const MAX_DATETIME_LENGTH = 64;

export interface TimeWindowSpec {
  time: string;
  since?: string;
  until?: string;
}

export interface TimeWindow {
  start: Date;
  end: Date;
}

function parseAbsoluteTime(input: string, flag: string): Date {
  const invalid = () =>
    `Invalid datetime: "${input}" (${flag} には ISO 8601 形式を指定してください。例: 2026-10-18T14:00)`;
  const trimmed = input.trim();
  if (trimmed.length > MAX_DATETIME_LENGTH || !DATE_PREFIX_PATTERN.test(trimmed)) {
    throw new Error(invalid());
  }
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    throw new Error(invalid());
  }
  return date;
}

export function resolveTimeWindow(spec: TimeWindowSpec, now: Date): TimeWindow {
  const { time, since, until } = spec;
  if (since !== undefined && until !== undefined) {
    return buildWindow(parseAbsoluteTime(since, "--since"), parseAbsoluteTime(until, "--until"));
  }
  if (since !== undefined) {
    return buildWindow(parseAbsoluteTime(since, "--since"), now);
  }
  if (until !== undefined) {
    const end = parseAbsoluteTime(until, "--until");
    return buildWindow(new Date(end.getTime() - parseDuration(time)), end);
  }
  return buildWindow(new Date(now.getTime() - parseDuration(time)), now);
}

function buildWindow(start: Date, end: Date): TimeWindow {
  if (start.getTime() >= end.getTime()) {
    throw new Error("--since には --until より前の時刻を指定してください");
  }
  return { start, end };
}
