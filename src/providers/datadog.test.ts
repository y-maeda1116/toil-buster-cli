import { describe, expect, it, vi } from "vitest";
import { DatadogProvider } from "./datadog.js";

type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string }
) => Promise<Response>;

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const CONFIG = { site: "us5.datadoghq.com", apiKey: "dd-api", appKey: "dd-app" };

describe("DatadogProvider", () => {
  it("fetch は Logs Search API に service フィルタと時間窓で問い合わせ、イベントへ変換する", async () => {
    const http = vi.fn<FetchLike>().mockResolvedValue(
      jsonResponse({
        data: [
          { attributes: { timestamp: "2026-10-03T09:58:00Z", message: "TimeoutError: api" } },
          { attributes: { timestamp: "2026-10-03T09:59:00+09:00", message: "OOM killed" } },
        ],
      })
    );
    const provider = new DatadogProvider(http, CONFIG);
    const result = await provider.fetch({
      logGroup: "prod-api",
      startTime: new Date("2026-10-03T09:00:00Z"),
      endTime: new Date("2026-10-03T10:00:00Z"),
      filterPattern: "ERROR",
      limit: 1000,
    });
    expect(result.events).toEqual([
      { timestamp: new Date("2026-10-03T09:58:00Z"), message: "TimeoutError: api" },
      { timestamp: new Date("2026-10-03T09:59:00+09:00"), message: "OOM killed" },
    ]);
    expect(result.truncated).toBe(false);
    const [url, init] = http.mock.calls[0]!;
    expect(url).toBe("https://us5.datadoghq.com/api/v2/logs/events/search");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "DD-API-KEY": "dd-api",
      "DD-APPLICATION-KEY": "dd-app",
      "content-type": "application/json",
    });
    const body = JSON.parse(init.body);
    expect(body.filter.query).toContain("service:prod-api");
    expect(body.filter.from).toBe("2026-10-03T09:00:00.000Z");
    expect(body.filter.to).toBe("2026-10-03T10:00:00.000Z");
    expect(body.page.limit).toBe(1000);
    expect(body.sort).toBe("timestamp");
  });

  it("filterPattern が空なら service 指定のみのクエリになる", async () => {
    const http = vi.fn<FetchLike>().mockResolvedValue(jsonResponse({ data: [] }));
    const provider = new DatadogProvider(http, CONFIG);
    await provider.fetch({
      logGroup: "prod-api",
      startTime: new Date("2026-10-03T09:00:00Z"),
      endTime: new Date("2026-10-03T10:00:00Z"),
      filterPattern: "",
      limit: 100,
    });
    const body = JSON.parse(http.mock.calls[0]![1].body);
    expect(body.filter.query).toBe("service:prod-api");
  });

  it("nextLogId カーソルが続く限りページングし、limit 到達で打ち切って truncated を返す", async () => {
    const http = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            { attributes: { timestamp: "2026-10-03T09:58:00Z", message: "a" } },
            { attributes: { timestamp: "2026-10-03T09:58:30Z", message: "b" } },
          ],
          meta: { page: { nextLogId: "cursor-1" } },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ attributes: { timestamp: "2026-10-03T09:59:00Z", message: "c" } }],
          meta: { page: { nextLogId: "cursor-2" } },
        })
      );
    const provider = new DatadogProvider(http, CONFIG);
    const result = await provider.fetch({
      logGroup: "g",
      startTime: new Date("2026-10-03T09:00:00Z"),
      endTime: new Date("2026-10-03T10:00:00Z"),
      filterPattern: "",
      limit: 3,
    });
    expect(result.events.map((e) => e.message)).toEqual(["a", "b", "c"]);
    expect(result.truncated).toBe(true);
    expect(http).toHaveBeenCalledTimes(2);
    // 2 ページ目は nextLogId カーソルを引き継ぐ
    expect(JSON.parse(http.mock.calls[1]![1].body).page.cursor).toBe("cursor-1");
  });

  it("limit 未満でカーソルが尽きたら truncated false", async () => {
    const http = vi.fn<FetchLike>().mockResolvedValue(
      jsonResponse({
        data: [{ attributes: { timestamp: "2026-10-03T09:58:00Z", message: "a" } }],
        meta: { page: {} },
      })
    );
    const provider = new DatadogProvider(http, CONFIG);
    const result = await provider.fetch({
      logGroup: "g",
      startTime: new Date("2026-10-03T09:00:00Z"),
      endTime: new Date("2026-10-03T10:00:00Z"),
      filterPattern: "",
      limit: 100,
    });
    expect(result.truncated).toBe(false);
    expect(http).toHaveBeenCalledTimes(1);
  });

  it("API エラー (非 2xx) はステータスを含むエラーにする", async () => {
    const http = vi
      .fn<FetchLike>()
      .mockResolvedValue(
        new Response(JSON.stringify({ errors: [{ detail: "Forbidden" }] }), { status: 403 })
      );
    const provider = new DatadogProvider(http, CONFIG);
    await expect(
      provider.fetch({
        logGroup: "g",
        startTime: new Date("2026-10-03T09:00:00Z"),
        endTime: new Date("2026-10-03T10:00:00Z"),
        filterPattern: "",
        limit: 100,
      })
    ).rejects.toThrow("Datadog API エラー (403)");
  });

  it("API キーが未設定ならエラーにする", () => {
    expect(
      () =>
        new DatadogProvider(vi.fn<FetchLike>(), {
          site: "us5.datadoghq.com",
          apiKey: "",
          appKey: "dd-app",
        })
    ).toThrow("DD_API_KEY");
    expect(
      () =>
        new DatadogProvider(vi.fn<FetchLike>(), {
          site: "us5.datadoghq.com",
          apiKey: "dd-api",
          appKey: "",
        })
    ).toThrow("DD_APP_KEY");
  });

  it("listGroupNames は aggregate API の service グルーピングで一覧を返す", async () => {
    const http = vi.fn<FetchLike>().mockResolvedValue(
      jsonResponse({
        groups: [
          { by: { service: "prod-api" }, from: {}, sums: {} },
          { by: { service: "prod-batch" }, from: {}, sums: {} },
        ],
      })
    );
    const provider = new DatadogProvider(http, CONFIG);
    const names = await provider.listGroupNames("prod");
    expect(names).toEqual(["prod-api", "prod-batch"]);
    const [url, init] = http.mock.calls[0]!;
    expect(url).toBe("https://us5.datadoghq.com/api/v2/logs/analytics/aggregate");
    const body = JSON.parse(init.body);
    expect(body.filter.query).toContain("service:prod*");
    expect(body.group_by[0].facet).toBe("service");
  });
});
