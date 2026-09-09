import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const listPath = path.resolve(here, "../../data/common-passwords.txt");

let cache: Set<string> | null = null;

function loadBlocklist(): Set<string> {
  if (cache) return cache;
  const text = fs.readFileSync(listPath, "utf8");
  cache = new Set(
    text
      .split(/\r?\n/)
      .map((l) => l.trim().toLowerCase())
      .filter((l) => l && !l.startsWith("#")),
  );
  return cache;
}

/** Local no-network common-password check (SecLists-derived sample; see data/ATTRIBUTION.md). */
export function isCommonPassphrase(passphrase: string): boolean {
  const normalized = passphrase.normalize("NFC").toLowerCase();
  return loadBlocklist().has(normalized);
}
