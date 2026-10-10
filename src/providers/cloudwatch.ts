import { FilterLogEventsCommand } from "@aws-sdk/client-cloudwatch-logs";
import type {
  FilterLogEventsCommandInput,
  FilterLogEventsCommandOutput,
} from "@aws-sdk/client-cloudwatch-logs";
import type { FetchResult, LogProvider, LogQuery } from "./types.js";

// CloudWatchLogsClient の send は Command インスタンスを受け取る。
// この構造的型を満たすモック (vi.fn) でテストする。
export type Sender = (command: FilterLogEventsCommand) => Promise<FilterLogEventsCommandOutput>;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class CloudWatchProvider implements LogProvider {
  constructor(
    private readonly sender: Sender,
    private readonly opts: { retryDelayMs?: number; maxRetries?: number } = {}
  ) {}

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
      const output = await this.sendWithRetry(
        new FilterLogEventsCommand(input),
        retryDelayMs,
        maxRetries
      );
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
    command: FilterLogEventsCommand,
    retryDelayMs: number,
    maxRetries: number
  ): Promise<FilterLogEventsCommandOutput> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.sender(command);
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
