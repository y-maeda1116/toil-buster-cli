import { describe, expect, it } from "vitest";
import { aggregateEvents } from "./aggregate.js";
import { parseIgnoreSpecs } from "./ignore.js";
import type { LogEvent } from "../providers/types.js";

const event = (timestamp: string, message: string): LogEvent => ({
  timestamp: new Date(timestamp),
  message,
});

describe("aggregateEvents", () => {
  const start = new Date("2026-10-03T09:00:00Z");
  const end = new Date("2026-10-03T09:15:00Z");

  it("同じパターン（正規化後）は 1 グループに集計し count/firstSeen/lastSeen/sample を持つ", () => {
    const events = [
      event("2026-10-03T09:01:00Z", "timeout id=1111"),
      event("2026-10-03T09:05:00Z", "timeout id=2222"),
      event("2026-10-03T09:03:00Z", "timeout id=3333"),
    ];
    const result = aggregateEvents("/g", start, end, events, false);
    expect(result.groups).toHaveLength(1);
    const group = result.groups[0]!;
    expect(group.pattern).toBe("timeout id=<num>");
    expect(group.count).toBe(3);
    expect(group.firstSeen).toEqual(new Date("2026-10-03T09:01:00Z"));
    expect(group.lastSeen).toEqual(new Date("2026-10-03T09:05:00Z"));
    expect(group.sample).toBe("timeout id=1111");
  });

  it("異なるパターンは別グループになり count 降順でソートされる", () => {
    const events = [
      event("2026-10-03T09:01:00Z", "error A"),
      event("2026-10-03T09:02:00Z", "error B"),
      event("2026-10-03T09:03:00Z", "error B"),
    ];
    const result = aggregateEvents("/g", start, end, events, false);
    expect(result.groups.map((g) => g.pattern)).toEqual(["error B", "error A"]);
  });

  it("totalEvents / timeWindow / truncated / logGroup を保持する", () => {
    const result = aggregateEvents(
      "/my-group",
      start,
      end,
      [event("2026-10-03T09:01:00Z", "x")],
      true
    );
    expect(result.totalEvents).toBe(1);
    expect(result.timeWindow).toEqual({ start, end });
    expect(result.truncated).toBe(true);
    expect(result.logGroup).toBe("/my-group");
  });

  it("空配列なら groups も空", () => {
    const result = aggregateEvents("/g", start, end, [], false);
    expect(result.groups).toEqual([]);
    expect(result.totalEvents).toBe(0);
  });

  it("bucketMs 指定時は timeline を SummaryResult に含める", () => {
    const events = [
      event("2026-10-03T09:01:00Z", "error A"),
      event("2026-10-03T09:11:00Z", "error A"),
    ];
    const result = aggregateEvents("/g", start, end, events, false, 5 * 60_000);
    expect(result.timeline).toBeDefined();
    expect(result.timeline!.map((b) => b.count)).toEqual([1, 0, 1]);
  });

  it("bucketMs 未指定時は timeline を含めない", () => {
    const result = aggregateEvents("/g", start, end, [], false);
    expect(result.timeline).toBeUndefined();
  });

  it("bucketMs 不正 (バケット過多) はエラーとして伝播する", () => {
    expect(() => aggregateEvents("/g", start, end, [], false, 1000)).toThrow(/--bucket/);
  });

  describe("ignore 指定時", () => {
    const events = [
      event("2026-10-03T09:01:00Z", "timeout id=1111"),
      event("2026-10-03T09:02:00Z", "NoSuchElementException"),
      event("2026-10-03T09:03:00Z", "Connection reset by peer on 443"),
    ];

    it("完全一致するパターンを groups から除外し ignoredEvents に件数を入れる", () => {
      const specs = parseIgnoreSpecs(["NoSuchElementException"]);
      const result = aggregateEvents("/g", start, end, events, false, undefined, { specs });
      expect(result.groups.map((g) => g.pattern)).toEqual([
        "timeout id=<num>",
        "Connection reset by peer on 443",
      ]);
      expect(result.ignoredEvents).toBe(1);
      expect(result.totalEvents).toBe(3);
    });

    it("正規表現仕様で部分一致除外する", () => {
      const specs = parseIgnoreSpecs(["/Connection reset by peer/"]);
      const result = aggregateEvents("/g", start, end, events, false, undefined, { specs });
      expect(result.groups.map((g) => g.pattern)).not.toContain("Connection reset by peer on 443");
      expect(result.ignoredEvents).toBe(1);
    });

    it("showIgnored: true なら groups に含めつつ ignoredEvents をカウントする", () => {
      const specs = parseIgnoreSpecs(["NoSuchElementException"]);
      const result = aggregateEvents("/g", start, end, events, false, undefined, {
        specs,
        showIgnored: true,
      });
      expect(result.groups.map((g) => g.pattern)).toContain("NoSuchElementException");
      expect(result.ignoredEvents).toBe(1);
    });

    it("ignore なしでは ignoredEvents は undefined のまま", () => {
      const result = aggregateEvents("/g", start, end, events, false);
      expect(result.ignoredEvents).toBeUndefined();
    });

    it("timeline は除外後のイベントで計算する", () => {
      const specs = parseIgnoreSpecs(["NoSuchElementException"]);
      const withIgnore = aggregateEvents("/g", start, end, events, false, 5 * 60_000, {
        specs,
      });
      const withoutIgnore = aggregateEvents("/g", start, end, events, false, 5 * 60_000);
      expect(withIgnore.timeline!.map((b) => b.count)).toEqual([2, 0, 0]);
      expect(withoutIgnore.timeline!.map((b) => b.count)).toEqual([3, 0, 0]);
    });
  });
});
