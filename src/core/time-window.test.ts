import { describe, expect, it } from "vitest";
import { resolveTimeWindow } from "./time-window.js";

const NOW = new Date("2026-10-03T10:00:00Z");

describe("resolveTimeWindow", () => {
  it("since/until 両指定はそのままの時間窓になる", () => {
    const w = resolveTimeWindow(
      { time: "15m", since: "2026-10-01T09:00:00Z", until: "2026-10-01T10:30:00Z" },
      NOW
    );
    expect(w.start.toISOString()).toBe("2026-10-01T09:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-10-01T10:30:00.000Z");
  });

  it("since のみ指定は end が now になる", () => {
    const w = resolveTimeWindow({ time: "15m", since: "2026-10-03T09:30:00Z" }, NOW);
    expect(w.start.toISOString()).toBe("2026-10-03T09:30:00.000Z");
    expect(w.end).toBe(NOW);
  });

  it("until のみ指定は start が until - time 窓になる", () => {
    const w = resolveTimeWindow({ time: "1h", until: "2026-10-02T15:00:00Z" }, NOW);
    expect(w.end.toISOString()).toBe("2026-10-02T15:00:00.000Z");
    expect(w.start.toISOString()).toBe("2026-10-02T14:00:00.000Z");
  });

  it("どちらも指定しなければ従来どおり now - time が start になる", () => {
    const w = resolveTimeWindow({ time: "15m" }, NOW);
    expect(w.start.getTime()).toBe(NOW.getTime() - 900_000);
    expect(w.end).toBe(NOW);
  });

  it("タイムゾーンオフセット付きも解釈する", () => {
    const w = resolveTimeWindow(
      { time: "15m", since: "2026-10-01T18:00:00+09:00", until: "2026-10-01T19:30:00+09:00" },
      NOW
    );
    expect(w.start.toISOString()).toBe("2026-10-01T09:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-10-01T10:30:00.000Z");
  });

  it("不正な since は ISO8601 例つきのエラーになる", () => {
    expect(() => resolveTimeWindow({ time: "15m", since: "10/19/2026" }, NOW)).toThrow(
      /Invalid datetime.*ISO 8601/
    );
  });

  it("空文字の until もエラーになる", () => {
    expect(() => resolveTimeWindow({ time: "15m", until: "" }, NOW)).toThrow(/Invalid datetime/);
  });

  it("存在しない日時 (月 13 日 99 時) はエラーになる", () => {
    expect(() => resolveTimeWindow({ time: "15m", since: "2026-13-99T99:00" }, NOW)).toThrow(
      /Invalid datetime/
    );
  });

  it("日付プレフィックスに続く不正な文字列もエラーになる", () => {
    expect(() => resolveTimeWindow({ time: "15m", since: "2026-10-18XYZ" }, NOW)).toThrow(
      /Invalid datetime/
    );
  });

  it("since >= until はエラーになる", () => {
    expect(() =>
      resolveTimeWindow(
        { time: "15m", since: "2026-10-01T10:00:00Z", until: "2026-10-01T10:00:00Z" },
        NOW
      )
    ).toThrow(/--since.*--until/);
  });

  it("until のみ + 不正な time は parseDuration のエラーが伝播する", () => {
    expect(() => resolveTimeWindow({ time: "bad", until: "2026-10-02T15:00:00Z" }, NOW)).toThrow(
      /Invalid duration/
    );
  });
});
