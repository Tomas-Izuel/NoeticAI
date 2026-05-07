import { test, expect } from "bun:test";
import { deriveFragments, sha256 } from "./fragments";
import type { NoteContent } from "@noeticai/connector-core";

const sample: NoteContent = {
  ref: { source: "stub", externalId: "n1", kind: "page" },
  title: "T",
  blocks: [
    { kind: "heading", position: 0, text: "Heading should be skipped" },
    { kind: "paragraph", position: 1, text: "First paragraph." },
    { kind: "paragraph", position: 2, text: "  " }, // empty after trim → skip
    { kind: "code", position: 3, text: "console.log('hi')" },
    { kind: "bullet", position: 4, text: "A bullet point." },
  ],
};

test("deriveFragments skips headings and blank blocks", () => {
  const frags = deriveFragments(sample);
  expect(frags).toHaveLength(3);
  expect(frags.map((f) => f.kind)).toEqual(["paragraph", "code", "bullet"]);
});

test("deriveFragments tags code as non-embeddable", () => {
  const frags = deriveFragments(sample);
  const code = frags.find((f) => f.kind === "code");
  expect(code).toBeDefined();
  expect(code!.embeddable).toBe(false);
});

test("fragment id is content-addressed and stable", () => {
  const a = deriveFragments(sample);
  const b = deriveFragments(sample);
  expect(a.map((f) => f.id)).toEqual(b.map((f) => f.id));
});

test("changing fragment text changes id", () => {
  const original = deriveFragments(sample);
  const mutated: NoteContent = {
    ...sample,
    blocks: sample.blocks.map((b, i) =>
      i === 1 ? { ...b, text: "Different paragraph." } : b,
    ),
  };
  const after = deriveFragments(mutated);
  // Same number of fragments, different ids for the changed paragraph.
  expect(after).toHaveLength(original.length);
  const changedOriginal = original.find((f) => f.position === 1)!;
  const changedAfter = after.find((f) => f.position === 1)!;
  expect(changedAfter.id).not.toBe(changedOriginal.id);
});

test("sha256 produces 64-char hex", () => {
  const h = sha256("hello");
  expect(h).toMatch(/^[0-9a-f]{64}$/);
});
