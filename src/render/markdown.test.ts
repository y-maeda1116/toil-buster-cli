import { describe, expect, it } from "vitest";
import type { SummaryResult } from "../core/aggregate.js";
import { renderMarkdown } from "./markdown.js";

const base: SummaryResult = {
  logGroup: "/g",
  timeWindow: { start: new Date("2026-10-03T09:00:00Z"), end: new Date("2026-10-03T09:15:00Z") },
  totalEvents: 1,
  truncated: false,
  groups: [
    {
      pattern: "pipe | inside",
      count: 1,
      firstSeen: new Date("2026-10-03T09:01:00Z"),
      lastSeen: new Date("2026-10-03T09:05:00Z"),
      sample: "pipe | inside",
    },
  ],
};

describe("renderMarkdown", () => {
  it("md テーブル行を含み、パターン内の | はエスケープされる", () => {
    const out = renderMarkdown(base, 20);
    expect(out).toContain("| # |");
    expect(out).toContain("pipe \\| inside");
    expect(out).not.toContain("pipe | inside");
  });

  it("複数行 pattern は 1 行にフラット化されテーブル行を壊さない", () => {
    const out = renderMarkdown(
      {
        ...base,
        groups: [
          {
            pattern: "TypeError\n  at foo (/app/a.ts:1:1)\n  at bar (/app/b.ts:2:2)",
            count: 1,
            firstSeen: base.groups[0]!.firstSeen,
            lastSeen: base.groups[0]!.lastSeen,
            sample: "TypeError\n  at foo",
          },
        ],
      },
      20
    );
    const lines = out.split("\n");
    const headerIdx = lines.findIndex((l) => l.startsWith("| # |"));
    expect(headerIdx).toBeGreaterThanOrEqual(0);
    // ヘッダー + 区切り + データ行 1 行のみ (改行が行を増やさない)
    expect(lines[headerIdx + 2]).toContain("TypeError at foo (/app/a.ts:1:1) at bar");
    expect(lines[headerIdx + 3]).toBe("");
    expect(out).not.toContain("\n  at ");
  });

  it("長大 pattern は 80 文字 + … に丸められる", () => {
    const long = "x".repeat(120);
    const out = renderMarkdown(
      {
        ...base,
        groups: [
          {
            pattern: long,
            count: 1,
            firstSeen: base.groups[0]!.firstSeen,
            lastSeen: base.groups[0]!.lastSeen,
            sample: long,
          },
        ],
      },
      20
    );
    expect(out).toContain(`${"x".repeat(80)}…`);
    expect(out).not.toContain(`${"x".repeat(81)}`);
  });

  it("0 件はメッセージのみでテーブル行を持たない", () => {
    const out = renderMarkdown({ ...base, groups: [], totalEvents: 0 }, 20);
    expect(out).toContain("該当時間帯にエラーは見つかりませんでした");
    expect(out).not.toContain("| # |");
  });
});
