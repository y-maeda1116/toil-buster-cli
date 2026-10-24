import chalk from "chalk";
import Table from "cli-table3";
import { Command, CommanderError } from "commander";
import { loadConfig } from "../config/load.js";
import { parseDuration } from "../core/duration.js";
import { resolveGroupExpressions } from "../core/resolve-groups.js";
import { resolveTimeWindow } from "../core/time-window.js";
import type { InsightsRow } from "../providers/insights.js";
import { VERSION } from "../version.js";
import type { CliIo, RunDeps } from "./errors-command.js";
import { cloudWatchProviderFactory, insightsProviderFactory } from "../providers/factory.js";
import { selectTargetGroup } from "./select-target.js";

interface InsightsOptions {
  time?: string;
  level?: string;
  query?: string;
  format?: string;
  limit?: string;
  interval?: string;
  timeout?: string;
  profile?: string;
  region?: string;
}

const DEFAULTS = {
  time: "15m",
  level: "ERROR",
  format: "table",
  limit: 1000,
  interval: "1s",
  timeout: "60s",
} as const;
const FORMATS = ["table", "json"] as const;
const TERMINAL_FAILURES = new Set(["Failed", "Cancelled", "Timeout"]);

function positiveInt(flag: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${flag} には正の整数を指定してください: "${raw}"`);
  }
  return n;
}

// Insights の filter は /.../ 部分一致。レベル語は大文字表記が支配的のため大文字で探す。
const buildDefaultQuery = (levels: readonly string[]): string => {
  const clauses = levels
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => `@message like /${l.toUpperCase()}/`);
  if (clauses.length === 0) {
    throw new Error("レベルが指定されていません (--level WARN,ERROR の形式で指定してください)");
  }
  return `filter ${clauses.join(" or ")} | stats count() as count by bin(1m) as bucket | sort bucket asc`;
};

function formatError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return `エラー: ${message}\n`;
}

function renderTable(rows: readonly InsightsRow[]): string {
  if (rows.length === 0) return "クエリ結果は 0 件でした\n";
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const table = new Table({ head: columns.map((c) => chalk.bold(c)) });
  for (const row of rows) {
    // GetQueryResults の field 名を行オブジェクトのキーに縮約しただけのものなので許容する。
    // eslint-disable-next-line security/detect-object-injection
    table.push(columns.map((c) => row[c] ?? ""));
  }
  return `${table.toString()}\n`;
}

async function execute(
  group: string | undefined,
  o: InsightsOptions,
  io: CliIo,
  deps: RunDeps
): Promise<number> {
  try {
    const config = loadConfig(deps.env);
    const format = o.format ?? DEFAULTS.format;
    if (!(FORMATS as readonly string[]).includes(format)) {
      throw new Error(`不正なフォーマット: "${format}" (table | json)`);
    }
    const window = resolveTimeWindow(
      { time: o.time ?? config.defaults.time ?? DEFAULTS.time },
      deps.now()
    );
    const limit = positiveInt("--limit", o.limit, DEFAULTS.limit);
    const intervalMs = parseDuration(o.interval ?? DEFAULTS.interval);
    const timeoutMs = parseDuration(o.timeout ?? DEFAULTS.timeout);
    const queryString = o.query ?? buildDefaultQuery((o.level ?? DEFAULTS.level).split(","));

    // エイリアス / ワイルドカード解決は既存の CloudWatchProvider (LogProvider) を流用する。
    const provider = deps.providerFactory({
      region: o.region ?? config.defaults.region,
      profile: o.profile ?? config.defaults.profile,
    });
    // グループ名省略時は一覧からの対話選択 (非 TTY ではエラー)。
    const target = await selectTargetGroup(group, provider, deps);
    const groups = await resolveGroupExpressions(target, config.aliases, provider);
    const client = (deps.insightsFactory ?? insightsProviderFactory)({
      region: o.region ?? config.defaults.region,
      profile: o.profile ?? config.defaults.profile,
    });

    const queryId = await client.startQuery({
      logGroups: groups,
      start: window.start,
      end: window.end,
      queryString,
      limit,
    });
    // 締切判定は実時刻に依存せずポーリング回数で行う (now を固定できるテスト容易性のため)。
    const maxPolls = Math.max(1, Math.ceil(timeoutMs / intervalMs));
    for (let poll = 0; ; poll++) {
      const state = await client.status(queryId);
      if (state === "Complete") break;
      if (TERMINAL_FAILURES.has(state)) {
        throw new Error(`Insights クエリが失敗しました (status: ${state})`);
      }
      if (poll + 1 >= maxPolls) {
        throw new Error(
          `Insights クエリがタイムアウトしました (${o.timeout ?? DEFAULTS.timeout} 以内に完了しませんでした)`
        );
      }
      await deps.sleep(intervalMs);
    }
    const rows = await client.results(queryId);
    if (format === "json") {
      io.stdout(`${JSON.stringify(rows, null, 2)}\n`);
    } else {
      io.stdout(renderTable(rows));
    }
    return 0;
  } catch (err) {
    io.stderr(formatError(err));
    return 1;
  }
}

export async function runInsightsCommand(
  argv: string[],
  io: CliIo,
  deps?: Partial<RunDeps>
): Promise<number> {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({
    writeOut: (s) => io.stdout(s),
    writeErr: (s) => io.stderr(s),
  });
  let parsed: { group: string | undefined; options: InsightsOptions } | undefined;
  program
    .command("insights [group]")
    .usage("[group]")
    .description("CloudWatch Logs Insights クエリで集計して表示 (グループ省略時は対話選択)")
    .option("-t, --time <dur>", "集計する時間窓 (10m / 1h / 2d)。デフォルト 15m")
    .option("-l, --level <levels>", "既定クエリの対象レベル (カンマ区切り)。デフォルト ERROR")
    .option("--query <queryString>", "Insights クエリを直接指定 (既定クエリを上書き)")
    .option("-f, --format <fmt>", "出力形式: table | json。デフォルト table")
    .option("--limit <n>", "クエリの最大結果行数。デフォルト 1000")
    .option("--interval <dur>", "ポーリング間隔。デフォルト 1s")
    .option("--timeout <dur>", "クエリ完了を待つ上限時間。デフォルト 60s")
    .option("--profile <name>", "AWS profile")
    .option("--region <region>", "AWS region")
    .action((group, options) => {
      parsed = { group, options: options as InsightsOptions };
    });
  program.version(VERSION);
  try {
    await program.parseAsync(argv, { from: "user" });
  } catch (err) {
    if (err instanceof CommanderError) return err.exitCode;
    throw err;
  }
  if (parsed === undefined) return 0;
  const fullDeps: RunDeps = {
    providerFactory: deps?.providerFactory ?? cloudWatchProviderFactory,
    insightsFactory: deps?.insightsFactory ?? insightsProviderFactory,
    env: deps?.env ?? process.env,
    now: deps?.now ?? (() => new Date()),
    writeFile: deps?.writeFile ?? (() => {}),
    sleep: deps?.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
    clearScreen: deps?.clearScreen ?? (() => {}),
  };
  return execute(parsed.group, parsed.options, io, fullDeps);
}
