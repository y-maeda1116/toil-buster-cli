import type { SummaryResult } from "../core/aggregate.js";
import { formatWindow } from "./format.js";

const EMPTY_MESSAGE = "該当時間帯にエラーは見つかりませんでした";
const PATTERN_MAX = 80;
const escapeCell = (text: string) => text.replace(/\|/g, "\\|");
// スタックトレース等の複数行 pattern はテーブル行を壊すため 1 行化し、
// table.ts と同じ長さ cap を適用する。
const flattenPattern = (pattern: string) => {
  const flat = pattern.replace(/\s+/g, " ").trim();
  return flat.length > PATTERN_MAX ? `${flat.slice(0, PATTERN_MAX)}…` : flat;
};

export function renderMarkdown(result: SummaryResult, top: number): string {
  if (result.groups.length === 0) return `${EMPTY_MESSAGE}\n`;
  const lines = [
    `# Log Summary: ${result.logGroup}`,
    "",
    `- 期間: ${formatWindow(result.timeWindow.start, result.timeWindow.end)}`,
    `- イベント数: ${result.totalEvents}${result.truncated ? "（--limit により打ち切り）" : ""}`,
    "",
    "| # | count | % | pattern | first | last |",
    "|---|---|---|---|---|---|",
  ];
  for (const [i, g] of result.groups.slice(0, top).entries()) {
    const pct = ((g.count / result.totalEvents) * 100).toFixed(1);
    const hhmmss = (d: Date) => d.toTimeString().slice(0, 8);
    lines.push(
      `| ${i + 1} | ${g.count} | ${pct}% | \`${escapeCell(flattenPattern(g.pattern))}\` | ${hhmmss(g.firstSeen)} | ${hhmmss(
        g.lastSeen
      )} |`
    );
  }
  return `${lines.join("\n")}\n`;
}
