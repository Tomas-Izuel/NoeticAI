import { test, expect } from "bun:test";
import { seal, open } from "./secret-box";

test("seal/open round-trip", () => {
  const original = "hello noeticai — never store this in plaintext";
  const sealed = seal(original);
  expect(sealed).not.toBe(original);
  expect(open(sealed)).toBe(original);
});

test("seal produces different ciphertexts for the same plaintext", () => {
  const a = seal("same input");
  const b = seal("same input");
  expect(a).not.toBe(b);
  expect(open(a)).toBe(open(b));
});

test("open rejects tampered ciphertext", () => {
  const sealed = seal("tamper-me");
  const buf = Buffer.from(sealed, "base64");
  // Flip a bit deep in the ciphertext (after iv+tag).
  const lastByte = buf.length - 1;
  buf[lastByte] = (buf[lastByte] ?? 0) ^ 0x01;
  const tampered = buf.toString("base64");
  expect(() => open(tampered)).toThrow();
});
