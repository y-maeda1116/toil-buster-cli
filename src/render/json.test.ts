import { describe, expect, it } from "vitest";
import type { SummaryResult } from "../core/aggregate.js";
import { renderJson } from "./json.js";

const base: SummaryResult = {
  logGroup: "/g",
  timeWindow: { start: new Date("2026-10-03T09:00:00Z"), end: new Date("2026-10-03T09:15:00Z") },
  totalEvents: 2,
  truncated: false,
  groups: [
    {
      pattern: "timeout <num>",
      count: 2,
      firstSeen: new Date("2026-10-03T09:01:00Z"),
      lastSeen: new Date("2026-10-03T09:05:00Z"),
      sample: "timeout 1234",
    },
  ],
};

describe("renderJson", () => {
  it("JSON としてパースでき、時刻は ISO 文字列", () => {
    const parsed = JSON.parse(renderJson(base, 20));
    expect(parsed.logGroup).toBe("/g");
    expect(parsed.groups[0].pattern).toBe("timeout <num>");
    expect(parsed.timeWindow.start).toBe("2026-10-03T09:00:00.000Z");
    expect(parsed.groups[0].firstSeen).toBe("2026-10-03T09:01:00.000Z");
  });

  it("top で groups を切り詰める / 0 件も有効な JSON", () => {
    const two = {
      ...base,
      groups: [...base.groups, { ...base.groups[0]!, pattern: "x", count: 1 }],
    };
    expect(JSON.parse(renderJson(two, 1)).groups).toHaveLength(1);
    const empty = { ...base, groups: [], totalEvents: 0 };
    expect(JSON.parse(renderJson(empty, 20)).groups).toEqual([]);
  });

  it("timeline があれば ISO 文字列付きでそのまま出力する", () => {
    const withTimeline = {
      ...base,
      timeline: [
        {
          start: new Date("2026-10-03T09:00:00Z"),
          end: new Date("2026-10-03T09:05:00Z"),
          count: 2,
        },
      ],
    };
    const parsed = JSON.parse(renderJson(withTimeline, 20));
    expect(parsed.timeline[0].count).toBe(2);
    expect(parsed.timeline[0].start).toBe("2026-10-03T09:00:00.000Z");
  });
});
