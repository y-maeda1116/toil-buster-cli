import { Command, CommanderError } from "commander";
import { loadConfig } from "../config/load.js";
import { withContext } from "../core/context.js";
import { resolveGroupExpressions } from "../core/resolve-groups.js";
import { resolveTimeWindow } from "../core/time-window.js";
import type { LogEvent } from "../providers/types.js";
import { VERSION } from "../version.js";
import type { CliIo, RunDeps } from "./errors-command.js";
import { cloudWatchProviderFactory } from "../providers/factory.js";

interface ShowOptions {
  pattern?: string;
  time?: string;
  context?: string;
  limit?: string;
  profile?: string;
  region?: string;
}

const DEFAULTS = { time: "15m", context: 2, limit: 1000 } as const;

function positiveInt(flag: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${flag} には正の整数を指定してください: "${raw}"`);
  }
  return n;
}

function formatError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return `エラー: ${message}\n`;
}

// 生ログは調査の起点になるため UTC ISO で出す。マッチ行は * を付ける。
const formatLine = (e: LogEvent, matched: boolean): string =>
  `${e.timestamp.toISOString()} ${matched ? "*" : " "} ${e.message}`;

async function execute(group: string, o: ShowOptions, io: CliIo, deps: RunDeps): Promise<number> {
  try {
    if (o.pattern === undefined) {
      throw new Error("--pattern で表示したい行の正規表現を指定してください");
    }
    // ユーザーが CLI で指定した正規表現であり、機能として正規表現を受け付ける設計のため許容する。
    let matcher: RegExp;
    try {
      // eslint-disable-next-line security/detect-non-literal-regexp
      matcher = new RegExp(o.pattern);
    } catch (cause) {
      throw new Error(`--pattern の正規表現が不正です: "${o.pattern}"`, { cause });
    }
    const config = loadConfig(deps.env);
    const window = resolveTimeWindow({ time: o.time ?? DEFAULTS.time }, deps.now());
    const contextLines = positiveInt("--context", o.context, DEFAULTS.context);
    const limit = positiveInt("--limit", o.limit, DEFAULTS.limit);
    const provider = deps.providerFactory({
      region: o.region ?? config.defaults.region,
      profile: o.profile ?? config.defaults.profile,
    });
    const groups = await resolveGroupExpressions(group, config.aliases, provider);

    for (const logGroup of groups) {
      const { events } = await provider.fetch({
        logGroup,
        startTime: window.start,
        endTime: window.end,
        filterPattern: "",
        limit,
      });
      if (groups.length > 1) io.stdout(`=== ${logGroup} ===\n`);
      // 返却順に依存せず時系列昇順に並べてから文脈を取る。
      const sorted = [...events].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      const matches = sorted.flatMap((e, i) => (matcher.test(e.message) ? [i] : []));
      if (matches.length === 0) {
        io.stdout("パターンに一致する行は見つかりませんでした\n");
        continue;
      }
      for (const line of withContext(sorted, matches, contextLines)) {
        io.stdout(`${formatLine(line.event, line.matched)}\n`);
      }
    }
    return 0;
  } catch (err) {
    io.stderr(formatError(err));
    return 1;
  }
}

export async function runShowCommand(
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
  let parsed: { group: string; options: ShowOptions } | undefined;
  program
    .command("show <group>")
    .usage("<group> --pattern <regex>")
    .description("正規表現に一致した行と前後の文脈を生ログで表示")
    .requiredOption("--pattern <regex>", "表示したい行の正規表現")
    .option("-t, --time <dur>", "遡る時間窓。デフォルト 15m")
    .option("--context <n>", "マッチ行の前後文脈行数。デフォルト 2")
    .option("--limit <n>", "取得最大イベント数。デフォルト 1000")
    .option("--profile <name>", "AWS profile")
    .option("--region <region>", "AWS region")
    .action((group, options) => {
      parsed = { group, options: options as ShowOptions };
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
    env: deps?.env ?? process.env,
    now: deps?.now ?? (() => new Date()),
    writeFile: deps?.writeFile ?? (() => {}),
    sleep: deps?.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
    clearScreen: deps?.clearScreen ?? (() => {}),
  };
  return execute(parsed.group, parsed.options, io, fullDeps);
}
