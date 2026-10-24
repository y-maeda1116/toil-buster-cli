import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runTailCommand } from "./tail-command.js";
import type { CliIo, RunDeps } from "./errors-command.js";
import type { FetchResult, LogEvent, LogProvider, LogQuery } from "../providers/types.js";

const makeIo = (): CliIo & { out: string[]; err: string[] } => {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, stdout: (t) => out.push(t), stderr: (t) => err.push(t) };
};

const NOW = new Date("2026-10-03T10:00:00Z");

const makeDeps = (provider: Partial<LogProvider>): Partial<RunDeps> => ({
  providerFactory: () => provider as LogProvider,
  env: { HOME: "/tmp" },
  now: () => NOW,
});

const fetchResult = (messages: [string, string][]): FetchResult => ({
  events: messages.map(([t, m]): LogEvent => ({ timestamp: new Date(t), message: m })),
  truncated: false,
});

describe("runTailCommand", () => {
  it("直近のイベントを時系列昇順で表示する", async () => {
    const fetch = vi.fn<(q: LogQuery) => Promise<FetchResult>>().mockResolvedValue(
      fetchResult([
        ["2026-10-03T09:59:00Z", "second"],
        ["2026-10-03T09:58:00Z", "first"],
        ["2026-10-03T09:57:00Z", "oldest"],
      ])
    );
    const io = makeIo();
    const code = await runTailCommand(["tail", "g"], io, makeDeps({ fetch }));
    expect(code).toBe(0);
    const out = io.out.join("");
    expect(out.indexOf("oldest")).toBeLessThan(out.indexOf("second"));
    expect(out).toContain("2026-10-03T09:57:00.000Z oldest");
  });

  it("fetch には空 filterPattern と --lines 件数が渡る", async () => {
    const fetch = vi.fn<(q: LogQuery) => Promise<FetchResult>>().mockResolvedValue(fetchResult([]));
    const io = makeIo();
    await runTailCommand(["tail", "g", "--lines", "25"], io, makeDeps({ fetch }));
    expect(fetch).toHaveBeenCalledWith(expect.objectContaining({ filterPattern: "", limit: 25 }));
  });

  it("--last が時間窓になる", async () => {
    const fetch = vi.fn<(q: LogQuery) => Promise<FetchResult>>().mockResolvedValue(fetchResult([]));
    const io = makeIo();
    await runTailCommand(["tail", "g", "--last", "1h"], io, makeDeps({ fetch }));
    const call = fetch.mock.calls[0]![0];
    expect(call.startTime.getTime()).toBe(NOW.getTime() - 60 * 60_000);
    expect(call.endTime.getTime()).toBe(NOW.getTime());
  });

  it("イベントなしならメッセージを出し exit 0", async () => {
    const fetch = vi.fn<(q: LogQuery) => Promise<FetchResult>>().mockResolvedValue(fetchResult([]));
    const io = makeIo();
    const code = await runTailCommand(["tail", "g"], io, makeDeps({ fetch }));
    expect(code).toBe(0);
    expect(io.out.join("")).toContain("該当時間帯にログは見つかりませんでした");
  });

  it("エイリアスを解決して fetch する", async () => {
    const fetch = vi.fn<(q: LogQuery) => Promise<FetchResult>>().mockResolvedValue(fetchResult([]));
    const dir = mkdtempSync(join(tmpdir(), "tb-tail-"));
    mkdirSync(join(dir, "toil-buster"), { recursive: true });
    writeFileSync(
      join(dir, "toil-buster", "config.json"),
      JSON.stringify({ aliases: { api: "/real/api" } })
    );
    try {
      const io = makeIo();
      await runTailCommand(["tail", "api"], io, {
        ...makeDeps({ fetch }),
        env: { XDG_CONFIG_HOME: dir, HOME: dir },
      });
      expect(fetch.mock.calls[0]![0].logGroup).toBe("/real/api");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("runTailCommand: --provider", () => {
  it("--provider datadog が providerFactory へ渡る", async () => {
    const fetch = vi
      .fn<(q: LogQuery) => Promise<FetchResult>>()
      .mockResolvedValue(fetchResult([["2026-10-03T09:58:00Z", "hello"]]));
    const providerFactory = vi
      .fn<(opts: { provider?: string }) => LogProvider>()
      .mockReturnValue({ fetch, listGroupNames: vi.fn() } as unknown as LogProvider);
    const io = makeIo();
    const code = await runTailCommand(["tail", "g", "--provider", "datadog"], io, {
      providerFactory,
      env: { HOME: "/tmp" },
      now: () => NOW,
    });
    expect(code).toBe(0);
    expect(providerFactory.mock.calls[0]![0].provider).toBe("datadog");
  });
});
