import { describe, expect, it, vi } from "vitest";
import { LiveInterrupted, liveLoop } from "./watch.js";

describe("liveLoop", () => {
  it("count 指定時は tick を count 回実行して終了する", async () => {
    const tick = vi.fn(async () => {});
    const sleep = vi.fn(async () => {});
    const clearScreen = vi.fn();
    await liveLoop({ intervalMs: 30_000, count: 3 }, tick, { sleep, clearScreen });
    expect(tick).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2); // 最終 tick の後は待たない
    expect(clearScreen).toHaveBeenCalledTimes(3);
  });

  it("count 未指定時は tick が中断を投げるまで繰り返す", async () => {
    const tick = vi
      .fn<() => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new LiveInterrupted());
    const sleep = vi.fn(async () => {});
    const clearScreen = vi.fn();
    await liveLoop({ intervalMs: 30_000 }, tick, { sleep, clearScreen });
    expect(tick).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("tick 毎に画面をクリアする", async () => {
    const tick = vi.fn(async () => {});
    const sleep = vi.fn(async () => {});
    const clearScreen = vi.fn();
    await liveLoop({ intervalMs: 1_000, count: 2 }, tick, { sleep, clearScreen });
    // 1 回目の tick の前にもクリアする
    expect(clearScreen.mock.invocationCallOrder[0]).toBeLessThan(tick.mock.invocationCallOrder[0]);
  });
});
