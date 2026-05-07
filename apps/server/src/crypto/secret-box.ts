import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../env";

const KEY = Buffer.from(env.SECRET_BOX_KEY, "base64");
const IV_LEN = 12;
const TAG_LEN = 16;

export function seal(plaintext: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

export function open(sealed: string): string {
  const buf = Buffer.from(sealed, "base64");
  if (buf.length < IV_LEN + TAG_LEN) {
    throw new Error("secret-box: sealed payload too short");
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", KEY, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
