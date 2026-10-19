import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { Command, CommanderError } from "commander";
import { aggregateEvents } from "../core/aggregate.js";
import { parseDuration } from "../core/duration.js";
import { loadConfig, resolveGroupName } from "../config/load.js";
import { CloudWatchProvider } from "../providers/cloudwatch.js";
import type { LogProvider } from "../providers/types.js";
import { renderJson } from "../render/json.js";
import { renderMarkdown } from "../render/markdown.js";
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
}

interface ErrorsOptions {
  time?: string;
  since?: string;
  until?: string;
  bucket?: string;
  level?: string;
  format?: string;
  top?: string;
  limit?: string;
  filter?: string;
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

async function execute(group: string, o: ErrorsOptions, io: CliIo, deps: RunDeps): Promise<number> {
  // loadConfig が throw しても --format json のエラーを構造化 JSON にできるよう、
  // format は try の前における値で初期化する (妥当性検証は try 内)。
  let format: string = o.format ?? DEFAULTS.format;
  try {
    const config = loadConfig(deps.env);
    const resolvedGroup = resolveGroupName(group, config.aliases);
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

    const { events, truncated } = await deps.providerFactory({ region, profile }).fetch({
      logGroup: resolvedGroup,
      startTime: window.start,
      endTime: window.end,
      filterPattern,
      limit,
    });

    const summary = aggregateEvents(
      resolvedGroup,
      window.start,
      window.end,
      events,
      truncated,
      bucketMs
    );
    const renderer =
      format === "json" ? renderJson : format === "md" ? renderMarkdown : renderTable;
    io.stdout(renderer(summary, top));
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
    .option("-l, --level <levels>", "対象レベル (カンマ区切り)。デフォルト ERROR")
    .option("-f, --format <fmt>", "出力形式: table | json | md。デフォルト table")
    .option("--top <n>", "頻度ランキング上位件数。デフォルト 20")
    .option("--limit <n>", "取得最大イベント数。デフォルト 1000")
    .option("--filter <pattern>", "CloudWatch フィルタパターン直接指定")
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
  };
  return execute(parsed.group, parsed.options, io, fullDeps);
}
