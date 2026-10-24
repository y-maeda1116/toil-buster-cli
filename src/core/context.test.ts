import { describe, expect, it } from "vitest";
import { withContext } from "./context.js";

describe("withContext", () => {
  const events = ["e0", "e1", "e2", "e3", "e4", "e5"];

  it("マッチ行の前後 N 行を matched 付きで返す", () => {
    const lines = withContext(events, [3], 1);
    expect(lines).toEqual([
      { event: "e2", matched: false },
      { event: "e3", matched: true },
      { event: "e4", matched: false },
    ]);
  });

  it("複数マッチの文脈は重複なくマージする", () => {
    const lines = withContext(events, [1, 3], 1);
    expect(lines.map((l) => l.event)).toEqual(["e0", "e1", "e2", "e3", "e4"]);
    expect(lines.filter((l) => l.matched).map((l) => l.event)).toEqual(["e1", "e3"]);
  });

  it("窓の端では範囲外を踏まない", () => {
    const lines = withContext(events, [0, 5], 2);
    expect(lines.map((l) => l.event)).toEqual(events);
    expect(lines[0]).toEqual({ event: "e0", matched: true });
    expect(lines.at(-1)).toEqual({ event: "e5", matched: true });
  });

  it("マッチなしなら空を返す", () => {
    expect(withContext(events, [], 2)).toEqual([]);
  });
});
