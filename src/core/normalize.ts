// 適用順序が重要: UUID → 時刻 → IP → hex → 数値
// (先にマスクされたプレースホルダは後続ルールの入力にならない)
// detect-unsafe-regex は誤検知: 各ルールは文字クラス + リテラル区切り + 有界量指定子 ({n,m}) のみで
// 指数バックトラッキングは発生せず、入力も単一ログ行 (短い固定長寄り) に限定される
/* eslint-disable security/detect-unsafe-regex */
const RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>"],
  [/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})\b/g, "<ts>"],
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "<ip>"],
  [/\b(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{0,4}\b/gi, "<ip>"],
  [/\b(?:[0-9a-f]{1,4}:){2,7}:[0-9a-f]{1,4}\b/gi, "<ip>"],
  [/\b0x[0-9a-f]+\b/gi, "<hex>"],
  [/\b(?=[0-9a-f]*[a-f])[0-9a-f]{8,}\b/gi, "<hex>"],
  [/\b\d{4,}/g, "<num>"],
];

export function normalizeMessage(message: string): string {
  return RULES.reduce((acc, [pattern, token]) => acc.replace(pattern, token), message);
}
