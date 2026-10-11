import type { SummaryResult } from "../core/aggregate.js";

const EMPTY_MESSAGE = "該当時間帯にエラーは見つかりませんでした";

export function renderJson(result: SummaryResult, top: number): string {
  if (result.groups.length === 0) {
    return `${JSON.stringify({ ...result, groups: [], message: EMPTY_MESSAGE }, null, 2)}\n`;
  }
  return `${JSON.stringify({ ...result, groups: result.groups.slice(0, top) }, null, 2)}\n`;
}
