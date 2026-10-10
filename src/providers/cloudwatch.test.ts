import { describe, expect, it, vi } from "vitest";
import {
  FilterLogEventsCommand,
  type FilterLogEventsCommandOutput,
} from "@aws-sdk/client-cloudwatch-logs";
import { CloudWatchProvider } from "./cloudwatch.js";
import type { LogQuery } from "./types.js";

type Send = (command: FilterLogEventsCommand) => Promise<FilterLogEventsCommandOutput>;

const query = (limit: number): LogQuery => ({
  logGroup: "/g",
  startTime: new Date("2026-10-03T09:00:00Z"),
  endTime: new Date("2026-10-03T09:15:00Z"),
  filterPattern: "?ERROR",
  limit,
});

const page = (messages: string[], nextToken?: string): FilterLogEventsCommandOutput => ({
  $metadata: {},
  events: messages.map((m, i) => ({
    messageId: `${i}`,
    timestamp: Date.parse("2026-10-03T09:01:00Z"),
    message: m,
  })),
  nextToken,
});

describe("CloudWatchProvider", () => {
  it("1 ページを LogEvent に変換して返す", async () => {
    const send = vi.fn<Send>().mockResolvedValue(page(["error one", "error two"]));
    const provider = new CloudWatchProvider(send, { retryDelayMs: 0 });
    const result = await provider.fetch(query(100));
    expect(result.events.map((e) => e.message)).toEqual(["error one", "error two"]);
    expect(result.events[0]!.timestamp).toEqual(new Date("2026-10-03T09:01:00Z"));
    expect(result.truncated).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0].input).toMatchObject({
      logGroupName: "/g",
      filterPattern: "?ERROR",
      startTime: Date.parse("2026-10-03T09:00:00Z"),
    });
  });

  it("nextToken がある限りページングする", async () => {
    const send = vi
      .fn<Send>()
      .mockResolvedValueOnce(page(["a"], "token-1"))
      .mockResolvedValueOnce(page(["b"], undefined));
    const provider = new CloudWatchProvider(send, { retryDelayMs: 0 });
    const result = await provider.fetch(query(100));
    expect(result.events.map((e) => e.message)).toEqual(["a", "b"]);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]![0].input.nextToken).toBe("token-1");
  });

  it("limit 到達で打ち切り truncated=true", async () => {
    const send = vi.fn<Send>().mockResolvedValue(page(["a", "b", "c"], "token-1"));
    const provider = new CloudWatchProvider(send, { retryDelayMs: 0 });
    const result = await provider.fetch(query(2));
    expect(result.events).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it("ThrottlingException は指数バックオフで再試行する", async () => {
    const throttled = Object.assign(new Error("throttled"), { name: "ThrottlingException" });
    const send = vi
      .fn<Send>()
      .mockRejectedValueOnce(throttled)
      .mockResolvedValueOnce(page(["ok"]));
    const provider = new CloudWatchProvider(send, { retryDelayMs: 1 });
    const result = await provider.fetch(query(100));
    expect(result.events.map((e) => e.message)).toEqual(["ok"]);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("再試行上限を超えた ThrottlingException は伝播する", async () => {
    const throttled = Object.assign(new Error("throttled"), { name: "ThrottlingException" });
    const send = vi.fn<Send>().mockRejectedValue(throttled);
    const provider = new CloudWatchProvider(send, { retryDelayMs: 0, maxRetries: 2 });
    await expect(provider.fetch(query(100))).rejects.toThrow(/throttled/);
    expect(send).toHaveBeenCalledTimes(3); // 初回 + 再試行2回
  });

  it("ThrottlingException 以外は即座に伝播する", async () => {
    const notFound = Object.assign(new Error("missing"), { name: "ResourceNotFoundException" });
    const send = vi.fn<Send>().mockRejectedValue(notFound);
    const provider = new CloudWatchProvider(send, { retryDelayMs: 0 });
    await expect(provider.fetch(query(100))).rejects.toThrow(/missing/);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
