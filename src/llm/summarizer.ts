export interface AnthropicConfig {
  apiKey: string;
  model: string;
}

/** テストで注入できるよう最小限の HTTP 関数シグネチャに絞ったもの。 */
export type LlmHttp = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string }
) => Promise<Response>;

/** --ai で集計結果を要約するクライアントの契約。 */
export interface AiSummarizer {
  /** JSON として安全な集計スナップショットを受け取り、自然言語要約を返す。 */
  summarize(snapshot: readonly unknown[]): Promise<string>;
}

interface MessageResponseBody {
  content: { type: string; text?: string }[];
}

const SYSTEM_PROMPT =
  "あなたは SRE 向けログ分析アシスタントです。入力されるのは CloudWatch Logs のエラー集計" +
  "(正規化済みパターン・出現回数・時間窓) です。生ログは含まれません。" +
  "日本語で、上位パターンの傾向・注意すべき異常・次の調査アクションを簡潔に要約してください。";

/**
 * Anthropic Messages API で集計結果を要約する。
 * 認証情報は ANTHROPIC_API_KEY 環境変数経由でのみ渡す (config ファイルに置かない)。
 */
export class AnthropicSummarizer implements AiSummarizer {
  constructor(
    private readonly http: LlmHttp,
    private readonly config: AnthropicConfig
  ) {
    if (!config.apiKey)
      throw new Error("ANTHROPIC_API_KEY が未設定です (--ai には ANTHROPIC_API_KEY が必要です)");
  }

  async summarize(snapshot: readonly unknown[]): Promise<string> {
    const response = await this.http("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": this.config.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.config.model,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `次のエラー集計を要約してください:\n${JSON.stringify(snapshot)}`,
          },
        ],
      }),
    });
    if (!response.ok) {
      throw new Error(`LLM API エラー (${response.status}) : /v1/messages`);
    }
    const payload = (await response.json()) as MessageResponseBody;
    return (payload.content ?? [])
      .filter((part) => part.type === "text")
      .map((part) => part.text ?? "")
      .join("");
  }
}
