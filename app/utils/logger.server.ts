type LogLevel = "info" | "warn" | "error" | "debug";

function timestamp(): string {
  return new Date().toISOString();
}

function formatMessage(level: LogLevel, source: string, message: string, data?: unknown): string {
  const base = `[${timestamp()}] [${level.toUpperCase()}] [${source}] ${message}`;
  if (data !== undefined) {
    try {
      return `${base} ${JSON.stringify(data)}`;
    } catch {
      return `${base} [unserializable data]`;
    }
  }
  return base;
}

function createLogger(source: string) {
  return {
    info: (message: string, data?: unknown) => {
      console.log(formatMessage("info", source, message, data));
    },
    warn: (message: string, data?: unknown) => {
      console.warn(formatMessage("warn", source, message, data));
    },
    error: (message: string, data?: unknown) => {
      console.error(formatMessage("error", source, message, data));
    },
    debug: (message: string, data?: unknown) => {
      if (process.env.NODE_ENV !== "production") {
        console.debug(formatMessage("debug", source, message, data));
      }
    },
  };
}

export const logger = {
  for: createLogger,
  // Shorthand for quick one-off logs
  info: (message: string, data?: unknown) => createLogger("app").info(message, data),
  warn: (message: string, data?: unknown) => createLogger("app").warn(message, data),
  error: (message: string, data?: unknown) => createLogger("app").error(message, data),
  debug: (message: string, data?: unknown) => createLogger("app").debug(message, data),
};
