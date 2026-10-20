import { describe, expect, it } from "vitest";
import { mapKeypress } from "./select-ui.js";

describe("mapKeypress", () => {
  it("readline の特殊キーを選択 UI のキー種別に変換する", () => {
    expect(mapKeypress({ name: "return" })).toBe("enter");
    expect(mapKeypress({ name: "escape" })).toBe("escape");
    expect(mapKeypress({ name: "up" })).toBe("up");
    expect(mapKeypress({ name: "down" })).toBe("down");
    expect(mapKeypress({ name: "backspace" })).toBe("backspace");
  });

  it("表示可能な 1 文字はそのままクエリ入力になる", () => {
    expect(mapKeypress({ str: "a", name: "a" })).toBe("a");
    expect(mapKeypress({ str: "-", name: "minus" })).toBe("-");
  });

  it("制御文字 / 修飾キー付きは無視する", () => {
    expect(mapKeypress({ str: "c", name: "c", ctrl: true })).toBeUndefined();
    expect(mapKeypress({ str: "a", name: "a", meta: true })).toBeUndefined();
    expect(mapKeypress({ str: "\t", name: "tab" })).toBeUndefined();
  });
});
