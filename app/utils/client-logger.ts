type LogLevel = "info" | "warn" | "error" | "debug";

function timestamp(): string {
  return new Date().toISOString();
}

function format(level: LogLevel, source: string, message: string, data?: unknown): string {
  const base = `[${timestamp()}] [${level.toUpperCase()}] [${source}] ${message}`;
  if (data !== undefined) {
    try {
      return `${base} ${typeof data === "string" ? data : JSON.stringify(data)}`;
    } catch {
      return `${base} [unserializable]`;
    }
  }
  return base;
}

export function createClientLogger(source: string) {
  return {
    info: (msg: string, data?: unknown) => console.log(format("info", source, msg, data)),
    warn: (msg: string, data?: unknown) => console.warn(format("warn", source, msg, data)),
    error: (msg: string, data?: unknown) => console.error(format("error", source, msg, data)),
    debug: (msg: string, data?: unknown) => {
      if (typeof window !== "undefined" && window.location.hostname === "localhost") {
        console.debug(format("debug", source, msg, data));
      }
    },
  };
}
