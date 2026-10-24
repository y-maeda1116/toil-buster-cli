import chalk from "chalk";
import Table from "cli-table3";
import type { SummaryResult } from "../core/aggregate.js";
import type { TimeBucket } from "../core/timeline.js";
import type { ComparedGroup } from "../core/compare.js";
import { formatTime, formatWindow } from "./format.js";

const EMPTY_MESSAGE = "該当時間帯にエラーは見つかりませんでした";
const PATTERN_MAX = 80;
const BAR_MAX_WIDTH = 30;
const BAR_CHAR = "█";
const STATUS_LABEL: Record<ComparedGroup["status"], string> = {
  new: "NEW",
  increased: "UP",
  unchanged: "SAME",
  decreased: "DOWN",
  resolved: "RESOLVED",
};

function renderTimelineRows(buckets: readonly TimeBucket[]): string[] {
  const table = new Table({
    head: ["TIME", "COUNT", "BAR"].map((h) => chalk.bold(h)),
  });
  const max = Math.max(...buckets.map((b) => b.count), 1);
  for (const b of buckets) {
    const width = Math.round((b.count / max) * BAR_MAX_WIDTH);
    table.push([formatTime(b.start), b.count, BAR_CHAR.repeat(width)]);
  }
  return [chalk.bold("Timeline"), table.toString()];
}

function renderComparisonRows(
  comparison: NonNullable<SummaryResult["comparison"]>,
  top: number
): string[] {
  const table = new Table({
    head: ["STATUS", "COUNT", "PREV", "DELTA", "PATTERN"].map((h) => chalk.bold(h)),
  });
  for (const g of comparison.groups.slice(0, top)) {
    const sign = g.delta > 0 ? "+" : "";
    table.push([
      STATUS_LABEL[g.status],
      g.count,
      g.prevCount,
      `${sign}${g.delta}`,
      truncatePattern(g.pattern),
    ]);
  }
  return [
    chalk.bold(
      `Comparison (vs ${formatWindow(comparison.timeWindow.start, comparison.timeWindow.end)})`
    ),
    table.toString(),
  ];
}

function truncatePattern(pattern: string): string {
  return pattern.length > PATTERN_MAX ? `${pattern.slice(0, PATTERN_MAX)}…` : pattern;
}

export function renderTable(result: SummaryResult, top: number): string {
  const lines = [
    chalk.bold(`Log Group: ${result.logGroup}`),
    `Window: ${formatWindow(result.timeWindow.start, result.timeWindow.end)}  Events: ${result.totalEvents}`,
  ];
  if (result.truncated) lines.push(chalk.yellow("⚠ --limit に達したため結果を打ち切りました"));
  if (result.groups.length === 0) {
    lines.push(EMPTY_MESSAGE);
  } else {
    const table = new Table({
      head: ["#", "COUNT", "%", "FIRST", "LAST", "PATTERN"].map((h) => chalk.bold(h)),
    });
    for (const [i, g] of result.groups.slice(0, top).entries()) {
      const pct = ((g.count / result.totalEvents) * 100).toFixed(1);
      table.push([
        i + 1,
        g.count,
        pct,
        formatTime(g.firstSeen),
        formatTime(g.lastSeen),
        truncatePattern(g.pattern),
      ]);
    }
    lines.push(table.toString());
  }
  if (result.timeline) lines.push(...renderTimelineRows(result.timeline));
  if (result.comparison) lines.push(...renderComparisonRows(result.comparison, top));
  return `${lines.join("\n")}\n`;
}
