import { describe, expect, it } from "vitest";
import { cloudWatchProviderFactory, insightsProviderFactory, providerFor } from "./factory.js";
import { CloudWatchProvider } from "./cloudwatch.js";
import { DatadogProvider } from "./datadog.js";
import { InsightsProvider } from "./insights.js";

describe("provider factories", () => {
  it("cloudWatchProviderFactory は CloudWatchProvider を返す", () => {
    const provider = cloudWatchProviderFactory({ region: "ap-northeast-1" });
    expect(provider).toBeInstanceOf(CloudWatchProvider);
  });

  it("insightsProviderFactory は InsightsProvider を返す", () => {
    const provider = insightsProviderFactory({ region: "ap-northeast-1" });
    expect(provider).toBeInstanceOf(InsightsProvider);
  });
});

describe("providerFor (バックエンド切替)", () => {
  it("指定なしなら既定の cloudwatch を返す", () => {
    expect(providerFor({}, {})).toBeInstanceOf(CloudWatchProvider);
  });

  it("provider: datadog なら DD_* 環境変数を使った DatadogProvider を返す", () => {
    const provider = providerFor(
      { provider: "datadog" },
      { DD_API_KEY: "k", DD_APP_KEY: "a", DD_SITE: "us5.datadoghq.com" }
    );
    expect(provider).toBeInstanceOf(DatadogProvider);
  });

  it("datadog 指定でも DD_API_KEY がなければエラーにする", () => {
    expect(() => providerFor({ provider: "datadog" }, {})).toThrow("DD_API_KEY");
  });

  it("不明な provider 名はエラーにする", () => {
    expect(() => providerFor({ provider: "unknown" }, {})).toThrow("不明な provider");
  });
});
