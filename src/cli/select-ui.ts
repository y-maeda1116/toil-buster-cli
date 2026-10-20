import { stdin } from "node:process";
import { emitKeypressEvents } from "node:readline";
import chalk from "chalk";
import { createSelectState, handleKey } from "../core/select.js";
import type { SelectKey, SelectState } from "../core/select.js";

interface KeyInfo {
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  str?: string;
}

/** readline の keypress 情報を選択 UI のキー種別に変換する。 */
export function mapKeypress(input: KeyInfo): SelectKey | undefined {
  switch (input.name) {
    case "return":
      return "enter";
    case "escape":
      return "escape";
    case "up":
      return "up";
    case "down":
      return "down";
    case "backspace":
      return "backspace";
    default:
      break;
  }
  if (input.ctrl || input.meta) return undefined;
  const str = input.str ?? "";
  return str.length === 1 && str.codePointAt(0)! >= 0x20 ? str : undefined;
}

const MAX_VISIBLE = 15;
const HEADER = "ロググループを選択 (入力で絞り込み / Enter 確定 / Esc 中断)";

const render = (state: SelectState): string => {
  const half = Math.floor(MAX_VISIBLE / 2);
  const start = Math.max(
    0,
    Math.min(state.selectedIndex - half, Math.max(state.filtered.length - MAX_VISIBLE, 0))
  );
  const visible = state.filtered.slice(start, start + MAX_VISIBLE);
  const lines = [
    `${HEADER}`,
    `> ${state.query}`,
    ...visible.map((choice, i) => {
      const selected = start + i === state.selectedIndex;
      return `${selected ? chalk.bold(`> ${choice}`) : `  ${choice}`}`;
    }),
  ];
  return lines.map((l) => `\x1b[2K${l}`).join("\r\n");
};

/**
 * fzf 風のインクリメンタル検索で 1 グループを選ばせる。
 * Esc での中断は reject し、コマンド側のエラー処理に流す。
 */
export async function interactiveSelect(choices: readonly string[]): Promise<string> {
  let state = createSelectState(choices);
  return new Promise<string>((resolve, reject) => {
    let lastLines = 0;
    const draw = () => {
      if (lastLines > 0) stdin.write(`\x1b[${lastLines - 1}A\r`);
      const rendered = render(state);
      stdin.write(rendered);
      lastLines = rendered.split("\r\n").length;
    };
    const cleanup = () => {
      stdin.removeListener("keypress", onKeypress);
      if (stdin.isTTY) stdin.setRawMode(false);
      stdin.pause();
      stdin.write("\x1b[?25h\r\n"); // カーソル再表示
    };
    const onKeypress = (_str: string, key: KeyInfo) => {
      const mapped = mapKeypress(key);
      if (mapped === undefined) return;
      const result = handleKey(state, mapped);
      state = result.state;
      if (result.action === "accept") {
        cleanup();
        resolve(result.value!);
        return;
      }
      if (result.action === "cancel") {
        cleanup();
        reject(new Error("ロググループの選択を中断しました"));
        return;
      }
      draw();
    };
    emitKeypressEvents(stdin);
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.write("\x1b[?25l"); // カーソル非表示
    stdin.on("keypress", onKeypress);
    draw();
  });
}
