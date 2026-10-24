import { describe, expect, it } from "vitest";
import { cloudWatchProviderFactory, insightsProviderFactory } from "./factory.js";
import { CloudWatchProvider } from "./cloudwatch.js";
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
