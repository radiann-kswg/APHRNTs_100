export type LogLevel = "error" | "warn" | "info" | "debug";

const LEVEL_ORDER: LogLevel[] = ["error", "warn", "info", "debug"];

export interface Logger {
  error(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
}

export function createLogger(minLevel: LogLevel): Logger {
  const minIndex = LEVEL_ORDER.indexOf(minLevel);

  function log(level: LogLevel, message: string, args: unknown[]): void {
    if (LEVEL_ORDER.indexOf(level) > minIndex) return;
    const timestamp = new Date().toISOString();
    const consoleMethod = level === "debug" ? console.log : console[level];
    consoleMethod(`[${timestamp}] [${level}]`, message, ...args);
  }

  return {
    error: (message, ...args) => log("error", message, args),
    warn: (message, ...args) => log("warn", message, args),
    info: (message, ...args) => log("info", message, args),
    debug: (message, ...args) => log("debug", message, args),
  };
}
