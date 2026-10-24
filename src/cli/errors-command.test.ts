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
  provider: Partial<LogProvider>,
  env: NodeJS.ProcessEnv = { HOME: "/tmp" }
): Partial<RunDeps> => ({
  providerFactory: () => provider as LogProvider,
  env,
  now: () => NOW,
});

describe("runErrorsCommand: since/until", () => {
  it("--since/--until が provider のクエリにそのまま渡る", async () => {
    const fetch = vi.fn<(q: LogQuery) => Promise<FetchResult>>().mockResolvedValue(okResult);
    const io = makeIo();
    const code = await runErrorsCommand(
      ["errors", "g", "--since", "2026-10-01T09:00:00Z", "--until", "2026-10-01T10:30:00Z"],
      io,
      makeDeps({ fetch })
    );
    expect(code).toBe(0);
    expect(fetch.mock.calls[0]![0].startTime.toISOString()).toBe("2026-10-01T09:00:00.000Z");
    expect(fetch.mock.calls[0]![0].endTime.toISOString()).toBe("2026-10-01T10:30:00.000Z");
  });

  it("--since のみ指定は end が now になる", async () => {
    const fetch = vi.fn<(q: LogQuery) => Promise<FetchResult>>().mockResolvedValue(okResult);
    const io = makeIo();
    const code = await runErrorsCommand(
      ["errors", "g", "--since", "2026-10-03T09:30:00Z"],
      io,
      makeDeps({ fetch })
    );
    expect(code).toBe(0);
    expect(fetch.mock.calls[0]![0].startTime.toISOString()).toBe("2026-10-03T09:30:00.000Z");
    expect(fetch.mock.calls[0]![0].endTime).toBe(NOW);
  });

  it("--time と --since の同時指定は exit 1", async () => {
    const io = makeIo();
    const code = await runErrorsCommand(
      ["errors", "g", "--time", "1h", "--since", "2026-10-03T09:30:00Z"],
      io,
      makeDeps({ fetch: vi.fn() })
    );
    expect(code).toBe(1);
    expect(io.err.join("")).toContain("--time");
  });

  it("不正な --since は exit 1 で Invalid datetime", async () => {
    const io = makeIo();
    const code = await runErrorsCommand(
      ["errors", "g", "--since", "10/19/2026"],
      io,
      makeDeps({ fetch: vi.fn() })
    );
    expect(code).toBe(1);
    expect(io.err.join("")).toContain("Invalid datetime");
  });

  it("--until のみ + 設定の defaults.time でもエラーにならず窓が計算される", async () => {
    const env = withConfig(JSON.stringify({ defaults: { time: "30m" } }));
    const fetch = vi.fn<(q: LogQuery) => Promise<FetchResult>>().mockResolvedValue(okResult);
    const io = makeIo();
    const code = await runErrorsCommand(
      ["errors", "g", "--until", "2026-10-02T15:00:00Z"],
      io,
      makeDeps({ fetch }, env)
    );
    expect(code).toBe(0);
    expect(fetch.mock.calls[0]![0].endTime.toISOString()).toBe("2026-10-02T15:00:00.000Z");
    expect(fetch.mock.calls[0]![0].startTime.toISOString()).toBe("2026-10-02T14:30:00.000Z");
  });
});

describe("runErrorsCommand: bucket (timeline)", () => {
  it("--bucket 5m で Timeline セクションを table 出力に含める", async () => {
    const fetch = vi.fn<(q: LogQuery) => Promise<FetchResult>>().mockResolvedValue(okResult);
    const io = makeIo();
    const code = await runErrorsCommand(["errors", "g", "--bucket", "5m"], io, makeDeps({ fetch }));
    expect(code).toBe(0);
    expect(io.out.join("")).toContain("Timeline");
  });

  it("--format json --bucket 5m は timeline を JSON に含める", async () => {
    const fetch = vi.fn<(q: LogQuery) => Promise<FetchResult>>().mockResolvedValue(okResult);
    const io = makeIo();
    const code = await runErrorsCommand(
      ["errors", "g", "--format", "json", "--bucket", "5m"],
      io,
      makeDeps({ fetch })
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(io.out.join(""));
    expect(parsed.timeline).toHaveLength(3); // 15m / 5m = 3 バケット
    expect(parsed.timeline.map((b: { count: number }) => b.count)).toEqual([0, 0, 2]); // 2 件とも 09:55/09:58
  });

  it("不正な --bucket は exit 1 で Invalid duration", async () => {
    const io = makeIo();
    const code = await runErrorsCommand(
      ["errors", "g", "--bucket", "bad"],
      io,
      makeDeps({ fetch: vi.fn() })
    );
    expect(code).toBe(1);
    expect(io.err.join("")).toContain("Invalid duration");
  });

  it("バケット数が上限を超える組み合わせは exit 1 でガイドを出す", async () => {
    const fetch = vi
      .fn<(q: LogQuery) => Promise<FetchResult>>()
      .mockResolvedValue({ events: [], truncated: false });
    const io = makeIo();
    const code = await runErrorsCommand(
      ["errors", "g", "--time", "2d", "--bucket", "1s"],
      io,
      makeDeps({ fetch })
    );
    expect(code).toBe(1);
    expect(io.err.join("")).toContain("バケット数が多すぎます");
  });
});

describe("runErrorsCommand: compare (diff)", () => {
  const prevResult: FetchResult = {
    events: [
      { timestamp: new Date("2026-10-03T09:35:00Z"), message: "timeout id=3333" },
      { timestamp: new Date("2026-10-03T09:40:00Z"), message: "oom id=aaaa-bbbb" },
    ],
    truncated: false,
  };

  it("--compare 1h は直前 1h 窓も fetch して比較セクションを出す", async () => {
    const fetch = vi
      .fn<(q: LogQuery) => Promise<FetchResult>>()
      .mockResolvedValueOnce(okResult)
      .mockResolvedValueOnce(prevResult);
    const io = makeIo();
    const code = await runErrorsCommand(
      ["errors", "g", "--compare", "1h"],
      io,
      makeDeps({ fetch })
    );
    expect(code).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(2);
    const prevQuery = fetch.mock.calls[1]![0];
    // 現在窓: 09:45〜10:00 / 比較窓: 08:45〜09:45 (直前に隣接・幅 1h)
    expect(prevQuery.startTime.toISOString()).toBe("2026-10-03T08:45:00.000Z");
    expect(prevQuery.endTime.toISOString()).toBe("2026-10-03T09:45:00.000Z");
    expect(io.out.join("")).toContain("Comparison");
  });

  it("--compare 未指定は fetch 1 回で Comparison を出さない", async () => {
    const fetch = vi.fn<(q: LogQuery) => Promise<FetchResult>>().mockResolvedValue(okResult);
    const io = makeIo();
    const code = await runErrorsCommand(["errors", "g"], io, makeDeps({ fetch }));
    expect(code).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(io.out.join("")).not.toContain("Comparison");
  });

  it("新規パターンは NEW として表示する", async () => {
    const fetch = vi
      .fn<(q: LogQuery) => Promise<FetchResult>>()
      .mockResolvedValueOnce(okResult) // timeout のみ
      .mockResolvedValueOnce({ events: [], truncated: false });
    const io = makeIo();
    const code = await runErrorsCommand(
      ["errors", "g", "--compare", "15m"],
      io,
      makeDeps({ fetch })
    );
    expect(code).toBe(0);
    expect(io.out.join("")).toContain("NEW");
    expect(io.out.join("")).toContain("timeout id=<num>");
  });

  it("--format json は comparison を含む", async () => {
    const fetch = vi
      .fn<(q: LogQuery) => Promise<FetchResult>>()
      .mockResolvedValueOnce(okResult)
      .mockResolvedValueOnce(prevResult);
    const io = makeIo();
    const code = await runErrorsCommand(
      ["errors", "g", "--format", "json", "--compare", "15m"],
      io,
      makeDeps({ fetch })
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(io.out.join(""));
    expect(parsed.comparison.totalEvents).toBe(2);
    expect(
      Object.fromEntries(
        parsed.comparison.groups.map((g: { pattern: string; status: string }) => [
          g.pattern,
          g.status,
        ])
      )
    ).toEqual({
      "timeout id=<num>": "increased", // 現在 2 件 vs 比較窓 1 件
      "oom id=aaaa-bbbb": "resolved", // 比較窓のみ
    });
  });

  it("不正な --compare は exit 1 で Invalid duration", async () => {
    const io = makeIo();
    const code = await runErrorsCommand(
      ["errors", "g", "--compare", "bad"],
      io,
      makeDeps({ fetch: vi.fn() })
    );
    expect(code).toBe(1);
    expect(io.err.join("")).toContain("Invalid duration");
  });
});

describe("runErrorsCommand: multi groups", () => {
  const listOk = (names: string[]) => {
    const fetch = vi.fn<(q: LogQuery) => Promise<FetchResult>>().mockResolvedValue(okResult);
    const provider: Partial<LogProvider> = {
      fetch,
      listGroupNames: vi.fn(async () => names),
    };
    return { fetch, provider };
  };

  it("カンマ区切り 2 グループは各グループを fetch し両方を出力する", async () => {
    const { fetch, provider } = listOk([]);
    const io = makeIo();
    const code = await runErrorsCommand(["errors", "/a,/b"], io, makeDeps(provider));
    expect(code).toBe(0);
    expect(fetch.mock.calls.map((c) => c[0].logGroup)).toEqual(["/a", "/b"]);
    expect(io.out.join("")).toContain("/a");
    expect(io.out.join("")).toContain("/b");
  });

  it("--format json で複数グループは配列になる", async () => {
    const io = makeIo();
    const code = await runErrorsCommand(
      ["errors", "/a,/b", "--format", "json"],
      io,
      makeDeps(listOk([]).provider)
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(io.out.join(""));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.map((r: { logGroup: string }) => r.logGroup)).toEqual(["/a", "/b"]);
  });

  it("末尾ワイルドカードは listGroupNames で展開する", async () => {
    const { fetch, provider } = listOk(["/aws/lambda/prod-api", "/aws/lambda/prod-api-worker"]);
    const io = makeIo();
    const code = await runErrorsCommand(["errors", "prod-api-*"], io, makeDeps(provider));
    expect(code).toBe(0);
    expect(provider.listGroupNames).toHaveBeenCalledWith("prod-api-");
    expect(fetch.mock.calls.map((c) => c[0].logGroup)).toEqual([
      "/aws/lambda/prod-api",
      "/aws/lambda/prod-api-worker",
    ]);
  });

  it("ワイルドカードが 0 件なら exit 1", async () => {
    const io = makeIo();
    const code = await runErrorsCommand(["errors", "nope-*"], io, makeDeps(listOk([]).provider));
    expect(code).toBe(1);
    expect(io.err.join("")).toContain("ロググループが見つかりません");
  });
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

describe("runErrorsCommand: ignore", () => {
  const ignoredResult: FetchResult = {
    events: [
      { timestamp: new Date("2026-10-03T09:55:00Z"), message: "timeout id=1111" },
      { timestamp: new Date("2026-10-03T09:56:00Z"), message: "NoSuchElementException" },
    ],
    truncated: false,
  };
  const envWithIgnore = (extra: Record<string, unknown> = {}) =>
    withConfig(JSON.stringify({ ignore: ["NoSuchElementException"], ...extra }));

  it("config ignore に一致するパターンはデフォルトで除外し ignored 件数を表示する", async () => {
    const fetch = vi.fn<(q: LogQuery) => Promise<FetchResult>>().mockResolvedValue(ignoredResult);
    const io = makeIo();
    const code = await runErrorsCommand(["errors", "g"], io, makeDeps({ fetch }, envWithIgnore()));
    expect(code).toBe(0);
    const out = io.out.join("");
    expect(out).toContain("timeout id=<num>");
    expect(out).not.toContain("NoSuchElementException");
    expect(out).toContain("ignored: 1");
  });

  it("--show-ignored で除外パターンも表示する", async () => {
    const fetch = vi.fn<(q: LogQuery) => Promise<FetchResult>>().mockResolvedValue(ignoredResult);
    const io = makeIo();
    const code = await runErrorsCommand(
      ["errors", "g", "--show-ignored"],
      io,
      makeDeps({ fetch }, envWithIgnore())
    );
    expect(code).toBe(0);
    expect(io.out.join("")).toContain("NoSuchElementException");
  });

  it("config ignore の正規表現が不正ならエラーで終了する", async () => {
    const fetch = vi.fn<(q: LogQuery) => Promise<FetchResult>>();
    const io = makeIo();
    const code = await runErrorsCommand(
      ["errors", "g"],
      io,
      makeDeps({ fetch }, withConfig(JSON.stringify({ ignore: ["/[unclosed/"] })))
    );
    expect(code).toBe(1);
    expect(io.err.join("")).toContain("ignore パターンの正規表現が不正です");
  });
});

describe("runErrorsCommand: --save", () => {
  const saveDeps = (
    provider: Partial<LogProvider>,
    env: NodeJS.ProcessEnv = { HOME: "/tmp" }
  ): { deps: Partial<RunDeps>; saved: { path: string; content: string }[] } => {
    const saved: { path: string; content: string }[] = [];
    return {
      saved,
      deps: {
        ...makeDeps(provider, env),
        writeFile: (path: string, content: string) => saved.push({ path, content }),
      },
    };
  };

  it("--save でメタ情報付きレポートをファイルに書き、stdout には通常出力する", async () => {
    const fetch = vi.fn<(q: LogQuery) => Promise<FetchResult>>().mockResolvedValue(okResult);
    const io = makeIo();
    const { deps, saved } = saveDeps({ fetch });
    const code = await runErrorsCommand(["errors", "g", "--save", "report.md"], io, deps);
    expect(code).toBe(0);
    expect(saved).toHaveLength(1);
    expect(saved[0]!.path).toBe("report.md");
    expect(saved[0]!.content).toContain("# Toil Buster Report");
    expect(saved[0]!.content).toContain("# Log Summary: g");
    expect(io.out.join("")).toContain("Log Group: g");
  });

  it("--save 単独指定でもレポートは Markdown で書かれる", async () => {
    const fetch = vi.fn<(q: LogQuery) => Promise<FetchResult>>().mockResolvedValue(okResult);
    const io = makeIo();
    const { deps, saved } = saveDeps({ fetch });
    const code = await runErrorsCommand(
      ["errors", "g", "--format", "json", "--save", "report.md"],
      io,
      deps
    );
    expect(code).toBe(0);
    expect(saved[0]!.content).toContain("# Toil Buster Report");
    expect(io.out.join("")).toContain("[");
  });

  it("保存先ディレクトリがなければエラーで終了する", async () => {
    const fetch = vi.fn<(q: LogQuery) => Promise<FetchResult>>().mockResolvedValue(okResult);
    const io = makeIo();
    const { deps } = saveDeps({ fetch });
    const code = await runErrorsCommand(
      ["errors", "g", "--save", "/nonexistent-tb-dir/report.md"],
      io,
      {
        ...deps,
        writeFile: () => {
          throw new Error("ENOENT");
        },
      }
    );
    expect(code).toBe(1);
    expect(io.err.join("")).toContain("レポートの保存に失敗しました");
  });
});

describe("runErrorsCommand: --live", () => {
  const makeLiveDeps = (provider: Partial<LogProvider>, count: string[]): Partial<RunDeps> => ({
    ...makeDeps(provider),
    sleep: async (ms: number) => {
      void ms;
    },
    clearScreen: () => {
      count.push("clear");
    },
  });

  it("--live 30s --count 2 は 2 回描画して exit 0", async () => {
    const fetch = vi.fn<(q: LogQuery) => Promise<FetchResult>>().mockResolvedValue(okResult);
    const io = makeIo();
    const cleared: string[] = [];
    const code = await runErrorsCommand(
      ["errors", "g", "--live", "30s", "--count", "2"],
      io,
      makeLiveDeps({ fetch }, cleared)
    );
    expect(code).toBe(0);
    expect(cleared).toHaveLength(2);
    // 監視中であることが分かるヘッダ
    expect(io.out.join("")).toContain("監視中");
    expect(io.out.join("")).toContain("Ctrl+C で終了");
  });

  it("--live の間隔は fetch の時間窓に影響しない (常に --time 窓を再取得)", async () => {
    const fetch = vi.fn<(q: LogQuery) => Promise<FetchResult>>().mockResolvedValue(okResult);
    const io = makeIo();
    const cleared: string[] = [];
    await runErrorsCommand(
      ["errors", "g", "--live", "30s", "--count", "2"],
      io,
      makeLiveDeps({ fetch }, cleared)
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    const calls = fetch.mock.calls.map((c) => c[0]);
    expect(calls[1]!.startTime.getTime()).toBe(calls[0]!.startTime.getTime());
  });

  it("--live に不正な間隔はエラーで終了する", async () => {
    const io = makeIo();
    const cleared: string[] = [];
    const code = await runErrorsCommand(
      ["errors", "g", "--live", "bad"],
      io,
      makeLiveDeps({ fetch: vi.fn() }, cleared)
    );
    expect(code).toBe(1);
    expect(io.err.join("")).toContain("Invalid duration");
  });
});

describe("runErrorsCommand: --fail-over", () => {
  const eventsOf = (n: number): FetchResult => ({
    events: Array.from({ length: n }, (_, i) => ({
      timestamp: new Date("2026-10-03T09:55:00Z"),
      message: `error ${i}`,
    })),
    truncated: false,
  });

  it("totalEvents が閾値以下なら exit 0", async () => {
    const fetch = vi.fn<(q: LogQuery) => Promise<FetchResult>>().mockResolvedValue(eventsOf(5));
    const io = makeIo();
    const code = await runErrorsCommand(
      ["errors", "g", "--fail-over", "10"],
      io,
      makeDeps({ fetch })
    );
    expect(code).toBe(0);
  });

  it("totalEvents が閾値を超えたら exit 2 で stderr に件数を出す", async () => {
    const fetch = vi.fn<(q: LogQuery) => Promise<FetchResult>>().mockResolvedValue(eventsOf(15));
    const io = makeIo();
    const code = await runErrorsCommand(
      ["errors", "g", "--fail-over", "10"],
      io,
      makeDeps({ fetch })
    );
    expect(code).toBe(2);
    expect(io.err.join("")).toContain("閾値 (10) を超えました");
    expect(io.err.join("")).toContain("15");
  });

  it("複数グループのどれかが超過なら exit 2", async () => {
    const fetch = vi
      .fn<(q: LogQuery) => Promise<FetchResult>>()
      .mockResolvedValueOnce(eventsOf(3))
      .mockResolvedValueOnce(eventsOf(20));
    const io = makeIo();
    const code = await runErrorsCommand(
      ["errors", "a,b", "--fail-over", "10"],
      io,
      makeDeps({ fetch })
    );
    expect(code).toBe(2);
  });

  it("--live 併用時は超過 tick で即中断して exit 2", async () => {
    const fetch = vi.fn<(q: LogQuery) => Promise<FetchResult>>().mockResolvedValue(eventsOf(15));
    const io = makeIo();
    const cleared: string[] = [];
    const code = await runErrorsCommand(["errors", "g", "--live", "30s", "--fail-over", "10"], io, {
      ...makeDeps({ fetch }),
      sleep: async () => {
        throw new Error("should not sleep after threshold breach");
      },
      clearScreen: () => cleared.push("clear"),
    });
    expect(code).toBe(2);
    expect(cleared).toHaveLength(1); // 2 回目の tick の前に中断
  });

  it("閾値が 0 以下はエラーで終了する", async () => {
    const io = makeIo();
    const code = await runErrorsCommand(
      ["errors", "g", "--fail-over", "0"],
      io,
      makeDeps({ fetch: vi.fn() })
    );
    expect(code).toBe(1);
    expect(io.err.join("")).toContain("正の整数");
  });
});

describe("runErrorsCommand: --provider", () => {
  it("CLI オプション (--provider datadog) が providerFactory へ渡る", async () => {
    const fetch = vi.fn<(q: LogQuery) => Promise<FetchResult>>().mockResolvedValue(okResult);
    const providerFactory = vi
      .fn<(opts: { provider?: string; region?: string; profile?: string }) => LogProvider>()
      .mockReturnValue({ fetch, listGroupNames: vi.fn() } as unknown as LogProvider);
    const io = makeIo();
    const code = await runErrorsCommand(["errors", "g", "--provider", "datadog"], io, {
      providerFactory,
      env: { HOME: "/tmp" },
      now: () => NOW,
    });
    expect(code).toBe(0);
    expect(providerFactory.mock.calls[0]![0].provider).toBe("datadog");
  });

  it("config defaults.provider が既定になり、CLI オプションで上書きされる", async () => {
    const fetch = vi.fn<(q: LogQuery) => Promise<FetchResult>>().mockResolvedValue(okResult);
    const providerFactory = vi
      .fn<(opts: { provider?: string }) => LogProvider>()
      .mockReturnValue({ fetch, listGroupNames: vi.fn() } as unknown as LogProvider);
    const env = withConfig(
      JSON.stringify({
        aliases: {},
        ignore: [],
        defaults: { provider: "datadog" },
      })
    );
    const io = makeIo();
    await runErrorsCommand(["errors", "g"], io, { providerFactory, env, now: () => NOW });
    expect(providerFactory.mock.calls[0]![0].provider).toBe("datadog");
  });
});
