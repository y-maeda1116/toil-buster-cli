import { describe, expect, it } from "vitest";
import type { SummaryResult } from "../core/aggregate.js";
import { renderTable } from "./table.js";

const result = (
  groups: SummaryResult["groups"],
  totalEvents = groups.reduce((s, g) => s + g.count, 0)
): SummaryResult => ({
  logGroup: "/aws/lambda/prod-api",
  timeWindow: { start: new Date("2026-10-03T09:00:00Z"), end: new Date("2026-10-03T09:15:00Z") },
  totalEvents,
  truncated: false,
  groups,
});

const group = (pattern: string, count: number) => ({
  pattern,
  count,
  firstSeen: new Date("2026-10-03T09:01:00Z"),
  lastSeen: new Date("2026-10-03T09:05:00Z"),
  sample: pattern,
});

describe("renderTable", () => {
  it("ヘッダー情報とランキング行を含む", () => {
    const out = renderTable(result([group("timeout <num>", 3), group("connect <ip>", 1)]), 20);
    expect(out).toContain("/aws/lambda/prod-api");
    expect(out).toContain("timeout <num>");
    expect(out).toContain("connect <ip>");
    expect(out.indexOf("timeout <num>")).toBeLessThan(out.indexOf("connect <ip>"));
  });

  it("top で行数を切り詰める", () => {
    const out = renderTable(result([group("a", 2), group("b", 1)]), 1);
    expect(out).toContain("a");
    expect(out).not.toContain(" b ");
  });

  it("0 件はメッセージのみ", () => {
    const out = renderTable(result([]), 20);
    expect(out).toContain("該当時間帯にエラーは見つかりませんでした");
  });

  it("truncated=true は警告行を含む", () => {
    const r = { ...result([group("a", 1)]), truncated: true };
    expect(renderTable(r, 20)).toContain("--limit");
  });
});
