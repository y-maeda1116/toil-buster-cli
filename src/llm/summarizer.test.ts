import { describe, expect, it, vi } from "vitest";
import { AnthropicSummarizer } from "./summarizer.js";

type HttpLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string }
) => Promise<Response>;

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const CONFIG = { apiKey: "sk-ant-test", model: "claude-sonnet-5-5" };

const SNAPSHOT = [
  {
    logGroup: "prod-api",
    timeWindow: { start: "2026-10-03T09:00:00.000Z", end: "2026-10-03T10:00:00.000Z" },
    totalEvents: 2,
    truncated: false,
    groups: [{ pattern: "timeout id=<N>", count: 2 }],
  },
];

describe("AnthropicSummarizer", () => {
  it("集計スナップショットを Messages API に渡し、テキストを返す", async () => {
    const http = vi.fn<HttpLike>().mockResolvedValue(
      jsonResponse({
        content: [{ type: "text", text: "上位パターンは timeout で、1時間に2件発生しています。" }],
      })
    );
    const summarizer = new AnthropicSummarizer(http, CONFIG);
    const text = await summarizer.summarize(SNAPSHOT);
    expect(text).toBe("上位パターンは timeout で、1時間に2件発生しています。");
    const [url, init] = http.mock.calls[0]!;
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "x-api-key": "sk-ant-test",
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    });
    const body = JSON.parse(init.body) as {
      model: string;
      max_tokens: number;
      system: string;
      messages: { role: string; content: string }[];
    };
    expect(body.model).toBe("claude-sonnet-5-5");
    expect(body.max_tokens).toBeGreaterThan(0);
    expect(body.system).toContain("SRE");
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]!.role).toBe("user");
    // 集計スナップショットが JSON として user メッセージに含まれる
    expect(body.messages[0]!.content).toContain('"pattern":"timeout id=<N>"');
  });

  it("非 2xx はステータスを含むエラーにする", async () => {
    const http = vi
      .fn<HttpLike>()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: { message: "invalid api key" } }), { status: 401 })
      );
    const summarizer = new AnthropicSummarizer(http, CONFIG);
    await expect(summarizer.summarize(SNAPSHOT)).rejects.toThrow("LLM API エラー (401)");
  });

  it("API キーが未設定ならエラーにする", () => {
    expect(
      () =>
        new AnthropicSummarizer(vi.fn<HttpLike>(), {
          apiKey: "",
          model: "claude-sonnet-5-5",
        })
    ).toThrow("ANTHROPIC_API_KEY");
  });
});
