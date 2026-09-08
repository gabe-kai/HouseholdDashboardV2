import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, "../..");

export type AppConfig = {
  host: string;
  port: number;
  dbPath: string;
  householdTimezone: string;
  allowLan: boolean;
  isProduction: boolean;
  clientDist: string;
  cookieSecure: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const allowLan = env.EVAL_LAN_ACCESS === "1" || env.EVAL_LAN_ACCESS === "true";
  const host = env.HOST ?? (allowLan ? "0.0.0.0" : "127.0.0.1");
  const port = Number(env.PORT ?? 8787);
  const isProduction = env.NODE_ENV === "production";

  return {
    host,
    port,
    dbPath: env.DB_PATH ?? "runtime/dev.sqlite",
    householdTimezone: env.HOUSEHOLD_TIMEZONE ?? "America/New_York",
    allowLan,
    isProduction,
    clientDist: path.resolve(repoRoot, "dist/client"),
    cookieSecure: false,
  };
}
