import { describe, expect, it } from "vitest";
import { isIgnored, parseIgnoreSpecs } from "./ignore.js";

describe("parseIgnoreSpecs", () => {
  it("/.../ 形式は regex として解釈する", () => {
    const specs = parseIgnoreSpecs(["/Connection reset by peer/"]);
    expect(specs).toEqual([{ type: "regex", source: "Connection reset by peer" }]);
  });

  it("/.../ 以外は exact として解釈する", () => {
    const specs = parseIgnoreSpecs(["NoSuchElementException"]);
    expect(specs).toEqual([{ type: "exact", value: "NoSuchElementException" }]);
  });

  it("空配列は空を返す", () => {
    expect(parseIgnoreSpecs([])).toEqual([]);
  });

  it("空文字と空白のみは無視する", () => {
    expect(parseIgnoreSpecs(["", "   "])).toEqual([]);
  });

  it("不正な正規表現はエラーにする", () => {
    expect(() => parseIgnoreSpecs(["/[unclosed/"])).toThrow(/正規表現/);
  });
});

describe("isIgnored", () => {
  it("exact は正規化済みパターンとの完全一致", () => {
    const specs = parseIgnoreSpecs(["NoSuchElementException"]);
    expect(isIgnored("NoSuchElementException", specs)).toBe(true);
    expect(isIgnored("NoSuchElementException: user not found", specs)).toBe(false);
  });

  it("regex は部分一致で判定する", () => {
    const specs = parseIgnoreSpecs(["/Connection reset by peer/"]);
    expect(isIgnored("ClientError: Connection reset by peer on port 443", specs)).toBe(true);
    expect(isIgnored("TimeoutError", specs)).toBe(false);
  });

  it("spec が空なら常に false", () => {
    expect(isIgnored("anything", [])).toBe(false);
  });
});
