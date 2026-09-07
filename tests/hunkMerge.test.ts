import { describe, expect, it } from "vitest";
import { applyHunkMerge } from "../src/core/hunkMerge";
import { computeDiff } from "../src/core/diffEngine";
import { createDefaultAppState } from "../src/core/storage";
import type { DiffHunk } from "../src/core/types";
import { DEFAULT_COMPARE_OPTIONS } from "../src/core/types";

const hunk: DiffHunk = {
  id: "hunk-1",
  rowStart: 1,
  rowEnd: 2,
  leftRange: { from: 1, to: 3 },
  rightRange: { from: 1, to: 2 },
};

function createDraft(leftText: string, rightText: string) {
  return {
    ...createDefaultAppState().draft,
    leftText,
    rightText,
    leftName: "before.yaml",
    rightName: "after.yaml",
  };
}

describe("applyHunkMerge", () => {
  it("replaces only the target hunk in either direction", () => {
    const draft = createDraft("head\nleft-a\nleft-b\ntail", "head\nright\ntail");

    const mergedRight = applyHunkMerge(draft, hunk, "left-to-right");
    expect(mergedRight.rightText).toBe("head\nleft-a\nleft-b\ntail");
    expect(mergedRight.leftText).toBe(draft.leftText);
    expect(mergedRight.rightName).toBe("after.yaml");

    const mergedLeft = applyHunkMerge(draft, hunk, "right-to-left");
    expect(mergedLeft.leftText).toBe("head\nright\ntail");
    expect(mergedLeft.rightText).toBe(draft.rightText);
    expect(mergedLeft.leftName).toBe("before.yaml");
  });

  it("handles a pure addition and its symmetric deletion", () => {
    const addition: DiffHunk = {
      id: "hunk-1",
      rowStart: 1,
      rowEnd: 1,
      leftRange: { from: 1, to: 1 },
      rightRange: { from: 1, to: 2 },
    };
    const draft = createDraft("alpha\nomega", "alpha\ninserted\nomega");

    expect(applyHunkMerge(draft, addition, "right-to-left").leftText)
      .toBe("alpha\ninserted\nomega");
    expect(applyHunkMerge(draft, addition, "left-to-right").rightText)
      .toBe("alpha\nomega");
  });

  it("supports insertions at the beginning, end, and into an empty document", () => {
    const start: DiffHunk = {
      id: "start",
      rowStart: 0,
      rowEnd: 0,
      leftRange: { from: 0, to: 0 },
      rightRange: { from: 0, to: 1 },
    };
    expect(applyHunkMerge(createDraft("tail", "head\ntail"), start, "right-to-left").leftText)
      .toBe("head\ntail");

    const end: DiffHunk = {
      id: "end",
      rowStart: 1,
      rowEnd: 1,
      leftRange: { from: 1, to: 1 },
      rightRange: { from: 1, to: 2 },
    };
    expect(applyHunkMerge(createDraft("head", "head\ntail"), end, "right-to-left").leftText)
      .toBe("head\ntail");

    const empty: DiffHunk = {
      ...end,
      leftRange: { from: 0, to: 0 },
      rightRange: { from: 0, to: 2 },
    };
    expect(applyHunkMerge(createDraft("", "one\ntwo"), empty, "right-to-left").leftText)
      .toBe("one\ntwo");
  });

  it("uses the target line ending while leaving untouched mixed endings unchanged", () => {
    const draft = createDraft("head\nleft-a\nleft-b\ntail", "head\r\nright\r\ntail\nlast");
    const mixedHunk = {
      ...hunk,
      leftRange: { from: 1, to: 3 },
      rightRange: { from: 1, to: 2 },
    };

    expect(applyHunkMerge(draft, mixedHunk, "left-to-right").rightText)
      .toBe("head\r\nleft-a\r\nleft-b\r\ntail\nlast");
  });

  it("adopts the source trailing-newline state when merging a hunk at EOF", () => {
    const eofHunk: DiffHunk = {
      id: "eof",
      rowStart: 1,
      rowEnd: 2,
      leftRange: { from: 1, to: 3 },
      rightRange: { from: 1, to: 2 },
    };
    const addTrailing = createDraft("head\nvalue\n", "head\nold");
    expect(applyHunkMerge(addTrailing, eofHunk, "left-to-right").rightText)
      .toBe("head\nvalue\n");

    const removeTrailing = createDraft("head\nvalue", "head\nold\n");
    const removeTrailingHunk = {
      ...eofHunk,
      leftRange: { from: 1, to: 2 },
      rightRange: { from: 1, to: 3 },
    };
    expect(applyHunkMerge(removeTrailing, removeTrailingHunk, "left-to-right").rightText)
      .toBe("head\nvalue");
  });

  it("preserves unicode content without splitting surrogate pairs", () => {
    const unicodeHunk: DiffHunk = {
      id: "unicode",
      rowStart: 0,
      rowEnd: 0,
      leftRange: { from: 0, to: 1 },
      rightRange: { from: 0, to: 1 },
    };
    const merged = applyHunkMerge(
      createDraft("状态 😀", "状态 ✅"),
      unicodeHunk,
      "left-to-right",
    );

    expect(merged.rightText).toBe("状态 😀");
  });

  it("rejects stale or invalid hunk ranges", () => {
    const invalid = { ...hunk, leftRange: { from: 1, to: 99 } };
    expect(() => applyHunkMerge(createDraft("a", "b"), invalid, "left-to-right"))
      .toThrow("差异范围已失效");
  });

  it("applies ranges produced with ignored blank lines", () => {
    const leftText = "head\nold-a\n\nold-b\ntail";
    const rightText = "head\nnew\ntail";
    const result = computeDiff(leftText, rightText, {
      ...DEFAULT_COMPARE_OPTIONS,
      ignoreBlankLines: true,
    });

    const merged = applyHunkMerge(
      createDraft(leftText, rightText),
      result.hunks[0]!,
      "left-to-right",
    );
    expect(merged.rightText).toBe(leftText);
  });
});
