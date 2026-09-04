import {
  createTwoFilesPatch,
  diffArrays,
  diffChars,
  diffWordsWithSpace,
  type Change,
} from "diff";
import type {
  CompareOptions,
  DiffCell,
  DiffResult,
  DiffRow,
  DiffSegment,
} from "./types";

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

    for (let index = 0; index < alignedCount; index += 1) {
      const leftLine = removed[index];
      const rightLine = added[index];
      const pairedSegments =
        leftLine && rightLine
          ? createInlineSegments(leftLine.original, rightLine.original, options)
          : undefined;

      rows.push({
        id: `row-${rows.length + 1}`,
        hunkId,
        kind: leftLine && rightLine ? "change" : leftLine ? "remove" : "add",
        left: leftLine
          ? { ...toCell(leftLine), segments: pairedSegments?.left }
          : undefined,
        right: rightLine
          ? { ...toCell(rightLine), segments: pairedSegments?.right }
          : undefined,
      });
    }

    hunks.push({
      id: hunkId,
      rowStart,
      rowEnd: rows.length - 1,
      leftStart: removed[0]?.lineNumber,
      rightStart: added[0]?.lineNumber,
    });
  }

  return {
    rows,
    hunks,
    stats: {
      added: rows.filter((row) => row.kind === "add" || row.kind === "change").length,
      removed: rows.filter((row) => row.kind === "remove" || row.kind === "change").length,
      unchanged: rows.filter((row) => row.kind === "equal").length,
      hunks: hunks.length,
    },
  };
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

function createInlineSegments(
  left: string,
  right: string,
  options: CompareOptions,
): { left: DiffSegment[]; right: DiffSegment[] } {
  const useCharacters =
    options.granularity === "character" ||
    (options.granularity === "smart" && shouldUseCharacterDiff(left, right));
  const changes = useCharacters
    ? diffChars(left, right, { ignoreCase: options.ignoreCase })
    : diffWordsWithSpace(left, right, { ignoreCase: options.ignoreCase });

  return {
    left: changes
      .filter((change) => !change.added)
      .map((change) => toSegment(change, "remove")),
    right: changes
      .filter((change) => !change.removed)
      .map((change) => toSegment(change, "add")),
  };
}

function shouldUseCharacterDiff(left: string, right: string): boolean {
  const combined = `${left}${right}`;
  return /[\u3400-\u9fff\uf900-\ufaff]/u.test(combined) || !/\s/u.test(combined.trim());
}

function toSegment(change: Change, changedType: "add" | "remove"): DiffSegment {
  return {
    type: change.added || change.removed ? changedType : "equal",
    value: change.value,
  };
}
