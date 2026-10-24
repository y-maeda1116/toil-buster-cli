import { Command, CommanderError } from "commander";
import { loadConfig } from "../config/load.js";
import { resolveGroupExpressions } from "../core/resolve-groups.js";
import { resolveTimeWindow } from "../core/time-window.js";
import { VERSION } from "../version.js";
import type { CliIo, RunDeps } from "./errors-command.js";
import { cloudWatchProviderFactory } from "../providers/factory.js";
import { selectTargetGroup } from "./select-target.js";

interface TailOptions {
  last?: string;
  lines?: string;
  profile?: string;
  region?: string;
  provider?: string;
}

const DEFAULTS = { last: "5m", lines: 50 } as const;

// 生ログは調査の起点になるため UTC ISO で出す (タイムゾーン誤読を防ぐ)。
const formatEvent = (timestamp: Date, message: string): string =>
  `${timestamp.toISOString()} ${message}`;

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

async function execute(
  group: string | undefined,
  o: TailOptions,
  io: CliIo,
  deps: RunDeps
): Promise<number> {
  try {
    const config = loadConfig(deps.env);
    const window = resolveTimeWindow({ time: o.last ?? DEFAULTS.last }, deps.now());
    const lines = positiveInt("--lines", o.lines, DEFAULTS.lines);
    const provider = deps.providerFactory({
      provider: o.provider ?? config.defaults.provider,
      region: o.region ?? config.defaults.region,
      profile: o.profile ?? config.defaults.profile,
    });
    // グループ名省略時は一覧からの対話選択 (非 TTY ではエラー)。
    const target = await selectTargetGroup(group, provider, deps);
    const groups = await resolveGroupExpressions(target, config.aliases, provider);

    for (const logGroup of groups) {
      const { events } = await provider.fetch({
        logGroup,
        startTime: window.start,
        endTime: window.end,
        filterPattern: "",
        limit: lines,
      });
      if (groups.length > 1) io.stdout(`=== ${logGroup} ===\n`);
      if (events.length === 0) {
        io.stdout("該当時間帯にログは見つかりませんでした\n");
        continue;
      }
      // CloudLogs の返却順に依存せず、時系列昇順で末尾 lines 件を出す。
      const sorted = [...events].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      for (const e of sorted.slice(-lines)) {
        io.stdout(`${formatEvent(e.timestamp, e.message)}\n`);
      }
    }
    return 0;
  } catch (err) {
    io.stderr(formatError(err));
    return 1;
  }
}

export async function runTailCommand(
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
  let parsed: { group: string | undefined; options: TailOptions } | undefined;
  program
    .command("tail [group]")
    .usage("[group]")
    .description("直近の生ログを時系列順に表示 (グループ省略時は対話選択)")
    .option("--last <dur>", "遡る時間窓 (10m / 1h)。デフォルト 5m")
    .option("--lines <n>", "表示する最大行数。デフォルト 50")
    .option(
      "--provider <name>",
      "ログバックエンド (cloudwatch | datadog)。datadog は DD_API_KEY / DD_APP_KEY / DD_SITE を使う"
    )
    .option("--profile <name>", "AWS profile")
    .option("--region <region>", "AWS region")
    .action((group, options) => {
      parsed = { group, options: options as TailOptions };
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
