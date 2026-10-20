export interface GroupSource {
  listGroupNames(prefix: string): Promise<string[]>;
}

// 展開しすぎて大量の順次 fetch に落ちないよう上限を設ける。
import { MAX_GROUPS } from "../providers/types.js";
// 既存 import 経路の互換用に再エクスポート (providers と core で同一の上限を共有)。
export { MAX_GROUPS };

/**
 * カンマ区切り + 末尾ワイルドカード (prefix 一致) のロググループ式を解決する。
 * 各要素はまずエイリアス解決され、その値の末尾 `*` が DescribeLogGroups の
 * prefix 検索に置き換わる。完全名は問い合わせせずそのまま使う。
 */
export async function resolveGroupExpressions(
  expr: string,
  aliases: Readonly<Record<string, string>>,
  source: GroupSource
): Promise<string[]> {
  // 動的ブラケットアクセス (object injection) を避けるため Map 経由で解決する。
  const aliasMap = new Map(Object.entries(aliases));
  const items = [
    ...new Set(
      expr
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    ),
  ];
  const resolved: string[] = [];
  for (const item of items) {
    const name = aliasMap.get(item) ?? item;
    if (!name.endsWith("*")) {
      resolved.push(name);
      continue;
    }
    const prefix = name.slice(0, -1);
    const names = await source.listGroupNames(prefix);
    if (names.length === 0) {
      throw new Error(
        `ロググループが見つかりません: "${item}" (prefix "${prefix}" に一致するグループがありません)`
      );
    }
    if (resolved.length + names.length > MAX_GROUPS) {
      throw new Error(
        `ロググループの展開数が上限 (${MAX_GROUPS}) を超えました: ${resolved.length + names.length} 件。パターンを狭めてください`
      );
    }
    resolved.push(...names);
  }
  return [...new Set(resolved)];
}
