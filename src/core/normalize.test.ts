import { describe, expect, it } from "vitest";
import { normalizeMessage } from "./normalize.js";

describe("normalizeMessage", () => {
  it("UUID を <uuid> にマスクする", () => {
    expect(normalizeMessage("Request 550e8400-e29b-41d4-a716-446655440000 failed")).toBe(
      "Request <uuid> failed"
    );
  });

  it("ISO8601 タイムスタンプを <ts> にマスクする（Z と +09:00 両方）", () => {
    expect(normalizeMessage("at 2026-10-03T01:23:45.678Z timeout")).toBe("at <ts> timeout");
    expect(normalizeMessage("at 2026-10-03T01:23:45+09:00 timeout")).toBe("at <ts> timeout");
  });

  it("IPv4 を <ip> にマスクする", () => {
    expect(normalizeMessage("connect 192.168.10.5 refused")).toBe("connect <ip> refused");
  });

  it("IPv6 形式も <ip> にマスクする", () => {
    expect(normalizeMessage("from 2001:db8::1 blocked")).toBe("from <ip> blocked");
  });

  it("0x prefix の hex と 8 文字以上の hex 列を <hex> にマスクする", () => {
    expect(normalizeMessage("digest 0xdeadbeef ok")).toBe("digest <hex> ok");
    expect(normalizeMessage("hash a1b2c3d4e5f6a7b8 done")).toBe("hash <hex> done");
  });

  it("純粋な数字列 (hex 文字を含まない) は <hex> にならず <num> になる", () => {
    expect(normalizeMessage("id 123456789 end")).toBe("id <num> end");
  });

  it("4 桁以上の数値は <num>、3 桁以下は保持する", () => {
    expect(normalizeMessage("port 8080 took 12345ms status=500 retries=3")).toBe(
      "port <num> took <num>ms status=500 retries=3"
    );
  });

  it("UUID は hex ルールより優先される", () => {
    expect(normalizeMessage("id=550e8400-e29b-41d4-a716-446655440000")).toBe("id=<uuid>");
  });

  it("複数種類が混在してもすべてマスクされる", () => {
    const input =
      "user 550e8400-e29b-41d4-a716-446655440000 from 10.0.0.1 count 12345 digest 0xcafebabe at 2026-01-02T03:04:05Z";
    expect(normalizeMessage(input)).toBe("user <uuid> from <ip> count <num> digest <hex> at <ts>");
  });

  it("マスク対象がなければ元の文字列を返す", () => {
    expect(normalizeMessage("plain error message")).toBe("plain error message");
  });
});
