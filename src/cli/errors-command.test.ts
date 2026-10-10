import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runErrorsCommand, type CliIo, type RunDeps } from "./errors-command.js";
import type { FetchResult, LogProvider, LogQuery } from "../providers/types.js";

const makeIo = (): CliIo & { out: string[]; err: string[] } => {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    stdout: (t) => out.push(t),
    stderr: (t) => err.push(t),
  };
};

describe("runErrorsCommand (skeleton)", () => {
  it("--help は終了コード 0 で usage を stdout に出す", async () => {
    const io = makeIo();
    const code = await runErrorsCommand(["--help"], io);
    expect(code).toBe(0);
    expect(io.out.join("")).toContain("tb");
  });

  it("--version はバージョン文字列を出す", async () => {
    const io = makeIo();
    const code = await runErrorsCommand(["--version"], io);
    expect(code).toBe(0);
    expect(io.out.join("")).toContain("0.1.0");
  });

  it("未知のオプションは 0 以外の終了コード", async () => {
    const io = makeIo();
    const code = await runErrorsCommand(["--bogus"], io);
    expect(code).not.toBe(0);
  });
});

const NOW = new Date("2026-10-03T10:00:00Z");
const dirs: string[] = [];
const withConfig = (content: string) => {
  const dir = mkdtempSync(join(tmpdir(), "tb-cli-"));
  dirs.push(dir);
  mkdirSync(join(dir, "toil-buster"), { recursive: true });
  writeFileSync(join(dir, "toil-buster", "config.json"), content);
  return { XDG_CONFIG_HOME: dir, HOME: dir };
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const okResult: FetchResult = {
  events: [
    { timestamp: new Date("2026-10-03T09:55:00Z"), message: "timeout id=1111" },
    { timestamp: new Date("2026-10-03T09:58:00Z"), message: "timeout id=2222" },
  ],
  truncated: false,
};

const makeDeps = (
  provider: LogProvider,
  env: NodeJS.ProcessEnv = { HOME: "/tmp" }
): Partial<RunDeps> => ({
  providerFactory: () => provider,
  env,
  now: () => NOW,
});

describe("runErrorsCommand: errors", () => {
  it("デフォルトで 15m 窓・ERROR タームフィルタ・limit 1000 でクエリし、table 出力する", async () => {
    const fetch = vi.fn<(q: LogQuery) => Promise<FetchResult>>().mockResolvedValue(okResult);
    const io = makeIo();
    const code = await runErrorsCommand(["errors", "prod-api"], io, makeDeps({ fetch }));
    expect(code).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    const q = fetch.mock.calls[0]![0];
    expect(q.logGroup).toBe("prod-api");
    expect(q.filterPattern).toBe("?ERROR ?Error ?error");
    expect(q.limit).toBe(1000);
    expect(q.startTime.getTime()).toBe(NOW.getTime() - 15 * 60_000);
    // Task 3 の normalizeMessage は key 名を保持するため "timeout id=<num>" (ブリーフの
    // "timeout <num>" は Task 3 の確定挙動 id=<uuid> と矛盾する最小修正)
    expect(io.out.join("")).toContain("timeout id=<num>");
    expect(io.out.join("")).toContain("2");
  });

  it("--time 10m と設定のエイリアス/defaults が反映される", async () => {
    const env = withConfig(
      JSON.stringify({ aliases: { "prod-api": "/aws/lambda/prod-api" }, defaults: { top: 1 } })
    );
    const fetch = vi.fn<(q: LogQuery) => Promise<FetchResult>>().mockResolvedValue(okResult);
    const io = makeIo();
    const code = await runErrorsCommand(
      ["errors", "prod-api", "--time", "10m"],
      io,
      makeDeps({ fetch }, env)
    );
    expect(code).toBe(0);
    expect(fetch.mock.calls[0]![0].logGroup).toBe("/aws/lambda/prod-api");
    expect(fetch.mock.calls[0]![0].startTime.getTime()).toBe(NOW.getTime() - 600_000);
  });

  it("--format json はパース可能な JSON を stdout へ", async () => {
    const fetch = vi.fn<(q: LogQuery) => Promise<FetchResult>>().mockResolvedValue(okResult);
    const io = makeIo();
    await runErrorsCommand(["errors", "g", "--format", "json"], io, makeDeps({ fetch }));
    const parsed = JSON.parse(io.out.join(""));
    expect(parsed.groups[0].pattern).toBe("timeout id=<num>");
    expect(parsed.groups[0].count).toBe(2);
  });

  it("--format json の実行時エラーは構造化して stderr へ、exit 1", async () => {
    const notFound = Object.assign(new Error("missing"), { name: "ResourceNotFoundException" });
    const fetch = vi.fn<(q: LogQuery) => Promise<FetchResult>>().mockRejectedValue(notFound);
    const io = makeIo();
    const code = await runErrorsCommand(
      ["errors", "g", "--format", "json"],
      io,
      makeDeps({ fetch })
    );
    expect(code).toBe(1);
    expect(JSON.parse(io.err.join("")).error).toContain("ロググループ");
  });

  it("ResourceNotFoundException はグループ確認のガイドを出す", async () => {
    const notFound = Object.assign(new Error("missing"), { name: "ResourceNotFoundException" });
    const fetch = vi.fn<(q: LogQuery) => Promise<FetchResult>>().mockRejectedValue(notFound);
    const io = makeIo();
    const code = await runErrorsCommand(["errors", "g"], io, makeDeps({ fetch }));
    expect(code).toBe(1);
    expect(io.err.join("")).toContain("ロググループが見つかりません");
  });

  it("AWS 認証系エラーは --profile のガイドを出す", async () => {
    const authErr = Object.assign(new Error("creds"), { name: "CredentialsProviderError" });
    const fetch = vi.fn<(q: LogQuery) => Promise<FetchResult>>().mockRejectedValue(authErr);
    const io = makeIo();
    const code = await runErrorsCommand(["errors", "g"], io, makeDeps({ fetch }));
    expect(code).toBe(1);
    expect(io.err.join("")).toContain("--profile");
  });

  it("不正な --time は exit 1 で Invalid duration", async () => {
    const io = makeIo();
    const code = await runErrorsCommand(
      ["errors", "g", "--time", "bad"],
      io,
      makeDeps({ fetch: vi.fn() })
    );
    expect(code).toBe(1);
    expect(io.err.join("")).toContain("Invalid duration");
  });

  it("破損した設定ファイルは exit 1", async () => {
    const env = withConfig("{ broken");
    const io = makeIo();
    const code = await runErrorsCommand(["errors", "g"], io, makeDeps({ fetch: vi.fn() }, env));
    expect(code).toBe(1);
    expect(io.err.join("")).toContain("設定ファイル");
  });

  it("--format json で破損した設定ファイルでも stderr は構造化 JSON", async () => {
    const env = withConfig("{ broken");
    const io = makeIo();
    const code = await runErrorsCommand(
      ["errors", "g", "--format", "json"],
      io,
      makeDeps({ fetch: vi.fn() }, env)
    );
    expect(code).toBe(1);
    const parsed = JSON.parse(io.err.join(""));
    expect(parsed.error).toContain("設定ファイル");
  });

  it("0 件は exit 0 でメッセージ表示", async () => {
    const fetch = vi
      .fn<(q: LogQuery) => Promise<FetchResult>>()
      .mockResolvedValue({ events: [], truncated: false });
    const io = makeIo();
    const code = await runErrorsCommand(["errors", "g"], io, makeDeps({ fetch }));
    expect(code).toBe(0);
    expect(io.out.join("")).toContain("該当時間帯にエラーは見つかりませんでした");
  });

  it("--filter は level 由来のパターンを上書きする", async () => {
    const fetch = vi.fn<(q: LogQuery) => Promise<FetchResult>>().mockResolvedValue(okResult);
    const io = makeIo();
    await runErrorsCommand(
      ["errors", "g", "--filter", '{ $.level = "ERROR" }'],
      io,
      makeDeps({ fetch })
    );
    expect(fetch.mock.calls[0]![0].filterPattern).toBe('{ $.level = "ERROR" }');
  });

  it("--profile/--region を providerFactory へ渡す", async () => {
    const factory = vi.fn(
      () => ({ fetch: vi.fn().mockResolvedValue(okResult) }) as unknown as LogProvider
    );
    const io = makeIo();
    await runErrorsCommand(["errors", "g", "--profile", "prod", "--region", "ap-northeast-1"], io, {
      providerFactory: factory,
      env: { HOME: "/tmp" },
      now: () => NOW,
    });
    expect(factory).toHaveBeenCalledWith({ region: "ap-northeast-1", profile: "prod" });
  });
});
