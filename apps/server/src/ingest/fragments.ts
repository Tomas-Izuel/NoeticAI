import { createHash } from "node:crypto";
import type { NoteContent, BlockKind } from "@noeticai/connector-core";

// Per plan.md §1.2: one fragment per paragraph-equivalent block. Headings
// become section markers (skipped). Code blocks are tagged but excluded
// from semantic alignment by default — they still get a fragment row, but
// the embedder is allowed to skip them.

const FRAGMENT_KINDS: BlockKind[] = [
  "paragraph",
  "bullet",
  "numbered",
  "todo",
  "quote",
  "code",
];

export interface DerivedFragment {
  id: string; // sha256(externalId + position + textHash)
  position: number;
  kind: BlockKind;
  text: string;
  textHash: string;
  embeddable: boolean; // false for code blocks
}

export function deriveFragments(note: NoteContent): DerivedFragment[] {
  const out: DerivedFragment[] = [];
  for (const block of note.blocks) {
    if (!FRAGMENT_KINDS.includes(block.kind)) continue;
    const text = block.text.trim();
    if (text.length === 0) continue;
    const textHash = sha256(text);
    const id = sha256(`${note.ref.externalId}:${block.position}:${textHash}`);
    out.push({
      id,
      position: block.position,
      kind: block.kind,
      text,
      textHash,
      embeddable: block.kind !== "code",
    });
  }
  return out;
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
