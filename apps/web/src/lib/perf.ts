// Lightweight performance instrumentation (Addendum 10 Phase 2).
// Logs durations to console and optionally to a lightweight analytics
// endpoint. Never throws — performance observation must never break
// the code path it's measuring.

export interface PerfMark {
  label: string;
  durationMs: number;
}

export type PerfReporter = (mark: PerfMark) => void;

const reporters: PerfReporter[] = [
  (mark) => {
    if (process.env.NODE_ENV === "development") {
      // eslint-disable-next-line no-console
      console.log(`[perf] ${mark.label}: ${mark.durationMs}ms`);
    }
  },
];

export function perfMark(label: string, start: number): void {
  const durationMs = Date.now() - start;
  for (const report of reporters) {
    try {
      report({ label, durationMs });
    } catch {
      // ignore reporter errors
    }
  }
}

export function perfTimer(label: string): { end: () => number } {
  const start = Date.now();
  return {
    end(): number {
      const durationMs = Date.now() - start;
      perfMark(label, start);
      return durationMs;
    },
  };
}
