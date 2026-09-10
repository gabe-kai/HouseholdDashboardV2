/** RFC1918 / loopback HTTP origins allowed only when EVAL_LAN_ACCESS is on. */

export function isTrustedLanHttpOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== "http:") return false;
  if (url.username || url.password) return false;

  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1") {
    return true;
  }

  const parts = host.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

export function originMatchesConfig(
  origin: string | undefined,
  publicOrigin: string | null,
  allowLan: boolean,
): boolean {
  if (typeof origin !== "string" || origin.length === 0) return false;
  if (publicOrigin && origin === publicOrigin) return true;
  if (allowLan && isTrustedLanHttpOrigin(origin)) return true;
  return !publicOrigin;
}
