import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { CloudWatchProvider } from "./cloudwatch.js";
import { DatadogProvider } from "./datadog.js";
import { InsightsProvider } from "./insights.js";
import type { LogProvider } from "./types.js";

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

export interface ProviderSelection {
  provider?: string;
  region?: string;
  profile?: string;
}

/**
 * ログバックエンドの切替。cloudwatch (既定) は AWS SDK、datadog は
 * DD_API_KEY / DD_APP_KEY / DD_SITE 環境変数を認証情報として使う。
 */
export const providerFor = (opts: ProviderSelection, env: NodeJS.ProcessEnv): LogProvider => {
  if (opts.provider === undefined || opts.provider === "cloudwatch") {
    return cloudWatchProviderFactory(opts);
  }
  if (opts.provider === "datadog") {
    return new DatadogProvider(globalThis.fetch, {
      site: env.DD_SITE ?? "datadoghq.com",
      apiKey: env.DD_API_KEY ?? "",
      appKey: env.DD_APP_KEY ?? "",
    });
  }
  throw new Error(`不明な provider: "${opts.provider}" (cloudwatch | datadog)`);
};
