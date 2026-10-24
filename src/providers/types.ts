export interface LogEvent {
  timestamp: Date;
  message: string;
}

export interface LogQuery {
  logGroup: string;
  startTime: Date;
  endTime: Date;
  filterPattern: string;
  limit: number;
}

export interface FetchResult {
  events: LogEvent[];
  truncated: boolean;
}

/** ワイルドカード展開で扱うロググループ数の上限 (providers と core で共有)。 */
export const MAX_GROUPS = 20;

export interface LogProvider {
  fetch(query: LogQuery): Promise<FetchResult>;
  /** 末尾ワイルドカード展開用の prefix 検索 (DescribeLogGroups)。 */
  listGroupNames(prefix: string): Promise<string[]>;
}
