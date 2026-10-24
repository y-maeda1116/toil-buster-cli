import { describe, expect, it } from "vitest";
import { compareGroups, type GroupCount } from "./compare.js";

const g = (pattern: string, count: number): GroupCount => ({ pattern, count });

describe("compareGroups", () => {
  it("比較窓に無いパターンは new になる", () => {
    const result = compareGroups([g("timeout <num>", 5)], []);
    expect(result).toEqual([
      { pattern: "timeout <num>", count: 5, prevCount: 0, delta: 5, status: "new" },
    ]);
  });

  it("増加は increased、差分は delta に入る", () => {
    const result = compareGroups([g("timeout <num>", 8)], [g("timeout <num>", 3)]);
    expect(result[0]).toEqual({
      pattern: "timeout <num>",
      count: 8,
      prevCount: 3,
      delta: 5,
      status: "increased",
    });
  });

  it("同数は unchanged、減少は decreased になる", () => {
    const result = compareGroups([g("a", 2), g("b", 1)], [g("a", 2), g("b", 4)]);
    const byPattern = new Map(result.map((r) => [r.pattern, r]));
    expect(byPattern.get("a")).toMatchObject({ status: "unchanged", delta: 0 });
    expect(byPattern.get("b")).toMatchObject({ status: "decreased", delta: -3 });
  });

  it("比較窓のみのパターンは resolved (現在 0 件) として末尾に含まれる", () => {
    const result = compareGroups([g("new-err", 1)], [g("old-err", 6), g("older", 2)]);
    expect(result[0]).toMatchObject({ pattern: "new-err", status: "new" });
    const resolved = result.filter((r) => r.status === "resolved");
    expect(resolved.map((r) => [r.pattern, r.count, r.prevCount])).toEqual([
      ["old-err", 0, 6],
      ["older", 0, 2],
    ]);
  });

  it("ソート順は new → increased → unchanged → decreased → resolved、同 status は delta 降順", () => {
    const result = compareGroups(
      [g("up-big", 10), g("same", 1), g("up-small", 2), g("down", 1), g("brand-new", 1)],
      [g("up-big", 1), g("same", 1), g("up-small", 1), g("down", 9), g("resolved-1", 3)]
    );
    expect(result.map((r) => r.pattern)).toEqual([
      "brand-new",
      "up-big",
      "up-small",
      "same",
      "down",
      "resolved-1",
    ]);
  });

  it("両方空なら結果も空", () => {
    expect(compareGroups([], [])).toEqual([]);
  });
});
