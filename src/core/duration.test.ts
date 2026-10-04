import { describe, expect, it } from "vitest";
import { parseDuration } from "./duration.js";

describe("parseDuration", () => {
  it.each([
    ["10s", 10_000],
    ["5m", 300_000],
    ["10m", 600_000],
    ["1h", 3_600_000],
    ["2d", 172_800_000],
  ])("%s をミリ秒へ変換する", (input, expected) => {
    expect(parseDuration(input)).toBe(expected);
  });

  it.each(["abc", "10", "10x", "m10", "", "1.5h"])("%s は Invalid duration エラー", (input) => {
    expect(() => parseDuration(input)).toThrow(/Invalid duration/);
  });

  it("0 や 00m のような 0 ミリ秒になる入力はエラー", () => {
    expect(() => parseDuration("0m")).toThrow(/Invalid duration/);
  });
});
