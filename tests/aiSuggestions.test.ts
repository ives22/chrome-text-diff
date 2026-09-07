import { describe, expect, it } from "vitest";
import { computeDiff } from "../src/core/diffEngine";
import { applyHunkReplacement } from "../src/core/hunkMerge";
import { createDefaultAppState } from "../src/core/storage";
import { DEFAULT_COMPARE_OPTIONS } from "../src/core/types";
import {
  bindAiSuggestions,
  createAiHunkContexts,
  resolveSuggestionHunk,
} from "../src/ai/suggestions";

function createDraft(leftText: string, rightText: string) {
  return { ...createDefaultAppState().draft, leftText, rightText };
}

describe("AI hunk suggestions", () => {
  it("builds block-only model contexts from local diff hunks", () => {
    const result = computeDiff(
      "head\nold-a\nstable\nold-b",
      "head\nnew-a\nstable\nnew-b",
      DEFAULT_COMPARE_OPTIONS,
    );

    expect(createAiHunkContexts(result)).toEqual([
      { hunkId: "hunk-1", leftText: "old-a", rightText: "new-a" },
      { hunkId: "hunk-2", leftText: "old-b", rightText: "new-b" },
    ]);
  });

  it("re-resolves an unchanged suggestion after an earlier hunk changes line counts", () => {
    const original = computeDiff(
      "old-a\nstable\nold-b",
      "new-a\nstable\nnew-b",
      DEFAULT_COMPARE_OPTIONS,
    );
    const [bound] = bindAiSuggestions(original, [{
      hunkId: "hunk-2",
      explanation: "replace the second block",
      replacementText: "resolved-b",
    }]);
    const shifted = computeDiff(
      "inserted\nnew-a\nstable\nold-b",
      "new-a\nstable\nnew-b",
      DEFAULT_COMPARE_OPTIONS,
    );

    expect(resolveSuggestionHunk(shifted, bound!)).toMatchObject({
      index: 1,
      hunk: { leftRange: { from: 3, to: 4 } },
    });
  });

  it("marks a suggestion stale when its source changed or matches ambiguously", () => {
    const original = computeDiff("old", "new", DEFAULT_COMPARE_OPTIONS);
    const [bound] = bindAiSuggestions(original, [{ hunkId: "hunk-1", explanation: "change" }]);
    expect(resolveSuggestionHunk(
      computeDiff("changed", "new", DEFAULT_COMPARE_OPTIONS),
      bound!,
    )).toBeNull();

    const repeated = computeDiff(
      "old\nstable\nold",
      "new\nstable\nnew",
      DEFAULT_COMPARE_OPTIONS,
    );
    const [first] = bindAiSuggestions(repeated, [{ hunkId: "hunk-1", explanation: "change" }]);
    const tied = { ...first!, snapshot: { ...first!.snapshot, originalIndex: 0.5 } };
    expect(resolveSuggestionHunk(repeated, tied)).toBeNull();
  });

  it("applies replacement text to either side and preserves target line endings", () => {
    const draft = createDraft("head\nold\ntail", "head\r\nnew\r\ntail");
    const result = computeDiff(draft.leftText, draft.rightText, DEFAULT_COMPARE_OPTIONS);
    const hunk = result.hunks[0]!;

    expect(applyHunkReplacement(draft, hunk, "right", "resolved\nvalue").rightText)
      .toBe("head\r\nresolved\r\nvalue\r\ntail");
    expect(applyHunkReplacement(draft, hunk, "left", "resolved").leftText)
      .toBe("head\nresolved\ntail");
  });
});
