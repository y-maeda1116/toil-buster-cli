import { GetQueryResultsCommand, StartQueryCommand } from "@aws-sdk/client-cloudwatch-logs";
import type { Sender } from "./cloudwatch.js";

export type InsightsStatus =
  "Scheduled" | "Running" | "Complete" | "Failed" | "Cancelled" | "Timeout" | "Unknown";

/** GetQueryResults の 1 行を field 名 → value のオブジェクトに縮約したもの。 */
export type InsightsRow = Record<string, string>;

/** ポーリング制御は CLI 側に委ねるため、provider はこの 3 操作だけを提供する。 */
export interface InsightsClient {
  startQuery(spec: InsightsQuerySpec): Promise<string>;
  status(queryId: string): Promise<string>;
  results(queryId: string): Promise<InsightsRow[]>;
}

export interface InsightsQuerySpec {
  logGroups: readonly string[];
  start: Date;
  end: Date;
  queryString: string;
  limit: number;
}

/**
 * CloudWatch Logs Insights (StartQuery / GetQueryResults) を扱う provider。
 * ポーリング制御は CLI 側で行い、ここは素通りのみを担う。
 */
export class InsightsProvider implements InsightsClient {
  constructor(private readonly sender: Sender) {}

  async startQuery(spec: InsightsQuerySpec): Promise<string> {
    const output = (await this.sender(
      new StartQueryCommand({
        logGroupNames: [...spec.logGroups],
        startTime: spec.start.getTime(),
        endTime: spec.end.getTime(),
        queryString: spec.queryString,
        limit: spec.limit,
      }) as never
    )) as { queryId?: string };
    if (output.queryId === undefined) {
      throw new Error("Insights クエリの開始に失敗しました (queryId が返されませんでした)");
    }
    return output.queryId;
  }

  async status(queryId: string): Promise<InsightsStatus> {
    const output = (await this.sender(new GetQueryResultsCommand({ queryId }) as never)) as {
      status?: InsightsStatus;
    };
    return output.status ?? "Unknown";
  }

  async results(queryId: string): Promise<InsightsRow[]> {
    const output = (await this.sender(new GetQueryResultsCommand({ queryId }) as never)) as {
      results?: { field?: string; value?: string }[][];
    };
    return (output.results ?? []).map((row) =>
      Object.fromEntries(
        row
          .filter((cell) => cell.field !== undefined)
          .map((cell) => [cell.field!, cell.value ?? ""])
      )
    );
  }
}
