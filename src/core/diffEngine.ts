import {
  createTwoFilesPatch,
  diffArrays,
} from "diff";
import type {
  CompareOptions,
  DiffCell,
  DiffResult,
  DiffRow,
} from "./types";
import { createBlockDiff } from "./blockDiff";

export const MAX_TEXT_BYTES = 2 * 1024 * 1024;
export const MAX_TEXT_LINES = 20_000;

interface LineRecord {
  lineNumber: number;
  original: string;
  key: string;
}

export interface TextValidation {
  valid: boolean;
  bytes: number;
  lines: number;
  reason?: "bytes" | "lines";
}

export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

export function validateText(text: string): TextValidation {
  const bytes = new TextEncoder().encode(text).byteLength;
  const lines = text === "" ? 0 : normalizeLineEndings(text).split("\n").length;

  if (bytes > MAX_TEXT_BYTES) {
    return { valid: false, bytes, lines, reason: "bytes" };
  }

  if (lines > MAX_TEXT_LINES) {
    return { valid: false, bytes, lines, reason: "lines" };
  }

  return { valid: true, bytes, lines };
}

export function computeDiff(
  leftText: string,
  rightText: string,
  options: CompareOptions,
): DiffResult {
  const left = createLineRecords(leftText, options);
  const right = createLineRecords(rightText, options);
  const leftLineCount = countLogicalLines(leftText);
  const rightLineCount = countLogicalLines(rightText);
  const changes = diffArrays(
    left.map((line) => line.key),
    right.map((line) => line.key),
  );
  const rows: DiffRow[] = [];
  const hunks: DiffResult["hunks"] = [];
  let leftCursor = 0;
  let rightCursor = 0;
  let changeIndex = 0;
  let hunkIndex = 0;
  let addedUnits = 0;
  let removedUnits = 0;
  let addedLines = 0;
  let removedLines = 0;
  let unchangedLines = 0;

  while (changeIndex < changes.length) {
    const change = changes[changeIndex];

    if (!change.added && !change.removed) {
      for (let index = 0; index < change.value.length; index += 1) {
        rows.push({
          id: `row-${rows.length + 1}`,
          kind: "equal",
          left: toCell(left[leftCursor]),
          right: toCell(right[rightCursor]),
        });
        leftCursor += 1;
        rightCursor += 1;
        unchangedLines += 1;
      }
      changeIndex += 1;
      continue;
    }

    const removed: LineRecord[] = [];
    const added: LineRecord[] = [];
    while (changeIndex < changes.length) {
      const pending = changes[changeIndex];
      if (!pending.added && !pending.removed) break;

      if (pending.removed) {
        removed.push(...left.slice(leftCursor, leftCursor + pending.value.length));
        leftCursor += pending.value.length;
      } else if (pending.added) {
        added.push(...right.slice(rightCursor, rightCursor + pending.value.length));
        rightCursor += pending.value.length;
      }
      changeIndex += 1;
    }

    hunkIndex += 1;
    const hunkId = `hunk-${hunkIndex}`;
    const rowStart = rows.length;
    const alignedCount = Math.max(removed.length, added.length);
    const blockDiff = createBlockDiff(
      removed.map((line) => line.original),
      added.map((line) => line.original),
      options,
    );

    removedUnits += blockDiff.removedUnits;
    addedUnits += blockDiff.addedUnits;
    removedLines += removed.length;
    addedLines += added.length;

    for (let index = 0; index < alignedCount; index += 1) {
      const leftLine = removed[index];
      const rightLine = added[index];

      rows.push({
        id: `row-${rows.length + 1}`,
        hunkId,
        kind: leftLine && rightLine ? "change" : leftLine ? "remove" : "add",
        left: leftLine
          ? { ...toCell(leftLine), segments: blockDiff.leftSegments[index] }
          : undefined,
        right: rightLine
          ? { ...toCell(rightLine), segments: blockDiff.rightSegments[index] }
          : undefined,
      });
    }

    hunks.push({
      id: hunkId,
      rowStart,
      rowEnd: rows.length - 1,
      leftRange: createHunkRange(removed, left[leftCursor], leftLineCount),
      rightRange: createHunkRange(added, right[rightCursor], rightLineCount),
    });
  }

  return {
    rows,
    hunks,
    stats: {
      addedUnits,
      removedUnits,
      addedLines,
      removedLines,
      unchangedLines,
      hunks: hunks.length,
    },
  };
}

function countLogicalLines(text: string): number {
  return text === "" ? 0 : normalizeLineEndings(text).split("\n").length;
}

function createHunkRange(
  changedLines: LineRecord[],
  nextRetainedLine: LineRecord | undefined,
  lineCount: number,
) {
  const first = changedLines[0];
  const last = changedLines.at(-1);
  if (first && last) {
    return { from: first.lineNumber - 1, to: last.lineNumber };
  }

  const insertionPoint = nextRetainedLine ? nextRetainedLine.lineNumber - 1 : lineCount;
  return { from: insertionPoint, to: insertionPoint };
}

export function createUnifiedPatch(
  leftName: string,
  rightName: string,
  leftText: string,
  rightText: string,
): string {
  return createTwoFilesPatch(
    leftName || "original.txt",
    rightName || "modified.txt",
    normalizeLineEndings(leftText),
    normalizeLineEndings(rightText),
    "",
    "",
    { context: 3 },
  );
}

function createLineRecords(text: string, options: CompareOptions): LineRecord[] {
  if (text === "") return [];

  return normalizeLineEndings(text)
    .split("\n")
    .map((original, index) => ({
      lineNumber: index + 1,
      original,
      key: normalizeForComparison(original, options),
    }))
    .filter((line) => !options.ignoreBlankLines || line.key !== "");
}

function normalizeForComparison(line: string, options: CompareOptions): string {
  let normalized = line;
  if (options.ignoreWhitespace) normalized = normalized.trim().replace(/\s+/gu, " ");
  if (options.ignoreCase) normalized = normalized.toLocaleLowerCase();
  return normalized;
}

function toCell(line: LineRecord): DiffCell;
function toCell(line: undefined): undefined;
function toCell(line: LineRecord | undefined): DiffCell | undefined {
  if (!line) return undefined;
  return { lineNumber: line.lineNumber, text: line.original };
}
