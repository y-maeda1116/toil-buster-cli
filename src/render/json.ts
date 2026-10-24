import type { SummaryResult } from "../core/aggregate.js";

const EMPTY_MESSAGE = "該当時間帯にエラーは見つかりませんでした";

// 複数グループ時は CLI 側で配列にまとめるため、オブジェクト生成を分離して共有する。
export function toJsonValue(result: SummaryResult, top: number): Record<string, unknown> {
  if (result.groups.length === 0) {
    return { ...result, groups: [], message: EMPTY_MESSAGE };
  }
  return { ...result, groups: result.groups.slice(0, top) };
}

export function renderJson(result: SummaryResult, top: number): string {
  return `${JSON.stringify(toJsonValue(result, top), null, 2)}\n`;
}
