import { describe, expect, it, vi } from "vitest";
import { runInsightsCommand } from "./insights-command.js";
import type { CliIo, RunDeps } from "./errors-command.js";
import type { LogProvider } from "../providers/types.js";

const makeIo = (): CliIo & { out: string[]; err: string[] } => {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, stdout: (t) => out.push(t), stderr: (t) => err.push(t) };
};

const NOW = new Date("2026-10-03T10:00:00Z");

const makeDeps = (client: unknown): Partial<RunDeps> => ({
  providerFactory: () => ({ fetch: vi.fn(), listGroupNames: vi.fn() }) as LogProvider,
  insightsFactory: () => client as never,
  env: { HOME: "/tmp" },
  now: () => NOW,
  sleep: vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined),
});

describe("runInsightsCommand", () => {
  it("既定クエリ (level の filter + bin 集計) で StartQuery し、結果をテーブル表示する", async () => {
    const startQuery = vi.fn().mockResolvedValue("q-1");
    const status = vi.fn().mockResolvedValue("Complete");
    const results = vi.fn().mockResolvedValue([
      { bucket: "2026-10-03 09:58", count: "12" },
      { bucket: "2026-10-03 09:59", count: "3" },
    ]);
    const io = makeIo();
    const deps = makeDeps({ startQuery, status, results });
    const code = await runInsightsCommand(["insights", "g"], io, deps);
    expect(code).toBe(0);
    expect(startQuery.mock.calls[0]![0]).toMatchObject({
      logGroups: ["g"],
      queryString: expect.stringContaining("stats count()"),
      limit: 1000,
    });
    expect(startQuery.mock.calls[0]![0].queryString).toContain("ERROR");
    const out = io.out.join("");
    expect(out).toContain("2026-10-03 09:58");
    expect(out).toContain("12");
    expect(status).toHaveBeenCalledWith("q-1");
    expect(results).toHaveBeenCalledWith("q-1");
  });

  it("--query で既定クエリを上書きする", async () => {
    const startQuery = vi.fn().mockResolvedValue("q-1");
    const client = {
      startQuery,
      status: vi.fn().mockResolvedValue("Complete"),
      results: vi.fn().mockResolvedValue([{ errors: "7" }]),
    };
    const io = makeIo();
    await runInsightsCommand(
      ["insights", "g", "--query", "stats count() as errors"],
      io,
      makeDeps(client)
    );
    expect(startQuery.mock.calls[0]![0].queryString).toBe("stats count() as errors");
  });

  it("status が Running の間は sleep して再ポーリングし、Complete で結果を表示する", async () => {
    const status = vi
      .fn<(id: string) => Promise<string>>()
      .mockResolvedValueOnce("Running")
      .mockResolvedValueOnce("Running")
      .mockResolvedValue("Complete");
    const client = {
      startQuery: vi.fn().mockResolvedValue("q-1"),
      status,
      results: vi.fn().mockResolvedValue([{ bucket: "b", count: "1" }]),
    };
    const io = makeIo();
    const deps = makeDeps(client);
    await runInsightsCommand(["insights", "g"], io, deps);
    expect(status).toHaveBeenCalledTimes(3);
    expect(deps.sleep).toHaveBeenCalled();
    expect(io.out.join("")).toContain("b");
  });

  it("status が Failed ならエラーメッセージを出して exit 1", async () => {
    const client = {
      startQuery: vi.fn().mockResolvedValue("q-1"),
      status: vi.fn().mockResolvedValue("Failed"),
      results: vi.fn(),
    };
    const io = makeIo();
    const code = await runInsightsCommand(["insights", "g"], io, makeDeps(client));
    expect(code).toBe(1);
    expect(io.err.join("")).toContain("Insights クエリが失敗しました");
    expect(client.results).not.toHaveBeenCalled();
  });

  it("timeout を超えても Complete にならなければエラーで exit 1", async () => {
    const client = {
      startQuery: vi.fn().mockResolvedValue("q-1"),
      status: vi.fn().mockResolvedValue("Running"),
      results: vi.fn(),
    };
    const io = makeIo();
    const code = await runInsightsCommand(
      ["insights", "g", "--timeout", "1s"],
      io,
      makeDeps(client)
    );
    expect(code).toBe(1);
    expect(io.err.join("")).toContain("タイムアウト");
  });

  it("--format json で結果を JSON 配列で出力する", async () => {
    const client = {
      startQuery: vi.fn().mockResolvedValue("q-1"),
      status: vi.fn().mockResolvedValue("Complete"),
      results: vi.fn().mockResolvedValue([{ bucket: "b", count: "5" }]),
    };
    const io = makeIo();
    const code = await runInsightsCommand(
      ["insights", "g", "--format", "json"],
      io,
      makeDeps(client)
    );
    expect(code).toBe(0);
    expect(JSON.parse(io.out.join(""))).toEqual([{ bucket: "b", count: "5" }]);
  });
});
