import chalk from "chalk";
import Table from "cli-table3";
import type { SummaryResult } from "../core/aggregate.js";
import { formatTime, formatWindow } from "./format.js";

const EMPTY_MESSAGE = "該当時間帯にエラーは見つかりませんでした";
const PATTERN_MAX = 80;

export function renderTable(result: SummaryResult, top: number): string {
  if (result.groups.length === 0) return `${EMPTY_MESSAGE}\n`;
  const table = new Table({
    head: ["#", "COUNT", "%", "FIRST", "LAST", "PATTERN"].map((h) => chalk.bold(h)),
  });
  for (const [i, g] of result.groups.slice(0, top).entries()) {
    const pct = ((g.count / result.totalEvents) * 100).toFixed(1);
    const pattern =
      g.pattern.length > PATTERN_MAX ? `${g.pattern.slice(0, PATTERN_MAX)}…` : g.pattern;
    table.push([i + 1, g.count, pct, formatTime(g.firstSeen), formatTime(g.lastSeen), pattern]);
  }
  const lines = [
    chalk.bold(`Log Group: ${result.logGroup}`),
    `Window: ${formatWindow(result.timeWindow.start, result.timeWindow.end)}  Events: ${result.totalEvents}`,
  ];
  if (result.truncated) lines.push(chalk.yellow("⚠ --limit に達したため結果を打ち切りました"));
  lines.push(table.toString());
  return `${lines.join("\n")}\n`;
}
