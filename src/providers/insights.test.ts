import { describe, expect, it, vi } from "vitest";
import { InsightsProvider } from "./insights.js";

type Send = (command: { readonly input: unknown }) => Promise<unknown>;

describe("InsightsProvider", () => {
  it("startQuery は logGroupNames / queryString / 時間窓 / limit で StartQuery し queryId を返す", async () => {
    const send = vi.fn<Send>().mockResolvedValue({ queryId: "q-1" });
    const provider = new InsightsProvider(send);
    const start = new Date("2026-10-03T09:00:00Z");
    const end = new Date("2026-10-03T10:00:00Z");
    const id = await provider.startQuery({
      logGroups: ["/a", "/b"],
      start,
      end,
      queryString: "stats count()",
      limit: 1000,
    });
    expect(id).toBe("q-1");
    expect(send.mock.calls[0]![0].input).toMatchObject({
      logGroupNames: ["/a", "/b"],
      queryString: "stats count()",
      startTime: start.getTime(),
      endTime: end.getTime(),
      limit: 1000,
    });
  });

  it("status は StartQuery の status 値をそのまま返す", async () => {
    const send = vi.fn<Send>().mockResolvedValue({ status: "Running" });
    const provider = new InsightsProvider(send);
    expect(await provider.status("q-1")).toBe("Running");
    expect(send.mock.calls[0]![0].input).toMatchObject({ queryId: "q-1" });
  });

  it("results は GetQueryResults の field/value を行オブジェクトに縮約する", async () => {
    const send = vi.fn<Send>().mockResolvedValue({
      results: [
        [
          { field: "bucket", value: "2026-10-03 09:00" },
          { field: "count", value: "12" },
        ],
        [
          { field: "bucket", value: "2026-10-03 09:01" },
          { field: "count", value: "3" },
        ],
      ],
    });
    const provider = new InsightsProvider(send);
    const rows = await provider.results("q-1");
    expect(rows).toEqual([
      { bucket: "2026-10-03 09:00", count: "12" },
      { bucket: "2026-10-03 09:01", count: "3" },
    ]);
  });
});
