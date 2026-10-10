import type { SummaryResult } from "../core/aggregate.js";
import { formatWindow } from "./format.js";

const EMPTY_MESSAGE = "該当時間帯にエラーは見つかりませんでした";
const escapeCell = (text: string) => text.replace(/\|/g, "\\|");

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
      `| ${i + 1} | ${g.count} | ${pct}% | \`${escapeCell(g.pattern)}\` | ${hhmmss(g.firstSeen)} | ${hhmmss(
        g.lastSeen
      )} |`
    );
  }
  return `${lines.join("\n")}\n`;
}
