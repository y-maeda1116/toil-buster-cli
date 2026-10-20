import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { writeFileSync } from "node:fs";
import { Command, CommanderError } from "commander";
import { aggregateEvents } from "../core/aggregate.js";
import type { SummaryResult } from "../core/aggregate.js";
import { parseDuration } from "../core/duration.js";
import { compareGroups } from "../core/compare.js";
import { resolveGroupExpressions } from "../core/resolve-groups.js";
import { parseIgnoreSpecs } from "../core/ignore.js";
import { loadConfig } from "../config/load.js";
import { CloudWatchProvider } from "../providers/cloudwatch.js";
import type { LogProvider } from "../providers/types.js";
import { renderJson, toJsonValue } from "../render/json.js";
import { renderMarkdown } from "../render/markdown.js";
import { renderReport } from "../render/report.js";
import { renderTable } from "../render/table.js";
import { VERSION } from "../version.js";
import { buildFilterPattern } from "./filter-pattern.js";
import { resolveTimeWindow } from "../core/time-window.js";

export interface CliIo {
  stdout(text: string): void;
  stderr(text: string): void;
}

export interface RunDeps {
  providerFactory(opts: { region?: string; profile?: string }): LogProvider;
  env: NodeJS.ProcessEnv;
  now(): Date;
  /** --save 用のファイル書き込み (テストで注入する)。 */
  writeFile(path: string, content: string): void;
}

interface ErrorsOptions {
  time?: string;
  since?: string;
  until?: string;
  bucket?: string;
  compare?: string;
  level?: string;
  format?: string;
  top?: string;
  limit?: string;
  filter?: string;
  save?: string;
  showIgnored?: boolean;
  profile?: string;
  region?: string;
}

const DEFAULTS = { time: "15m", level: "ERROR", format: "table", top: 20, limit: 1000 } as const;
const FORMATS = ["table", "json", "md"] as const;

function positiveInt(flag: string, raw: string | number | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${flag} には正の整数を指定してください: "${raw}"`);
  }
  return n;
}

function classifyError(err: unknown): string {
  const name = (err as { name?: string }).name;
  const message = err instanceof Error ? err.message : String(err);
  switch (name) {
    case "ResourceNotFoundException":
      return `ロググループが見つかりません。グループ名と ~/.config/toil-buster/config.json のエイリアスを確認してください (${message})`;
    case "CredentialsProviderError":
    case "AccessDeniedException":
      return `AWS 認証エラー。aws configure または --profile を確認してください (${message})`;
    default:
      return `エラー: ${message}`;
  }
}

function formatError(err: unknown, format: string): string {
  const message = classifyError(err);
  if (format === "json") return `${JSON.stringify({ error: message })}\n`;
  return `${message}\n`;
}

// 単一グループは従来どおり 1 オブジェクト、複数グループは table/md はセクション連結、
// json は配列で出す。
function renderResults(results: SummaryResult[], format: string, top: number): string {
  const renderer = format === "json" ? renderJson : format === "md" ? renderMarkdown : renderTable;
  if (results.length === 1) return renderer(results[0]!, top);
  if (format === "json")
    return `${JSON.stringify(
      results.map((r) => toJsonValue(r, top)),
      null,
      2
    )}\n`;
  return results.map((r) => renderer(r, top)).join("\n");
}

async function execute(group: string, o: ErrorsOptions, io: CliIo, deps: RunDeps): Promise<number> {
  // loadConfig が throw しても --format json のエラーを構造化 JSON にできるよう、
  // format は try の前における値で初期化する (妥当性検証は try 内)。
  let format: string = o.format ?? DEFAULTS.format;
  try {
    const config = loadConfig(deps.env);
    format = o.format ?? config.defaults.format ?? DEFAULTS.format;
    if (!(FORMATS as readonly string[]).includes(format)) {
      throw new Error(`不正なフォーマット: "${format}" (table | json | md)`);
    }
    const timeSpec = o.time ?? config.defaults.time ?? DEFAULTS.time;
    if (o.time !== undefined && (o.since !== undefined || o.until !== undefined)) {
      throw new Error(
        "--time と --since/--until は同時に指定できません。絶対時刻は --since/--until を使ってください"
      );
    }
    const window = resolveTimeWindow(
      { time: timeSpec, since: o.since, until: o.until },
      deps.now()
    );
    const bucketMs = o.bucket === undefined ? undefined : parseDuration(o.bucket);
    const levelSpec = o.level ?? DEFAULTS.level;
    const top = positiveInt("--top", o.top ?? config.defaults.top, DEFAULTS.top);
    const limit = positiveInt("--limit", o.limit ?? config.defaults.limit, DEFAULTS.limit);
    const region = o.region ?? config.defaults.region;
    const profile = o.profile ?? config.defaults.profile;

    const filterPattern = o.filter ?? buildFilterPattern(levelSpec.split(","));
    const compareMs = o.compare === undefined ? undefined : parseDuration(o.compare);
    const provider = deps.providerFactory({ region, profile });
    const groups = await resolveGroupExpressions(group, config.aliases, provider);
    // --show-ignored は既知パターンも確認するモード。比較は表示 groups 基準で行う。
    const ignore = { specs: parseIgnoreSpecs(config.ignore), showIgnored: o.showIgnored };

    const results: SummaryResult[] = [];
    for (const logGroup of groups) {
      const { events, truncated } = await provider.fetch({
        logGroup,
        startTime: window.start,
        endTime: window.end,
        filterPattern,
        limit,
      });

      const summary = aggregateEvents(
        logGroup,
        window.start,
        window.end,
        events,
        truncated,
        bucketMs,
        ignore
      );

      if (compareMs === undefined) {
        results.push(summary);
        continue;
      }
      // 比較窓は現在窓の直前に隣接する同 filterPattern / limit のクエリ。
      const compareEnd = window.start;
      const compareStart = new Date(compareEnd.getTime() - compareMs);
      const prev = await provider.fetch({
        logGroup,
        startTime: compareStart,
        endTime: compareEnd,
        filterPattern,
        limit,
      });
      const prevSummary = aggregateEvents(
        logGroup,
        compareStart,
        compareEnd,
        prev.events,
        prev.truncated,
        undefined,
        ignore
      );
      results.push({
        ...summary,
        comparison: {
          timeWindow: { start: compareStart, end: compareEnd },
          totalEvents: prevSummary.totalEvents,
          groups: compareGroups(summary.groups, prevSummary.groups),
        },
      });
    }

    io.stdout(renderResults(results, format, top));
    if (o.save !== undefined) {
      try {
        // レポートは --format と独立に Markdown で書き、top 制限もかけない (報告書は全件)。
        deps.writeFile(
          o.save,
          renderReport(results, {
            generatedAt: deps.now(),
            filterPattern,
            limit,
          })
        );
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        throw new Error(`レポートの保存に失敗しました: ${o.save} (${message})`, { cause });
      }
      io.stderr(`レポートを保存しました: ${o.save}`);
    }
    return 0;
  } catch (err) {
    io.stderr(formatError(err, format));
    return 1;
  }
}

// CloudWatchProvider の Sender 型は callable (client.send) なので、
// client オブジェクトではなく send を bind した関数を渡す (Task 7 の ruling)。
const defaultProviderFactory = (opts: { region?: string; profile?: string }): LogProvider => {
  const client = new CloudWatchLogsClient(opts);
  return new CloudWatchProvider(client.send.bind(client));
};

export async function runErrorsCommand(
  argv: string[],
  io: CliIo,
  deps?: Partial<RunDeps>
): Promise<number> {
  const program = new Command();
  program
    .name("tb")
    .description("Toil Buster - CloudWatch Logs エラー抽出・統計CLI")
    .version(VERSION);
  program.exitOverride();
  program.configureOutput({
    writeOut: (s) => io.stdout(s),
    writeErr: (s) => io.stderr(s),
  });
  // commander v15 のサブコマンド一覧は "[options]" を自動付与する (legacy 仕様)。
  // usage() ベースの表示に上書きして "errors <group>" という語を出す。
  program.configureHelp({
    subcommandTerm: (cmd) => `${cmd.name()} ${cmd.usage()}`,
  });
  let parsed: { group: string; options: ErrorsOptions } | undefined;
  program
    .command("errors <group>")
    .usage("<group>")
    .description("指定期間のエラーログを抽出して統計表示")
    .option("-t, --time <dur>", "時間窓 (10m / 1h / 2d)。デフォルト 15m")
    .option("--since <datetime>", "開始時刻 (ISO 8601。例: 2026-10-18T14:00)。--time と併用不可")
    .option("--until <datetime>", "終了時刻 (ISO 8601)。省略時は現在時刻")
    .option("--bucket <dur>", "タイムラインのバケット幅 (例: 5m)。指定時は時間別カウントを表示")
    .option("--compare <dur>", "直前の指定幅の窓と比較 (NEW/増減を表示)")
    .option("-l, --level <levels>", "対象レベル (カンマ区切り)。デフォルト ERROR")
    .option("-f, --format <fmt>", "出力形式: table | json | md。デフォルト table")
    .option("--top <n>", "頻度ランキング上位件数。デフォルト 20")
    .option("--limit <n>", "取得最大イベント数。デフォルト 1000")
    .option("--filter <pattern>", "CloudWatch フィルタパターン直接指定")
    .option("--save <path>", "インシデントレポート (Markdown) を指定パスに保存する")
    .option("--show-ignored", "config ignore に一致するパターンも表示する")
    .option("--profile <name>", "AWS profile")
    .option("--region <region>", "AWS region")
    .action((group, options) => {
      parsed = { group, options: options as ErrorsOptions };
    });
  try {
    await program.parseAsync(argv, { from: "user" });
  } catch (err) {
    if (err instanceof CommanderError) return err.exitCode;
    throw err; // 予期しない例外は index.ts の .catch が拾って exit 1
  }
  if (parsed === undefined) return 0; // --help / --version
  const fullDeps: RunDeps = {
    providerFactory: deps?.providerFactory ?? defaultProviderFactory,
    env: deps?.env ?? process.env,
    now: deps?.now ?? (() => new Date()),
    writeFile: deps?.writeFile ?? ((path, content) => writeFileSync(path, content, "utf8")),
  };
  return execute(parsed.group, parsed.options, io, fullDeps);
}
