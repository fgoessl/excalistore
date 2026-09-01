/**
 * Small leveled console logger — the frontend's counterpart to the API's
 * `tracing` setup (see api/src/main.rs). Not part of the original plan;
 * added as a lightweight observability aid, same spirit as the backend's
 * metrics.rs addition. No network calls, no external service — everything
 * stays in the browser console.
 *
 * `debug` is suppressed in production builds (`import.meta.env.PROD`) to
 * avoid leaking verbose internals to end users; `info`/`warn`/`error`
 * always print.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const MIN_LEVEL: LogLevel = import.meta.env.PROD ? "info" : "debug";

function log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[MIN_LEVEL]) return;

  // Dispatched through `console[level]` at call time (not captured as a
  // reference at module load) so test spies like `vi.spyOn(console, "info")`
  // — which replace the method on `console` after this module has already
  // loaded — actually intercept the call.
  const line = `[excalistore] ${message}`;
  if (context !== undefined) {
    console[level](line, context);
  } else {
    console[level](line);
  }
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => log("debug", message, context),
  info: (message: string, context?: Record<string, unknown>) => log("info", message, context),
  warn: (message: string, context?: Record<string, unknown>) => log("warn", message, context),
  error: (message: string, context?: Record<string, unknown>) => log("error", message, context),
};
