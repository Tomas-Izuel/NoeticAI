/**
 * bedrock.test.ts — unit tests for Phase 5 cachePoint wiring in converse().
 *
 * Strategy: mock @aws-sdk/client-bedrock-runtime so that BedrockRuntimeClient.send
 * captures the ConverseCommand input without making real network calls. We inspect
 * the `input` property of the ConverseCommand (the object passed to its constructor)
 * to verify cachePoint block placement.
 */
import { describe, test, expect, mock, beforeEach } from "bun:test";

// ---------------------------------------------------------------------------
// Capture the last ConverseCommand input across all calls.
// ---------------------------------------------------------------------------

let lastCommandInput: Record<string, unknown> | null = null;

// Mock @aws-sdk/client-bedrock-runtime before any imports that load bedrock.ts.
mock.module("@aws-sdk/client-bedrock-runtime", () => {
  class FakeConverseCommand {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
      lastCommandInput = input;
    }
  }

  class FakeBedrockRuntimeClient {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async send(_cmd: FakeConverseCommand) {
      // Return a minimal valid ConverseResponse shape.
      return {
        output: {
          message: {
            content: [{ text: "mock response" }],
          },
        },
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          cacheReadInputTokens: 0,
          cacheWriteInputTokens: 10,
        },
        stopReason: "end_turn",
      };
    }
  }

  return {
    BedrockRuntimeClient: FakeBedrockRuntimeClient,
    ConverseCommand: FakeConverseCommand,
  };
});

// Import AFTER the mock is registered so bedrock.ts picks up the fake client.
const { converse } = await import("./bedrock");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Count cachePoint blocks in an array of content blocks. */
function countCachePoints(content: Array<Record<string, unknown>>): number {
  return content.filter(
    (b) => b["cachePoint"] !== undefined && b["cachePoint"] !== null,
  ).length;
}

/** Index of the first cachePoint block in an array. */
function firstCachePointIndex(content: Array<Record<string, unknown>>): number {
  return content.findIndex(
    (b) => b["cachePoint"] !== undefined && b["cachePoint"] !== null,
  );
}

/** Index of the last text block before the first cachePoint. */
function textBlockBefore(
  content: Array<Record<string, unknown>>,
  cacheIdx: number,
): Record<string, unknown> | undefined {
  return cacheIdx > 0 ? content[cacheIdx - 1] : undefined;
}

const BASE_ARGS = {
  modelId: "anthropic.claude-sonnet-4-test",
  messages: [] as Array<{ role: "user" | "assistant"; content: Array<{ text: string }> }>,
} as const;

beforeEach(() => {
  lastCommandInput = null;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("cachePoints: ['system']", () => {
  test("inserts exactly 1 cachePoint in system array, after the text block", async () => {
    await converse({
      ...BASE_ARGS,
      system: "You are a helpful assistant.",
      cachePoints: ["system"],
    });

    const sys = lastCommandInput?.["system"] as Array<Record<string, unknown>>;
    expect(sys).toBeDefined();
    expect(countCachePoints(sys)).toBe(1);

    const cpIdx = firstCachePointIndex(sys);
    expect(cpIdx).toBeGreaterThan(0);

    const blockBefore = textBlockBefore(sys, cpIdx);
    expect(blockBefore?.["text"]).toBe("You are a helpful assistant.");
  });
});

describe("cachePoints: ['subject']", () => {
  test("inserts exactly 1 cachePoint in messages[0].content, after subject text block", async () => {
    await converse({
      ...BASE_ARGS,
      cachePoints: ["subject"],
      layeredContext: {
        subject: "Subject context text",
        concept: "Concept context text",
        userTurn: "What is the answer?",
      },
    });

    const msgs = lastCommandInput?.["messages"] as Array<{
      role: string;
      content: Array<Record<string, unknown>>;
    }>;
    expect(msgs).toBeDefined();
    const firstMsg = msgs[0];
    expect(firstMsg?.role).toBe("user");

    const content = firstMsg!.content;
    // Only one cachePoint: after subject (index 1).
    expect(countCachePoints(content)).toBe(1);

    const cpIdx = firstCachePointIndex(content);
    expect(cpIdx).toBe(1); // index 0 = subject text, index 1 = cachePoint

    const blockBefore = textBlockBefore(content, cpIdx);
    expect(blockBefore?.["text"]).toBe("Subject context text");

    // userTurn must appear but NOT be followed by a cachePoint.
    const userTurnIdx = content.findIndex((b) => b["text"] === "What is the answer?");
    expect(userTurnIdx).toBeGreaterThan(cpIdx);
    // Nothing after userTurn should be a cachePoint.
    const blocksAfterUserTurn = content.slice(userTurnIdx + 1);
    expect(countCachePoints(blocksAfterUserTurn)).toBe(0);
  });
});

describe("cachePoints: ['concept']", () => {
  test("inserts exactly 1 cachePoint in messages[0].content, after concept text block", async () => {
    await converse({
      ...BASE_ARGS,
      cachePoints: ["concept"],
      layeredContext: {
        subject: "Subject context text",
        concept: "Concept context text",
        userTurn: "What is the answer?",
      },
    });

    const msgs = lastCommandInput?.["messages"] as Array<{
      role: string;
      content: Array<Record<string, unknown>>;
    }>;
    const content = msgs[0]!.content;

    expect(countCachePoints(content)).toBe(1);

    const cpIdx = firstCachePointIndex(content);
    const blockBefore = textBlockBefore(content, cpIdx);
    expect(blockBefore?.["text"]).toBe("Concept context text");
  });
});

describe("cachePoints: ['system', 'subject', 'concept']", () => {
  test("inserts 3 cachePoint blocks at the right positions", async () => {
    await converse({
      ...BASE_ARGS,
      system: "System prompt here.",
      cachePoints: ["system", "subject", "concept"],
      layeredContext: {
        subject: "Subject context",
        concept: "Concept context",
        userTurn: "User task here.",
      },
    });

    // 1. System array: 1 cachePoint.
    const sys = lastCommandInput?.["system"] as Array<Record<string, unknown>>;
    expect(countCachePoints(sys)).toBe(1);
    const sysCpIdx = firstCachePointIndex(sys);
    expect(textBlockBefore(sys, sysCpIdx)?.["text"]).toBe("System prompt here.");

    // 2. First user message: 2 cachePoints.
    const msgs = lastCommandInput?.["messages"] as Array<{
      role: string;
      content: Array<Record<string, unknown>>;
    }>;
    const content = msgs[0]!.content;
    expect(countCachePoints(content)).toBe(2);

    // Expected order: [subject, CP, concept, CP, userTurn]
    expect(content[0]?.["text"]).toBe("Subject context");
    expect(content[1]?.["cachePoint"]).toBeDefined();
    expect(content[2]?.["text"]).toBe("Concept context");
    expect(content[3]?.["cachePoint"]).toBeDefined();
    expect(content[4]?.["text"]).toBe("User task here.");

    // userTurn is last and NOT followed by a cachePoint.
    expect(content.length).toBe(5);
  });
});

describe("cachePoints: undefined", () => {
  test("no cachePoint blocks anywhere when cachePoints is not set", async () => {
    await converse({
      ...BASE_ARGS,
      system: "System prompt.",
      layeredContext: {
        subject: "Subject context",
        concept: "Concept context",
        userTurn: "User task.",
      },
    });

    const sys = lastCommandInput?.["system"] as Array<Record<string, unknown>>;
    expect(countCachePoints(sys)).toBe(0);

    const msgs = lastCommandInput?.["messages"] as Array<{
      role: string;
      content: Array<Record<string, unknown>>;
    }>;
    const content = msgs[0]!.content;
    expect(countCachePoints(content)).toBe(0);
  });

  test("no cachePoint blocks anywhere when cachePoints is empty array", async () => {
    await converse({
      ...BASE_ARGS,
      system: "System prompt.",
      cachePoints: [],
      layeredContext: {
        subject: "Subject context",
        concept: "Concept context",
        userTurn: "User task.",
      },
    });

    const sys = lastCommandInput?.["system"] as Array<Record<string, unknown>>;
    expect(countCachePoints(sys)).toBe(0);

    const msgs = lastCommandInput?.["messages"] as Array<{
      role: string;
      content: Array<Record<string, unknown>>;
    }>;
    const content = msgs[0]!.content;
    expect(countCachePoints(content)).toBe(0);
  });
});

describe("layeredContext.userTurn is never cached", () => {
  test("userTurn is present in messages but not followed by cachePoint in any combination", async () => {
    await converse({
      ...BASE_ARGS,
      cachePoints: ["system", "subject", "concept"],
      system: "System.",
      layeredContext: {
        subject: "Subject.",
        concept: "Concept.",
        userTurn: "User turn text.",
      },
    });

    const msgs = lastCommandInput?.["messages"] as Array<{
      role: string;
      content: Array<Record<string, unknown>>;
    }>;
    const content = msgs[0]!.content;

    const userTurnIdx = content.findIndex((b) => b["text"] === "User turn text.");
    expect(userTurnIdx).toBeGreaterThan(-1);
    // Nothing after userTurn.
    expect(content.slice(userTurnIdx + 1).length).toBe(0);
  });
});

describe("layeredContext + args.messages ordering", () => {
  test("layeredContext produces the FIRST message; args.messages follow", async () => {
    await converse({
      ...BASE_ARGS,
      cachePoints: ["subject"],
      layeredContext: {
        subject: "Subject text.",
        userTurn: "User turn.",
      },
      messages: [
        { role: "assistant", content: [{ text: "Assistant reply." }] },
        { role: "user", content: [{ text: "Follow-up question." }] },
      ],
    });

    const msgs = lastCommandInput?.["messages"] as Array<{
      role: string;
      content: Array<Record<string, unknown>>;
    }>;
    expect(msgs.length).toBe(3);

    // First message is the layered context message.
    expect(msgs[0]?.role).toBe("user");
    expect(msgs[0]?.content[0]?.["text"]).toBe("Subject text.");

    // Second message is args.messages[0].
    expect(msgs[1]?.role).toBe("assistant");
    expect(msgs[1]?.content[0]?.["text"]).toBe("Assistant reply.");

    // Third message is args.messages[1].
    expect(msgs[2]?.role).toBe("user");
    expect(msgs[2]?.content[0]?.["text"]).toBe("Follow-up question.");
  });
});
