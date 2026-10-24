import { interactiveSelect } from "./select-ui.js";
import type { RunDeps } from "./errors-command.js";
import type { LogProvider } from "../providers/types.js";

/**
 * コマンドのグループ引数を確定させる。省略時はロググループ一覧から対話選択する。
 * 非対話環境 (TTY なし) ではエラーにして、CI / スクリプトからは必ず明示的な指定を促す。
 */
export async function selectTargetGroup(
  group: string | undefined,
  provider: LogProvider,
  deps: Pick<RunDeps, "isTTY" | "selectGroup">
): Promise<string> {
  if (group !== undefined) return group;
  const isTTY = deps.isTTY ?? (() => process.stdin.isTTY === true);
  if (!isTTY()) {
    throw new Error("ロググループ名を指定するか、ターミナル (TTY) から実行してください");
  }
  const names = await provider.listGroupNames("");
  if (names.length === 0) {
    throw new Error("選択できるロググループが見つかりませんでした");
  }
  const selectGroup = deps.selectGroup ?? interactiveSelect;
  return selectGroup(names);
}
