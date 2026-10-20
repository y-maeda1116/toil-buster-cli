export type SelectKey =
  | string // 1 文字の入力 (絞り込みクエリに追加)
  | "enter"
  | "escape"
  | "up"
  | "down"
  | "backspace";

export interface SelectState {
  readonly choices: readonly string[];
  readonly query: string;
  readonly filtered: readonly string[];
  readonly selectedIndex: number;
}

export interface SelectResult {
  readonly state: SelectState;
  /** accept = Enter 確定 / cancel = Esc 中断。それ以外は継続。 */
  readonly action?: "accept" | "cancel";
  readonly value?: string;
}

const filterChoices = (choices: readonly string[], query: string): readonly string[] => {
  const q = query.toLowerCase();
  return choices.filter((c) => c.toLowerCase().includes(q));
};

export const createSelectState = (choices: readonly string[]): SelectState => ({
  choices,
  query: "",
  filtered: choices,
  selectedIndex: 0,
});

export function handleKey(state: SelectState, key: SelectKey): SelectResult {
  switch (key) {
    case "enter": {
      const value = state.filtered[state.selectedIndex];
      if (value === undefined) return { state };
      return { state, action: "accept", value };
    }
    case "escape":
      return { state, action: "cancel" };
    case "down":
      return {
        state: {
          ...state,
          selectedIndex: Math.min(state.selectedIndex + 1, state.filtered.length - 1),
        },
      };
    case "up":
      return { state: { ...state, selectedIndex: Math.max(state.selectedIndex - 1, 0) } };
    case "backspace": {
      const query = state.query.slice(0, -1);
      const filtered = filterChoices(state.choices, query);
      return {
        state: {
          ...state,
          query,
          filtered,
          selectedIndex: Math.min(state.selectedIndex, filtered.length - 1),
        },
      };
    }
    default: {
      if (key.length !== 1) return { state }; // 制御キーなどは無視
      const query = state.query + key;
      const filtered = filterChoices(state.choices, query);
      return {
        state: {
          ...state,
          query,
          filtered,
          selectedIndex: Math.min(state.selectedIndex, filtered.length - 1),
        },
      };
    }
  }
}
