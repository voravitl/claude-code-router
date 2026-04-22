const { test, describe } = require("node:test");
const assert = require("node:assert");

const ReasoningNormalizerTransformer = require("../reasoning-normalizer.transformer.js");

describe("ReasoningNormalizerTransformer", () => {
  test("Ollama reasoning_content -> thinking format conversion", async () => {
    const transformer = new ReasoningNormalizerTransformer({
      enabled: true,
      outputFormat: "thinking",
      providerFormats: { ollama: "reasoning_content" },
    });

    const response = {
      choices: [
        {
          message: {
            content: "The answer is 42.",
            reasoning_content: "Let me calculate...",
          },
        },
      ],
    };

    const result = await transformer.transformResponseOut(response, { provider: { name: "ollama" } });
    assert.strictEqual(result.choices[0].message.content, "<thinking>\nLet me calculate...\n</thinking>\nThe answer is 42.");
    assert.strictEqual(result.choices[0].message.reasoning_content, undefined);
    assert.strictEqual(result.choices[0].message.reasoning, undefined);
  });

  test("DeepSeek <reasoning_content> tags -> thinking", async () => {
    const transformer = new ReasoningNormalizerTransformer({
      enabled: true,
      outputFormat: "thinking",
      providerFormats: {},
    });

    const response = {
      choices: [
        {
          message: {
            content: "<reasoning_content>Deep analysis here</reasoning_content>\nFinal output.",
          },
        },
      ],
    };

    const result = await transformer.transformResponseOut(response, { provider: { name: "deepseek" } });
    assert.strictEqual(result.choices[0].message.content, "<thinking>\nDeep analysis here\n</thinking>\nFinal output.");
  });

  test("Anthropic <thinking> tags -> preserved (passthrough)", async () => {
    const transformer = new ReasoningNormalizerTransformer({
      enabled: true,
      outputFormat: "thinking",
      providerFormats: { anthropic: "thinking" },
    });

    const response = {
      choices: [
        {
          message: {
            content: "<thinking>\nAlready in thinking tags\n</thinking>\nAnswer.",
          },
        },
      ],
    };

    const result = await transformer.transformResponseOut(response, { provider: { name: "anthropic" } });
    assert.strictEqual(result.choices[0].message.content, "<thinking>\nAlready in thinking tags\n</thinking>\nAnswer.");
  });

  test("Provider not in config -> auto-detect reasoning field", async () => {
    const transformer = new ReasoningNormalizerTransformer({
      enabled: true,
      outputFormat: "thinking",
      providerFormats: {},
    });

    const response = {
      choices: [
        {
          message: {
            content: "Final answer.",
            reasoning: "Step by step logic",
          },
        },
      ],
    };

    const result = await transformer.transformResponseOut(response, { provider: { name: "unknown" } });
    assert.strictEqual(result.choices[0].message.content, "<thinking>\nStep by step logic\n</thinking>\nFinal answer.");
    assert.strictEqual(result.choices[0].message.reasoning, undefined);
  });

  test("outputFormat none -> strip reasoning", async () => {
    const transformer = new ReasoningNormalizerTransformer({
      enabled: true,
      outputFormat: "none",
      providerFormats: {},
    });

    const response = {
      choices: [
        {
          message: {
            content: "<thinking>Remove this</thinking>\nKeep this.",
          },
        },
      ],
    };

    const result = await transformer.transformResponseOut(response, { provider: { name: "generic" } });
    assert.strictEqual(result.choices[0].message.content, "Keep this.");
    assert.strictEqual(result.choices[0].message.reasoning, undefined);
    assert.strictEqual(result.choices[0].message.reasoning_content, undefined);
  });

  test("Disabled -> passthrough", async () => {
    const transformer = new ReasoningNormalizerTransformer({
      enabled: false,
      outputFormat: "thinking",
    });

    const response = {
      choices: [
        {
          message: {
            content: "Original.",
            reasoning: "Logic",
          },
        },
      ],
    };

    const result = await transformer.transformResponseOut(response, { provider: { name: "any" } });
    assert.strictEqual(result.choices[0].message.content, "Original.");
    assert.strictEqual(result.choices[0].message.reasoning, "Logic");
  });
});
