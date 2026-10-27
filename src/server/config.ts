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
  displayCookieName: string;
  displayIdleDays: number;
  displayAbsoluteDays: number;
  autoSeed: boolean;
  /** Evaluation-only clear of routine activity history. Default on in development/test; off in hosted unless ALLOW_EVALUATION_HISTORY_CLEAR=1. */
  allowEvaluationHistoryClear: boolean;
  /** When set, browser owner/setup/reset lifecycle is available; when null, ordinary use continues without setup/reset. */
  installationOwnerSecret: string | null;
  /** Durable installation control SQLite (outside household snapshots). */
  installationControlPath: string;
  /** Resolved persistent-volume root when the host exposes RAILWAY_VOLUME_MOUNT_PATH. */
  volumeMountPath: string | null;
  ownerCookieName: string;
  setupCookieName: string;
  recoveryContinuationCookieName: string;
};

const LOCAL_CONTROL_DEFAULT = "runtime/installation-control.sqlite";

export function resolveConfiguredPath(configured: string): string {
  return path.isAbsolute(configured) ? configured : path.resolve(repoRoot, configured);
}

/** True when `candidate` resolves to `root` or a path inside it. */
export function isPathInsideRoot(candidate: string, root: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  if (relative === "") return true;
  if (path.isAbsolute(relative)) return false;
  return !relative.startsWith(`..${path.sep}`) && relative !== "..";
}

function hostedFail(message: string): never {
  throw new Error(message);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const profile = (env.APP_PROFILE as RuntimeProfile | undefined) ??
    (env.NODE_ENV === "production" ? "hosted" : "development");

  const controlRaw = env.INSTALLATION_CONTROL_PATH?.trim() ?? "";
  const dbRaw = env.DB_PATH?.trim() ?? "";
  const backupRaw = env.BACKUP_DIR?.trim() ?? "";

  if (profile === "hosted") {
    const origin = env.PUBLIC_ORIGIN?.trim() ?? "";
    if (!origin.startsWith("https://")) {
      hostedFail("Hosted profile requires PUBLIC_ORIGIN with https://");
    }
    if (!dbRaw) hostedFail("Hosted profile requires DB_PATH");
    if (!backupRaw) hostedFail("Hosted profile requires BACKUP_DIR");
    if (!controlRaw) {
      hostedFail(
        "Hosted profile requires INSTALLATION_CONTROL_PATH as an absolute path on persistent storage. Preserve household, epoch, backup, and control files and see docs/ops-deploy.md (Hosted installation continuity).",
      );
    }
    if (!path.isAbsolute(controlRaw)) {
      hostedFail(
        "Hosted profile requires INSTALLATION_CONTROL_PATH to be an absolute path on persistent storage. Preserve household, epoch, backup, and control files and see docs/ops-deploy.md (Hosted installation continuity).",
      );
    }
    if (env.EVAL_LAN_ACCESS === "1" || env.ALLOW_EVAL_BYPASS === "1") {
      hostedFail("Hosted profile forbids evaluation/LAN bypass flags");
    }
    if (env.AUTO_SEED === "1") {
      hostedFail("Hosted profile forbids AUTO_SEED");
    }
  }

  const installationControlPath =
    controlRaw || (profile === "hosted" ? controlRaw : LOCAL_CONTROL_DEFAULT);
  const dbPath = dbRaw || "runtime/dev.sqlite";
  const backupDir = backupRaw || "runtime/backups";

  const volumeMount = env.RAILWAY_VOLUME_MOUNT_PATH?.trim() ?? "";
  if (volumeMount) {
    const resolvedMount = path.resolve(volumeMount);
    const resolvedDb = resolveConfiguredPath(dbPath);
    const resolvedBackup = resolveConfiguredPath(backupDir);
    const resolvedControl = resolveConfiguredPath(installationControlPath);
    const offenders: string[] = [];
    if (!isPathInsideRoot(resolvedDb, resolvedMount)) {
      offenders.push(`DB_PATH=${resolvedDb}`);
    }
    if (!isPathInsideRoot(resolvedBackup, resolvedMount)) {
      offenders.push(`BACKUP_DIR=${resolvedBackup}`);
    }
    if (!isPathInsideRoot(resolvedControl, resolvedMount)) {
      offenders.push(`INSTALLATION_CONTROL_PATH=${resolvedControl}`);
    }
    if (offenders.length > 0) {
      throw new Error(
        `Configured data paths must resolve inside RAILWAY_VOLUME_MOUNT_PATH (${resolvedMount}). Offending paths: ${offenders.join("; ")}. Preserve household, epoch, backup, and control files and see docs/ops-deploy.md (Hosted installation continuity).`,
      );
    }
  }

  const allowLan =
    profile !== "hosted" && (env.EVAL_LAN_ACCESS === "1" || env.EVAL_LAN_ACCESS === "true");
  const host = env.HOST ?? (allowLan ? "0.0.0.0" : "127.0.0.1");
  const port = Number(env.PORT ?? 8787);
  const isProduction = env.NODE_ENV === "production" || profile === "hosted";
  const hosted = profile === "hosted";
  const allowEvaluationHistoryClear = hosted
    ? env.ALLOW_EVALUATION_HISTORY_CLEAR === "1" ||
      env.ALLOW_EVALUATION_HISTORY_CLEAR === "true"
    : env.ALLOW_EVALUATION_HISTORY_CLEAR !== "0" &&
      env.ALLOW_EVALUATION_HISTORY_CLEAR !== "false";

  return {
    profile,
    host,
    port,
    dbPath,
    backupDir,
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
    displayCookieName: hosted ? "__Host-hd_display" : "hd_dev_display",
    displayIdleDays: 90,
    displayAbsoluteDays: 365,
    autoSeed: profile !== "hosted" && (env.AUTO_SEED === "1" || env.AUTO_SEED === "true"),
    allowEvaluationHistoryClear,
    installationOwnerSecret: env.INSTALLATION_OWNER_SECRET?.trim() || null,
    installationControlPath,
    volumeMountPath: volumeMount ? path.resolve(volumeMount) : null,
    ownerCookieName: hosted ? "__Host-hd_owner" : "hd_dev_owner",
    setupCookieName: hosted ? "__Host-hd_setup" : "hd_dev_setup",
    recoveryContinuationCookieName: hosted
      ? "__Host-hd_lifecycle_cont"
      : "hd_dev_lifecycle_cont",
  };
}
