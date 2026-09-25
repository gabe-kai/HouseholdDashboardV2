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

/** RFC 4648 Base32 alphabet without padding. */
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** 16-character (80-bit) cryptographically random Base32 code. */
export function randomBase32Code(length = 16): string {
  if (length < 1) throw new Error("Base32 code length must be positive");
  const bytes = randomBytes(Math.ceil((length * 5) / 8));
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < length) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]!;
      bits -= 5;
    }
  }
  while (out.length < length) {
    out += BASE32_ALPHABET[randomBytes(1)[0]! & 31]!;
  }
  return out;
}

/** Strip separators/spaces and uppercase for display enrollment codes. */
export function normalizeDisplayCode(input: string): string {
  return input.replace(/[\s\-_]+/g, "").toUpperCase();
}
