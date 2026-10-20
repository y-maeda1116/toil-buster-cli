/** liveLoop の中断シグナル。tick 内で throw して監視を終了させる。 */
export class LiveInterrupted extends Error {
  constructor() {
    super("live interrupted");
  }
}

export interface LiveDeps {
  sleep(ms: number): Promise<void>;
  clearScreen(): void;
}

/**
 * 指定間隔で tick を繰り返す監視ループ。各 tick の前に画面をクリアする。
 * count 指定時はその回数で終了、未指定時は tick が LiveInterrupted を
 * throw するまで (Ctrl+C 実装からの中断) 繰り返す。最終 tick の後は待たない。
 */
export async function liveLoop(
  opts: { intervalMs: number; count?: number },
  tick: () => Promise<void>,
  deps: LiveDeps
): Promise<void> {
  for (let i = 0; opts.count === undefined || i < opts.count; i++) {
    deps.clearScreen();
    try {
      await tick();
    } catch (err) {
      if (err instanceof LiveInterrupted) return;
      throw err;
    }
    if (opts.count !== undefined && i + 1 >= opts.count) return;
    await deps.sleep(opts.intervalMs);
  }
}
