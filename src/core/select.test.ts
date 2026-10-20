import { describe, expect, it } from "vitest";
import { createSelectState, handleKey } from "./select.js";

const CHOICES = ["/aws/lambda/prod-api", "/aws/lambda/prod-batch", "/aws/ec2/worker"];

describe("select state machine", () => {
  it("初期状態は query 空で先頭を選択している", () => {
    const state = createSelectState(CHOICES);
    expect(state.query).toBe("");
    expect(state.selectedIndex).toBe(0);
    expect(state.filtered).toEqual(CHOICES);
  });

  it("入力文字で大文字小文字を無視して絞り込む", () => {
    let state = createSelectState(CHOICES);
    for (const ch of "prod") state = handleKey(state, ch).state;
    expect(state.query).toBe("prod");
    expect(state.filtered).toEqual(["/aws/lambda/prod-api", "/aws/lambda/prod-batch"]);
  });

  it("絞り込み結果の範囲内で down / up が移動する", () => {
    let state = createSelectState(CHOICES);
    state = handleKey(state, "down").state;
    expect(state.selectedIndex).toBe(1);
    // 先頭より上には行かない
    state = handleKey(state, "up").state;
    state = handleKey(state, "up").state;
    expect(state.selectedIndex).toBe(0);
  });

  it("Enter で選択中の候補を確定する", () => {
    let state = createSelectState(CHOICES);
    state = handleKey(state, "down").state;
    const result = handleKey(state, "enter");
    expect(result.action).toBe("accept");
    expect(result.value).toBe("/aws/lambda/prod-batch");
  });

  it("Esc でキャンセルする", () => {
    const result = handleKey(createSelectState(CHOICES), "escape");
    expect(result.action).toBe("cancel");
  });

  it("backspace で 1 文字削除し、絞り込みが戻る", () => {
    let state = createSelectState(CHOICES);
    for (const ch of "api") state = handleKey(state, ch).state;
    expect(state.filtered).toEqual(["/aws/lambda/prod-api"]);
    state = handleKey(state, "backspace").state;
    expect(state.query).toBe("ap");
    expect(state.filtered).toEqual(["/aws/lambda/prod-api"]);
    // "a" はすべての候補に含まれる (/aws) ので 3 件に戻る
    state = handleKey(state, "backspace").state;
    expect(state.filtered).toEqual(CHOICES);
  });

  it("絞り込みで 0 件でもエラーにならず、Enter は無効", () => {
    let state = createSelectState(CHOICES);
    for (const ch of "zzz") state = handleKey(state, ch).state;
    expect(state.filtered).toEqual([]);
    const result = handleKey(state, "enter");
    expect(result.action).toBeUndefined();
    expect(result.value).toBeUndefined();
  });

  it("選択位置が絞り込み後の範囲外にならない", () => {
    let state = createSelectState(CHOICES);
    state = handleKey(state, "down").state;
    state = handleKey(state, "down").state;
    expect(state.selectedIndex).toBe(2);
    // 絞り込みで 1 件になると選択位置は 0 に戻る
    state = handleKey(state, "b").state;
    state = handleKey(state, "a").state;
    state = handleKey(state, "t").state;
    state = handleKey(state, "c").state;
    state = handleKey(state, "h").state;
    expect(state.filtered).toEqual(["/aws/lambda/prod-batch"]);
    expect(state.selectedIndex).toBe(0);
  });
});
