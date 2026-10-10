import { describe, expect, it } from "vitest";
import { buildFilterPattern } from "./filter-pattern.js";

describe("buildFilterPattern", () => {
  it("ERROR は大文字/先頭大文字/小文字の 3 タームを OR 結合する", () => {
    expect(buildFilterPattern(["ERROR"])).toBe("?ERROR ?Error ?error");
  });

  it("複数レベルはすべてのタームを並べる", () => {
    expect(buildFilterPattern(["warn", "error"])).toBe("?WARN ?Warn ?warn ?ERROR ?Error ?error");
  });

  it("大文字小文字違いの重複入力は dedupe される", () => {
    expect(buildFilterPattern(["error", "ERROR"])).toBe("?ERROR ?Error ?error");
  });

  it("空配列や空文字のみはエラー", () => {
    expect(() => buildFilterPattern([])).toThrow(/レベル/);
    expect(() => buildFilterPattern(["", " "])).toThrow(/レベル/);
  });
});
