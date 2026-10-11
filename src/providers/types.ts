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

export interface LogProvider {
  fetch(query: LogQuery): Promise<FetchResult>;
}
