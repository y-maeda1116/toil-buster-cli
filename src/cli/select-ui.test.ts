import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { interactiveSelect, mapKeypress } from "./select-ui.js";

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

interface FakeStream extends EventEmitter {
  isTTY: boolean;
  setRawMode: (mode: boolean) => void;
  pause: () => void;
  resume: () => void;
  write: (text: string) => void;
}

const makeStream = (): FakeStream & { written: string[] } => {
  const written: string[] = [];
  const stream = new EventEmitter() as FakeStream & { written: string[] };
  stream.isTTY = true;
  stream.setRawMode = vi.fn();
  stream.pause = vi.fn();
  stream.resume = vi.fn();
  stream.write = vi.fn((text: string) => {
    written.push(text);
    return true;
  });
  Object.assign(stream, { written });
  return stream;
};

const press = (stream: FakeStream, str: string, key: Record<string, unknown>): void => {
  stream.emit("keypress", str, key);
};

describe("interactiveSelect (io 注入)", () => {
  it("通常キーで絞り込み、Enter で選択値が確定する", async () => {
    const stream = makeStream();
    const promise = interactiveSelect(["/a/prod-api", "/a/prod-batch"], stream);
    press(stream, "b", { name: "b", str: "b" });
    press(stream, "", { name: "return" });
    await expect(promise).resolves.toBe("/a/prod-batch");
    expect(stream.setRawMode).toHaveBeenCalledWith(true);
  });

  it("Esc で中断 (reject) され raw モードが解除される", async () => {
    const stream = makeStream();
    const promise = interactiveSelect(["/a", "/b"], stream);
    press(stream, "", { name: "escape" });
    await expect(promise).rejects.toThrow("ロググループの選択を中断しました");
    expect(stream.setRawMode).toHaveBeenLastCalledWith(false);
  });

  it("描画にヘッダと候補一覧が含まれる", async () => {
    const stream = makeStream();
    const promise = interactiveSelect(["/a/prod-api", "/b/worker"], stream);
    press(stream, "", { name: "return" });
    await promise;
    const drawn = stream.written.join("");
    expect(drawn).toContain("ロググループを選択");
    expect(drawn).toContain("/a/prod-api");
    expect(drawn).toContain("/b/worker");
  });

  it("絞り込みで 0 件のとき Enter は無効でキャンセルで抜けられる", async () => {
    const stream = makeStream();
    const promise = interactiveSelect(["/a"], stream);
    press(stream, "z", { name: "z", str: "z" });
    press(stream, "z", { name: "z", str: "z" });
    press(stream, "", { name: "return" });
    press(stream, "", { name: "escape" });
    await expect(promise).rejects.toThrow("ロググループの選択を中断しました");
  });
});
