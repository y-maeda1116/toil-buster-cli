import { describe, expect, it } from "vitest";
import { renderReport } from "./report.js";
import type { SummaryResult } from "../core/aggregate.js";

const result = (logGroup: string, count: number): SummaryResult => ({
  logGroup,
  timeWindow: { start: new Date("2026-10-03T09:00:00Z"), end: new Date("2026-10-03T10:00:00Z") },
  totalEvents: count,
  truncated: false,
  groups: [
    {
      pattern: "timeout id=<num>",
      count,
      firstSeen: new Date("2026-10-03T09:01:00Z"),
      lastSeen: new Date("2026-10-03T09:59:00Z"),
      sample: "timeout id=1111",
    },
  ],
});

describe("renderReport", () => {
  const meta = {
    generatedAt: new Date("2026-10-03T10:05:00Z"),
    filterPattern: "?ERROR",
    limit: 1000,
  };

  it("実行時刻とフィルタ条件をメタ情報として含む", () => {
    const report = renderReport([result("/g", 2)], meta);
    expect(report).toContain("2026-10-03T10:05:00Z");
    expect(report).toContain("?ERROR");
    expect(report).toContain("1000");
  });

  it("各結果のサマリ (ロググループ見出しとグループ表) を含む", () => {
    const report = renderReport([result("/g", 2)], meta);
    expect(report).toContain("# Log Summary: /g");
    expect(report).toContain("timeout id=<num>");
  });

  it("複数グループはセクション連結される", () => {
    const report = renderReport([result("/a", 2), result("/b", 5)], meta);
    expect(report).toContain("# Log Summary: /a");
    expect(report).toContain("# Log Summary: /b");
  });

  it("--limit で打ち切られた結果はその旨を含む", () => {
    const truncated: SummaryResult = { ...result("/g", 3), truncated: true };
    const report = renderReport([truncated], meta);
    expect(report).toContain("打ち切り");
  });
});
