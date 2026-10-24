import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { CloudWatchProvider } from "./cloudwatch.js";
import { InsightsProvider } from "./insights.js";

// CloudWatchProvider の Sender 型は callable (client.send) なので、
// client オブジェクトではなく send を bind した関数を渡す (Task 7 の ruling)。

export const cloudWatchProviderFactory = (opts: {
  region?: string;
  profile?: string;
}): CloudWatchProvider => {
  const client = new CloudWatchLogsClient(opts);
  return new CloudWatchProvider(client.send.bind(client));
};

export const insightsProviderFactory = (opts: {
  region?: string;
  profile?: string;
}): InsightsProvider => {
  const client = new CloudWatchLogsClient(opts);
  return new InsightsProvider(client.send.bind(client));
};
