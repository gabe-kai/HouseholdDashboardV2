import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { hash, verify, Algorithm } from "@node-rs/argon2";

const ARGON2_OPTS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function digestEquals(aHex: string, bHex: string): boolean {
  const a = Buffer.from(aHex, "hex");
  const b = Buffer.from(bHex, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function hashPassphrase(passphrase: string): Promise<string> {
  const normalized = passphrase.normalize("NFC");
  return hash(normalized, ARGON2_OPTS);
}

export async function verifyPassphrase(phc: string, passphrase: string): Promise<boolean> {
  try {
    return await verify(phc, passphrase.normalize("NFC"));
  } catch {
    return false;
  }
}

export function assertArgon2idPhc(phc: string): void {
  if (!phc.startsWith("$argon2id$")) {
    throw new Error("Credential is not Argon2id PHC");
  }
  if (!phc.includes("m=19456") && !phc.includes("m=19456,")) {
    // node-rs may encode params as m=19456,t=2,p=1
    if (!/m=19456/.test(phc)) {
      throw new Error("Argon2id memory cost below contract minimum");
    }
  }
}
