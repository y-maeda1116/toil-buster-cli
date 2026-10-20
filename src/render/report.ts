import type { SummaryResult } from "../core/aggregate.js";
import { renderMarkdown } from "./markdown.js";

export interface ReportMeta {
  /** レポート生成時刻 (UTC)。 */
  generatedAt: Date;
  /** 適用した CloudWatch フィルタパターン。 */
  filterPattern: string;
  /** 取得上限 (--limit)。 */
  limit: number;
}

// timeline.ts と同じ表記に揃え、ミリ秒が 0 のときは省略する。
const isoShort = (d: Date) => d.toISOString().replace(".000Z", "Z");

/**
 * インシデント報告にそのまま貼れる構成の Markdown レポートを生成する。
 * 冒頭に実行条件のメタ情報を置き、各ロググループのサマリを続ける。
 */
export function renderReport(results: readonly SummaryResult[], meta: ReportMeta): string {
  const lines = [
    "# Toil Buster Report",
    "",
    `- 実行時刻: ${isoShort(meta.generatedAt)}`,
    `- フィルタ: \`${meta.filterPattern}\``,
    `- 取得上限 (--limit): ${meta.limit}`,
    "",
    "---",
    "",
  ];
  return `${lines.join("\n")}${results.map((r) => renderMarkdown(r, Number.MAX_SAFE_INTEGER)).join("\n")}`;
}
