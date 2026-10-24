import { describe, expect, it } from "vitest";
import { computeTimeline } from "./timeline.js";
import type { LogEvent } from "../providers/types.js";

const WINDOW_START = new Date("2026-10-03T10:00:00Z");
const WINDOW_END = new Date("2026-10-03T10:30:00Z");
const BUCKET_MS = 10 * 60_000; // 10m × 3 バケット

const ev = (iso: string, message = "timeout id=<num>"): LogEvent => ({
  timestamp: new Date(iso),
  message,
});

const BASE = { start: WINDOW_START, end: WINDOW_END };

describe("computeTimeline", () => {
  it("イベントをバケット幅ごとに集計する", () => {
    const events = [
      ev("2026-10-03T10:05:00Z"),
      ev("2026-10-03T10:07:00Z"),
      ev("2026-10-03T10:25:00Z"),
    ];
    const timeline = computeTimeline(events, BASE, BUCKET_MS);
    expect(timeline.map((b) => b.count)).toEqual([2, 0, 1]);
  });

  it("バケット境界のイベントは後続バケットに属する (start 以上 end 未満)", () => {
    const events = [ev("2026-10-03T10:10:00Z"), ev("2026-10-03T10:20:00Z")];
    const timeline = computeTimeline(events, BASE, BUCKET_MS);
    expect(timeline.map((b) => b.count)).toEqual([0, 1, 1]);
  });

  it("バケットは窓の開始時刻から等間隔に並ぶ", () => {
    const timeline = computeTimeline([], BASE, BUCKET_MS);
    expect(timeline.map((b) => b.start.toISOString())).toEqual([
      "2026-10-03T10:00:00.000Z",
      "2026-10-03T10:10:00.000Z",
      "2026-10-03T10:20:00.000Z",
    ]);
    expect(timeline.every((b) => b.count === 0)).toBe(true);
  });

  it("窓がバケット幅で割り切れない場合、端数バケットは切り上げで作られる", () => {
    const end = new Date("2026-10-03T10:25:00Z");
    const timeline = computeTimeline([], { start: WINDOW_START, end }, BUCKET_MS);
    expect(timeline).toHaveLength(3);
    expect(timeline[2]!.end.toISOString()).toBe("2026-10-03T10:25:00.000Z");
  });

  it("窓外のタイムスタンプのイベントは無視する", () => {
    const events = [ev("2026-10-03T09:59:00Z"), ev("2026-10-03T10:30:00Z")];
    const timeline = computeTimeline(events, BASE, BUCKET_MS);
    expect(timeline.every((b) => b.count === 0)).toBe(true);
  });

  it("バケット数が上限を超える場合はエラーになる (大きい幅を促す)", () => {
    expect(() => computeTimeline([], BASE, 1000)).toThrow(/--bucket/);
  });
});
