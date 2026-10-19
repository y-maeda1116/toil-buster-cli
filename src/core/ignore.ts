/**
 * 既知エラー抑制のための ignore 仕様。
 * `/.../` 形式は正規表現 (部分一致)、それ以外は正規化済みパターンとの完全一致。
 */
export type IgnoreSpec =
  | { readonly type: "exact"; readonly value: string }
  | { readonly type: "regex"; readonly source: string };

export function parseIgnoreSpecs(raws: readonly string[]): IgnoreSpec[] {
  const specs: IgnoreSpec[] = [];
  for (const raw of raws) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith("/") && trimmed.endsWith("/") && trimmed.length >= 2) {
      const source = trimmed.slice(1, -1);
      try {
        // ユーザー自身の設定ファイル由来のパターンであり、機能として正規表現を
        // 受け付ける設計のため許容する (起動時に構文検証済み)。
        // eslint-disable-next-line security/detect-non-literal-regexp
        new RegExp(source);
      } catch (cause) {
        throw new Error(`ignore パターンの正規表現が不正です: "${trimmed}"`, { cause });
      }
      specs.push({ type: "regex", source });
      continue;
    }
    specs.push({ type: "exact", value: trimmed });
  }
  return specs;
}

export function isIgnored(pattern: string, specs: readonly IgnoreSpec[]): boolean {
  for (const spec of specs) {
    if (spec.type === "exact") {
      if (pattern === spec.value) return true;
      continue;
    }
    // 上記と同じ理由で動的 RegExp を許容する。
    // eslint-disable-next-line security/detect-non-literal-regexp
    if (new RegExp(spec.source).test(pattern)) return true;
  }
  return false;
}
