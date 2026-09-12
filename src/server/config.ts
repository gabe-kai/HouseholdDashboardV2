import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, "../..");

export type RuntimeProfile = "development" | "test" | "hosted";

export type AppConfig = {
  profile: RuntimeProfile;
  host: string;
  port: number;
  dbPath: string;
  backupDir: string;
  householdTimezone: string;
  allowLan: boolean;
  isProduction: boolean;
  clientDist: string;
  cookieName: string;
  cookieSecure: boolean;
  cookieHostPrefix: boolean;
  publicOrigin: string | null;
  trustedProxy: boolean;
  sessionIdleDays: number;
  sessionAbsoluteDays: number;
  autoSeed: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const profile = (env.APP_PROFILE as RuntimeProfile | undefined) ??
    (env.NODE_ENV === "production" ? "hosted" : "development");

  if (profile === "hosted") {
    const origin = env.PUBLIC_ORIGIN?.trim() ?? "";
    const dbPath = env.DB_PATH?.trim() ?? "";
    const backupDir = env.BACKUP_DIR?.trim() ?? "";
    if (!origin.startsWith("https://")) {
      throw new Error("Hosted profile requires PUBLIC_ORIGIN with https://");
    }
    if (!dbPath) throw new Error("Hosted profile requires DB_PATH");
    if (!backupDir) throw new Error("Hosted profile requires BACKUP_DIR");
    if (env.EVAL_LAN_ACCESS === "1" || env.ALLOW_EVAL_BYPASS === "1") {
      throw new Error("Hosted profile forbids evaluation/LAN bypass flags");
    }
    if (env.AUTO_SEED === "1") {
      throw new Error("Hosted profile forbids AUTO_SEED");
    }
  }

  const allowLan =
    profile !== "hosted" && (env.EVAL_LAN_ACCESS === "1" || env.EVAL_LAN_ACCESS === "true");
  const host = env.HOST ?? (allowLan ? "0.0.0.0" : "127.0.0.1");
  const port = Number(env.PORT ?? 8787);
  const isProduction = env.NODE_ENV === "production" || profile === "hosted";
  const hosted = profile === "hosted";

  return {
    profile,
    host,
    port,
    dbPath: env.DB_PATH ?? "runtime/dev.sqlite",
    backupDir: env.BACKUP_DIR ?? "runtime/backups",
    householdTimezone: env.HOUSEHOLD_TIMEZONE ?? "America/New_York",
    allowLan,
    isProduction,
    clientDist: path.resolve(repoRoot, "dist/client"),
    cookieName: hosted ? "__Host-hd_session" : "hd_dev_session",
    cookieSecure: hosted,
    cookieHostPrefix: hosted,
    // In local dev the browser Origin is the Vite app (5173), not the API port.
    publicOrigin:
      env.PUBLIC_ORIGIN?.trim() ||
      (hosted ? null : `http://127.0.0.1:${Number(env.VITE_PORT ?? 5173)}`),
    trustedProxy: env.TRUSTED_PROXY === "1",
    sessionIdleDays: 7,
    sessionAbsoluteDays: 30,
    autoSeed: profile !== "hosted" && (env.AUTO_SEED === "1" || env.AUTO_SEED === "true"),
  };
}
