import { describe, expect, it } from "vitest";
import {
  AI_ANALYSIS_CHUNK_BYTES,
  AI_ANALYSIS_MAX_BYTES,
  analyzeFullComparison,
  createFullTextAnalysisPlan,
  parseAiAnalysis,
} from "../src/ai/analysis";
import type { ModelProfile } from "../src/ai/types";

const profile: ModelProfile = {
  id: "profile-1",
  name: "测试模型",
  provider: "custom",
  baseUrl: "https://models.example.com/v1",
  model: "example-chat",
  rememberApiKey: false,
};

describe("full text AI analysis planning", () => {
  it("uses one request for input within forty-eight KiB", () => {
    const plan = createFullTextAnalysisPlan("left", "right");
    expect(plan.chunks).toEqual([{ index: 1, total: 1, leftText: "left", rightText: "right" }]);
    expect(plan.requestCount).toBe(1);
  });

  it("splits larger input into at most eight complete UTF-8-safe chunks", () => {
    const left = "左侧😀\n".repeat(12_000);
    const right = "right-side\n".repeat(12_000);
    const plan = createFullTextAnalysisPlan(left, right);

    expect(plan.chunks.length).toBeGreaterThan(1);
    expect(plan.chunks.length).toBeLessThanOrEqual(8);
    expect(plan.requestCount).toBe(plan.chunks.length + 1);
    expect(plan.chunks.map((chunk) => chunk.leftText).join("")).toBe(left);
    expect(plan.chunks.map((chunk) => chunk.rightText).join("")).toBe(right);
    for (const chunk of plan.chunks) {
      expect(new TextEncoder().encode(chunk.leftText + chunk.rightText).byteLength)
        .toBeLessThanOrEqual(AI_ANALYSIS_CHUNK_BYTES);
    }
    for (const chunk of plan.chunks.slice(0, -1)) {
      if (chunk.leftText) expect(chunk.leftText.endsWith("\n")).toBe(true);
      if (chunk.rightText) expect(chunk.rightText.endsWith("\n")).toBe(true);
    }
  });

  it("accepts the total byte boundary and rejects one byte above it", () => {
    const startedAt = performance.now();
    expect(createFullTextAnalysisPlan("a".repeat(AI_ANALYSIS_MAX_BYTES), "").chunks)
      .toHaveLength(8);
    expect(performance.now() - startedAt).toBeLessThan(500);
    expect(() => createFullTextAnalysisPlan("a".repeat(AI_ANALYSIS_MAX_BYTES + 1), ""))
      .toThrow("全文 AI 分析最多支持 384 KiB");
  });

  it("runs every analysis chunk and one final aggregation request", async () => {
    const leftText = "left-value\n".repeat(8_000);
    const rightText = "right-value\n".repeat(8_000);
    const plan = createFullTextAnalysisPlan(leftText, rightText);
    const calls: unknown[][] = [];
    const client = {
      async complete(...args: unknown[]) {
        calls.push(args);
        const isFinal = calls.length === plan.requestCount;
        return JSON.stringify({
          summary: isFinal ? "最终汇总" : `阶段 ${calls.length}`,
          risks: [],
          suggestions: isFinal
            ? [{ hunkId: "hunk-1", explanation: "最终建议" }]
            : [],
        });
      },
    };

    const result = await analyzeFullComparison(client, profile, "sk-test", {
      leftText,
      rightText,
      leftName: "before.txt",
      rightName: "after.txt",
      hunks: [{ hunkId: "hunk-1", leftText: "left-value", rightText: "right-value" }],
    });

    expect(calls).toHaveLength(plan.requestCount);
    expect(result.summary).toBe("最终汇总");
    expect(result.suggestions).toHaveLength(1);
    expect(JSON.stringify(calls.at(-1))).not.toContain(leftText);
  });
});

describe("parseAiAnalysis", () => {
  it("accepts fenced JSON, filters unknown hunks, and deduplicates suggestions", () => {
    const raw = `\`\`\`json
    {
      "summary": "配置发生变化",
      "risks": ["检查副本数"],
      "suggestions": [
        {"hunkId":"hunk-1","explanation":"字段变化","replacementText":"replicas: 2","recommendedTarget":"right"},
        {"hunkId":"hunk-1","explanation":"重复内容"},
        {"hunkId":"unknown","explanation":"越界内容"}
      ]
    }
    \`\`\``;

    expect(parseAiAnalysis(raw, new Set(["hunk-1"]))).toEqual({
      summary: "配置发生变化",
      risks: ["检查副本数"],
      suggestions: [{
        hunkId: "hunk-1",
        explanation: "字段变化",
        replacementText: "replicas: 2",
        recommendedTarget: "right",
      }],
    });
  });

  it("rejects invalid JSON and oversized replacement text", () => {
    expect(() => parseAiAnalysis("not-json", new Set(["hunk-1"])))
      .toThrow("模型没有返回可识别的结构化结果");
    expect(() => parseAiAnalysis(JSON.stringify({
      summary: "summary",
      risks: [],
      suggestions: [{
        hunkId: "hunk-1",
        explanation: "explanation",
        replacementText: "x".repeat(65 * 1024),
      }],
    }), new Set(["hunk-1"]))).toThrow("模型建议文本过长");
  });

  it("rejects oversized summary and explanation fields", () => {
    expect(() => parseAiAnalysis(JSON.stringify({
      summary: "x".repeat(33 * 1024),
      risks: [],
      suggestions: [],
    }), new Set())).toThrow("模型摘要过长");
    expect(() => parseAiAnalysis(JSON.stringify({
      summary: "summary",
      risks: [],
      suggestions: [{ hunkId: "hunk-1", explanation: "x".repeat(17 * 1024) }],
    }), new Set(["hunk-1"]))).toThrow("模型建议说明过长");
  });
});
