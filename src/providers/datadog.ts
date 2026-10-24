import type { FetchResult, LogEvent, LogProvider, LogQuery } from "./types.js";

export interface DatadogConfig {
  site: string;
  apiKey: string;
  appKey: string;
}

/** テストで注入できるよう最小限の HTTP 関数シグネチャに絞ったもの。 */
export type DatadogHttp = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string }
) => Promise<Response>;

interface SearchRequestBody {
  filter: { query: string; from: string; to: string };
  page: { limit: number; cursor?: string };
  sort: string;
}

const SEARCH_PAGE_MAX = 1000;

/**
 * Datadog Log Management を LogProvider 契約で扱う provider。
 * 「ロググループ」は Datadog の service に対応付ける。
 * 認証情報は DD_API_KEY / DD_APP_KEY 環境変数経由でのみ渡す (config ファイルに置かない)。
 */
export class DatadogProvider implements LogProvider {
  constructor(
    private readonly http: DatadogHttp,
    private readonly config: DatadogConfig
  ) {
    if (!config.apiKey)
      throw new Error("DD_API_KEY が未設定です (--provider datadog には DD_API_KEY が必要です)");
    if (!config.appKey)
      throw new Error("DD_APP_KEY が未設定です (--provider datadog には DD_APP_KEY が必要です)");
  }

  async fetch(query: LogQuery): Promise<FetchResult> {
    const events: LogEvent[] = [];
    let cursor: string | undefined;
    // do-while で必ず 1 回は代入されるため初期化しない。
    let truncated: boolean;
    do {
      const body: SearchRequestBody = {
        filter: {
          query: buildSearchQuery(query.logGroup, query.filterPattern),
          from: query.startTime.toISOString(),
          to: query.endTime.toISOString(),
        },
        page: { limit: Math.min(SEARCH_PAGE_MAX, query.limit - events.length) },
        sort: "timestamp",
      };
      if (cursor !== undefined) body.page.cursor = cursor;
      const payload = await this.request("/api/v2/logs/events/search", body);
      const entries = (payload.data ?? []) as {
        attributes: { timestamp: string; message?: string };
      }[];
      for (const entry of entries) {
        events.push({
          timestamp: new Date(entry.attributes.timestamp),
          message: entry.attributes.message ?? "",
        });
        if (events.length >= query.limit) break;
      }
      const meta = payload.meta as { page?: { nextLogId?: string } } | undefined;
      cursor = meta?.page?.nextLogId;
      // limit 到達で打ち切った場合のみ truncated (カーソルが尽きた取得は打ち切りではない)。
      truncated = events.length >= query.limit && cursor !== undefined;
    } while (cursor !== undefined && events.length < query.limit);
    return { events, truncated };
  }

  async listGroupNames(prefix: string): Promise<string[]> {
    // service 一覧は aggregate API の group_by で取得する (facet 検索の代替)。
    const payload = await this.request("/api/v2/logs/analytics/aggregate", {
      filter: { query: `service:${prefix}*`, from: "now-1d", to: "now" },
      group_by: [{ facet: "service", limit: 100 }],
    });
    const groups = (payload.groups ?? []) as { by?: Record<string, unknown> }[];
    return groups.map((g) => String(g.by?.service ?? "")).filter((s) => s.length > 0);
  }

  private async request(path: string, body: unknown): Promise<Record<string, unknown>> {
    const response = await this.http(`https://${this.config.site}${path}`, {
      method: "POST",
      headers: {
        "DD-API-KEY": this.config.apiKey,
        "DD-APPLICATION-KEY": this.config.appKey,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`Datadog API エラー (${response.status}) : ${path}`);
    }
    return (await response.json()) as Record<string, unknown>;
  }
}

// CloudWatch の filter 構文 (?TERM / /.../ など) は Datadog に翻訳しない。
// 空でない場合は自由文として service 条件と AND で結合する。
const buildSearchQuery = (logGroup: string, filterPattern: string): string =>
  filterPattern === "" ? `service:${logGroup}` : `service:${logGroup} ${filterPattern}`;
