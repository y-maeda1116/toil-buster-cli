import { DescribeLogGroupsCommand, FilterLogEventsCommand } from "@aws-sdk/client-cloudwatch-logs";
import type {
  DescribeLogGroupsCommandOutput,
  FilterLogEventsCommandInput,
  FilterLogEventsCommandOutput,
} from "@aws-sdk/client-cloudwatch-logs";
import type { FetchResult, LogProvider, LogQuery } from "./types.js";
import { MAX_GROUPS } from "./types.js";

// CloudWatchLogsClient の send は Command インスタンスを受け取る。
// FilterLogEvents / DescribeLogGroups の両方を扱うためパラメータは never:
// 関数パラメータは反変なので、実物の client.send もテストの vi.fn も
// この型に割当可能になる (呼び出し側でのみキャストする)。
export type Sender = (command: never) => Promise<unknown>;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class CloudWatchProvider implements LogProvider {
  constructor(
    private readonly sender: Sender,
    private readonly opts: { retryDelayMs?: number; maxRetries?: number } = {}
  ) {}

  async listGroupNames(prefix: string): Promise<string[]> {
    const { retryDelayMs = 500, maxRetries = 3 } = this.opts;
    const names: string[] = [];
    let nextToken: string | undefined;
    do {
      const output = (await this.sendWithRetry(
        new DescribeLogGroupsCommand({ logGroupNamePrefix: prefix, nextToken }),
        retryDelayMs,
        maxRetries
      )) as DescribeLogGroupsCommandOutput;
      for (const g of output.logGroups ?? []) {
        if (g.logGroupName !== undefined) names.push(g.logGroupName);
      }
      nextToken = output.nextToken;
      // 上限を超えたら残りのページを取りに行かない (リソース上限の早期打ち切り)。
    } while (nextToken !== undefined && names.length <= MAX_GROUPS);
    return names;
  }

  async fetch(query: LogQuery): Promise<FetchResult> {
    const { retryDelayMs = 500, maxRetries = 3 } = this.opts;
    const events = [];
    let truncated = false;
    let nextToken: string | undefined;
    do {
      const input: FilterLogEventsCommandInput = {
        logGroupName: query.logGroup,
        startTime: query.startTime.getTime(),
        endTime: query.endTime.getTime(),
        filterPattern: query.filterPattern,
        nextToken,
      };
      const output = (await this.sendWithRetry(
        new FilterLogEventsCommand(input),
        retryDelayMs,
        maxRetries
      )) as FilterLogEventsCommandOutput;
      for (const e of output.events ?? []) {
        if (events.length >= query.limit) {
          truncated = true;
          break;
        }
        events.push({ timestamp: new Date(e.timestamp ?? 0), message: e.message ?? "" });
      }
      if (truncated) break;
      nextToken = output.nextToken;
    } while (nextToken !== undefined);
    return { events, truncated };
  }

  private async sendWithRetry(
    command: { readonly input: unknown },
    retryDelayMs: number,
    maxRetries: number
  ): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.sender(command as never);
      } catch (err) {
        if ((err as { name?: string }).name === "ThrottlingException" && attempt < maxRetries) {
          await delay(retryDelayMs * 2 ** attempt);
          continue;
        }
        throw err;
      }
    }
  }
}
