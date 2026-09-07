import { describe, expect, it } from "vitest";
import {
  MAX_MERGE_UNDO_BYTES,
  MAX_MERGE_UNDO_STEPS,
  mergeUndoBytes,
  pushMergeUndo,
  type MergeUndoEntry,
} from "../src/core/mergeUndo";

function entry(index: number, previousText = `text-${index}`): MergeUndoEntry {
  return { target: "right", previousText, hunkIndex: index };
}

describe("pushMergeUndo", () => {
  it("keeps only the twenty most recent merge steps", () => {
    const stack = Array.from({ length: 25 }, (_, index) => index)
      .reduce<MergeUndoEntry[]>((current, index) => pushMergeUndo(current, entry(index)), []);

    expect(stack).toHaveLength(MAX_MERGE_UNDO_STEPS);
    expect(stack[0]?.hunkIndex).toBe(5);
    expect(stack.at(-1)?.hunkIndex).toBe(24);
  });

  it("evicts the oldest text snapshots when they exceed sixteen megabytes", () => {
    const oneMegabyte = "配".repeat(349_526);
    const stack = Array.from({ length: 18 }, (_, index) => index)
      .reduce<MergeUndoEntry[]>((current, index) =>
        pushMergeUndo(current, entry(index, oneMegabyte)), []);

    expect(mergeUndoBytes(stack)).toBeLessThanOrEqual(MAX_MERGE_UNDO_BYTES);
    expect(stack.at(-1)?.hunkIndex).toBe(17);
    expect(stack[0]?.hunkIndex).toBeGreaterThan(0);
  });
});
