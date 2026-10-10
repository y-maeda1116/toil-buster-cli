import { describe, expect, it } from "vitest";
import type { SummaryResult } from "../core/aggregate.js";
import { renderMarkdown } from "./markdown.js";

const base: SummaryResult = {
  logGroup: "/g",
  timeWindow: { start: new Date("2026-10-03T09:00:00Z"), end: new Date("2026-10-03T09:15:00Z") },
  totalEvents: 1,
  truncated: false,
  groups: [
    {
      pattern: "pipe | inside",
      count: 1,
      firstSeen: new Date("2026-10-03T09:01:00Z"),
      lastSeen: new Date("2026-10-03T09:05:00Z"),
      sample: "pipe | inside",
    },
  ],
};

describe("renderMarkdown", () => {
  it("md テーブル行を含み、パターン内の | はエスケープされる", () => {
    const out = renderMarkdown(base, 20);
    expect(out).toContain("| # |");
    expect(out).toContain("pipe \\| inside");
    expect(out).not.toContain("pipe | inside");
  });

  it("0 件はメッセージのみでテーブル行を持たない", () => {
    const out = renderMarkdown({ ...base, groups: [], totalEvents: 0 }, 20);
    expect(out).toContain("該当時間帯にエラーは見つかりませんでした");
    expect(out).not.toContain("| # |");
  });
});
