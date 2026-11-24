// Minimal structured logger: one JSON line per entry, easy to read in Vercel logs.
// Swap for pino later without changing call sites.
import { config } from "../config/index.js";

type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function write(level: Level, message: string, fields?: Record<string, unknown>) {
  if (ORDER[level] < ORDER[config.logLevel]) return;
  const line = JSON.stringify({ level, time: new Date().toISOString(), message, ...fields });
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export const logger = {
  debug: (message: string, fields?: Record<string, unknown>) => write("debug", message, fields),
  info: (message: string, fields?: Record<string, unknown>) => write("info", message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => write("warn", message, fields),
  error: (message: string, fields?: Record<string, unknown>) => write("error", message, fields),
};
