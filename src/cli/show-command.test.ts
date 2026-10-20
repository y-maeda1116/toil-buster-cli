import { describe, expect, it, vi } from "vitest";
import { runShowCommand } from "./show-command.js";
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

describe("runShowCommand", () => {
  it("pattern にマッチした行と前後の文脈を表示する", async () => {
    const fetch = vi.fn<(q: LogQuery) => Promise<FetchResult>>().mockResolvedValue(
      fetchResult([
        ["2026-10-03T09:57:00Z", "before"],
        ["2026-10-03T09:58:00Z", "TimeoutError: api"],
        ["2026-10-03T09:59:00Z", "after"],
      ])
    );
    const io = makeIo();
    const code = await runShowCommand(
      ["show", "g", "--pattern", "TimeoutError"],
      io,
      makeDeps({ fetch })
    );
    expect(code).toBe(0);
    const out = io.out.join("");
    expect(out).toContain("before");
    expect(out).toContain("after");
    // マッチ行には目印が付く
    expect(out).toMatch(/\*\s*TimeoutError: api/);
  });

  it("複数マッチの文脈は重複なく 1 つの区間になる", async () => {
    const fetch = vi.fn<(q: LogQuery) => Promise<FetchResult>>().mockResolvedValue(
      fetchResult([
        ["2026-10-03T09:57:00Z", "hit1"],
        ["2026-10-03T09:58:00Z", "middle"],
        ["2026-10-03T09:59:00Z", "hit2"],
      ])
    );
    const io = makeIo();
    await runShowCommand(["show", "g", "--pattern", "hit"], io, makeDeps({ fetch }));
    const out = io.out.join("");
    expect(out).toContain("hit1");
    expect(out).toContain("middle");
    expect(out).toContain("hit2");
    // middle は文脈行で 1 回だけ出る
    expect(out.split("middle").length - 1).toBe(1);
  });

  it("マッチなしならメッセージを出し exit 0", async () => {
    const fetch = vi
      .fn<(q: LogQuery) => Promise<FetchResult>>()
      .mockResolvedValue(fetchResult([["2026-10-03T09:58:00Z", "unrelated"]]));
    const io = makeIo();
    const code = await runShowCommand(
      ["show", "g", "--pattern", "nomatch-xyz"],
      io,
      makeDeps({ fetch })
    );
    expect(code).toBe(0);
    expect(io.out.join("")).toContain("パターンに一致する行は見つかりませんでした");
  });

  it("--pattern 未指定はエラーで終了する", async () => {
    const io = makeIo();
    const code = await runShowCommand(["show", "g"], io, makeDeps({ fetch: vi.fn() }));
    expect(code).toBe(1);
    expect(io.err.join("")).toContain("--pattern");
  });

  it("不正な正規表現はエラーで終了する", async () => {
    const io = makeIo();
    const code = await runShowCommand(
      ["show", "g", "--pattern", "[unclosed"],
      io,
      makeDeps({ fetch: vi.fn() })
    );
    expect(code).toBe(1);
    expect(io.err.join("")).toContain("正規表現");
  });

  it("fetch には空 filterPattern が渡り生メッセージに対して判定する", async () => {
    const fetch = vi.fn<(q: LogQuery) => Promise<FetchResult>>().mockResolvedValue(fetchResult([]));
    const io = makeIo();
    await runShowCommand(
      ["show", "g", "--pattern", "x", "--context", "1"],
      io,
      makeDeps({ fetch })
    );
    expect(fetch).toHaveBeenCalledWith(expect.objectContaining({ filterPattern: "" }));
  });
});
