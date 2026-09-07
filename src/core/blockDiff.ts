import { presentableDiff } from "@codemirror/merge";
import { diffChars, diffWordsWithSpace, type Change } from "diff";
import type { CompareOptions, DiffGranularity, DiffSegment } from "./types";

const MIN_BLOCK_SIMILARITY = 0.2;
const MIN_SHARED_EDGE_LENGTH = 3;

interface ChangeRange {
  fromLeft: number;
  toLeft: number;
  fromRight: number;
  toRight: number;
}

export interface BlockDiffResult {
  leftSegments: DiffSegment[][];
  rightSegments: DiffSegment[][];
  removedUnits: number;
  addedUnits: number;
}

export function createBlockDiff(
  leftLines: string[],
  rightLines: string[],
  options: CompareOptions,
): BlockDiffResult {
  if (leftLines.length === 0 || rightLines.length === 0) {
    return createWholeLineDiff(leftLines, rightLines);
  }

  const leftText = leftLines.join("\n");
  const rightText = rightLines.join("\n");
  const comparisonText = createComparisonText(leftText, rightText, options.ignoreCase);
  const ranges = createRanges(
    comparisonText.left,
    comparisonText.right,
    options.granularity,
  );
  if (
    calculateSimilarity(comparisonText.left, comparisonText.right, ranges) <
    MIN_BLOCK_SIMILARITY
  ) {
    return createWholeLineDiff(leftLines, rightLines);
  }

  const refinedRanges = ranges
    .map((range) => refineSharedEdges(range, leftText, rightText))
    .filter((range) => range.fromLeft !== range.toLeft || range.fromRight !== range.toRight);
  const leftSegments = createSideSegments(
    leftText,
    leftLines.length,
    refinedRanges,
    "left",
    "remove",
  );
  const rightSegments = createSideSegments(
    rightText,
    rightLines.length,
    refinedRanges,
    "right",
    "add",
  );

  return {
    leftSegments,
    rightSegments,
    removedUnits: countUnits(leftSegments, "remove"),
    addedUnits: countUnits(rightSegments, "add"),
  };
}

function createComparisonText(
  leftText: string,
  rightText: string,
  ignoreCase: boolean,
): { left: string; right: string } {
  if (!ignoreCase) return { left: leftText, right: rightText };

  const left = leftText.toLocaleLowerCase();
  const right = rightText.toLocaleLowerCase();
  return left.length === leftText.length && right.length === rightText.length
    ? { left, right }
    : { left: leftText, right: rightText };
}

function createRanges(
  leftText: string,
  rightText: string,
  granularity: DiffGranularity,
): ChangeRange[] {
  if (granularity === "character" || (
    granularity === "smart" && shouldUseCharacterDiff(leftText, rightText)
  )) {
    return changesToRanges(diffChars(leftText, rightText));
  }

  if (granularity === "smart") {
    return presentableDiff(leftText, rightText, { scanLimit: 20_000, timeout: 100 }).map(
      (change) => ({
        fromLeft: change.fromA,
        toLeft: change.toA,
        fromRight: change.fromB,
        toRight: change.toB,
      }),
    );
  }

  return changesToRanges(diffWordsWithSpace(leftText, rightText));
}

function shouldUseCharacterDiff(leftText: string, rightText: string): boolean {
  const combined = `${leftText}${rightText}`;
  return /[\u3400-\u9fff\uf900-\ufaff]/u.test(combined) || !/\s/u.test(combined.trim());
}

function changesToRanges(changes: Change[]): ChangeRange[] {
  const ranges: ChangeRange[] = [];
  let leftPosition = 0;
  let rightPosition = 0;
  let pending: ChangeRange | null = null;

  const flush = () => {
    if (!pending) return;
    ranges.push(pending);
    pending = null;
  };

  for (const change of changes) {
    if (!change.added && !change.removed) {
      flush();
      leftPosition += change.value.length;
      rightPosition += change.value.length;
      continue;
    }

    pending ??= {
      fromLeft: leftPosition,
      toLeft: leftPosition,
      fromRight: rightPosition,
      toRight: rightPosition,
    };
    if (change.removed) {
      leftPosition += change.value.length;
      pending.toLeft = leftPosition;
    } else {
      rightPosition += change.value.length;
      pending.toRight = rightPosition;
    }
  }
  flush();

  return ranges;
}

function refineSharedEdges(
  range: ChangeRange,
  leftText: string,
  rightText: string,
): ChangeRange {
  let left = leftText.slice(range.fromLeft, range.toLeft);
  let right = rightText.slice(range.fromRight, range.toRight);
  if (!left || !right) return range;

  const prefixLength = commonPrefixLength(left, right);
  if (codePointLength(left.slice(0, prefixLength)) >= MIN_SHARED_EDGE_LENGTH) {
    range = {
      ...range,
      fromLeft: range.fromLeft + prefixLength,
      fromRight: range.fromRight + prefixLength,
    };
    left = left.slice(prefixLength);
    right = right.slice(prefixLength);
  }

  const suffixLength = commonSuffixLength(left, right);
  if (codePointLength(left.slice(left.length - suffixLength)) >= MIN_SHARED_EDGE_LENGTH) {
    range = {
      ...range,
      toLeft: range.toLeft - suffixLength,
      toRight: range.toRight - suffixLength,
    };
  }

  return range;
}

function commonPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) index += 1;
  if (index > 0 && isLowSurrogate(left.charCodeAt(index))) index -= 1;
  return index;
}

function commonSuffixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let length = 0;
  while (
    length < limit &&
    left[left.length - length - 1] === right[right.length - length - 1]
  ) {
    length += 1;
  }
  if (length > 0 && isHighSurrogate(left.charCodeAt(left.length - length))) length -= 1;
  return length;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function calculateSimilarity(
  leftText: string,
  rightText: string,
  ranges: ChangeRange[],
): number {
  const totalLength = Math.max(leftText.length, rightText.length, 1);
  const changedLength = ranges.reduce(
    (sum, range) => sum + Math.max(
      range.toLeft - range.fromLeft,
      range.toRight - range.fromRight,
    ),
    0,
  );
  return Math.max(0, 1 - changedLength / totalLength);
}

function createSideSegments(
  text: string,
  lineCount: number,
  ranges: ChangeRange[],
  side: "left" | "right",
  changedType: "add" | "remove",
): DiffSegment[][] {
  const stream: DiffSegment[] = [];
  let cursor = 0;

  for (const range of ranges) {
    const from = side === "left" ? range.fromLeft : range.fromRight;
    const to = side === "left" ? range.toLeft : range.toRight;
    pushStreamSegment(stream, "equal", text.slice(cursor, from));
    if (to > from) pushStreamSegment(stream, changedType, text.slice(from, to));
    cursor = to;
  }
  pushStreamSegment(stream, "equal", text.slice(cursor));

  return splitSegmentsByLine(stream, lineCount);
}

function pushStreamSegment(
  segments: DiffSegment[],
  type: DiffSegment["type"],
  value: string,
): void {
  if (!value) return;
  const previous = segments.at(-1);
  if (previous?.type === type) {
    previous.value += value;
  } else {
    segments.push({ type, value });
  }
}

function splitSegmentsByLine(segments: DiffSegment[], lineCount: number): DiffSegment[][] {
  const lines = Array.from({ length: lineCount }, () => [] as DiffSegment[]);
  let lineIndex = 0;

  for (const segment of segments) {
    const pieces = segment.value.split("\n");
    for (let index = 0; index < pieces.length; index += 1) {
      if (index > 0) lineIndex += 1;
      if (lineIndex >= lines.length) break;
      const value = pieces[index] ?? "";
      if (value || (segment.type !== "equal" && index > 0)) {
        pushLineSegment(lines[lineIndex], { type: segment.type, value });
      }
    }
  }

  return lines;
}

function pushLineSegment(segments: DiffSegment[], segment: DiffSegment): void {
  const previous = segments.at(-1);
  if (segment.value && previous?.type === segment.type && previous.value) {
    previous.value += segment.value;
  } else {
    segments.push(segment);
  }
}

function countUnits(
  segmentsByLine: DiffSegment[][],
  changedType: "add" | "remove",
): number {
  return segmentsByLine.reduce(
    (sum, segments) => sum + Math.max(
      1,
      segments.filter((segment) => segment.type === changedType).length,
    ),
    0,
  );
}

function createWholeLineDiff(leftLines: string[], rightLines: string[]): BlockDiffResult {
  return {
    leftSegments: leftLines.map((line) => [{ type: "remove", value: line }]),
    rightSegments: rightLines.map((line) => [{ type: "add", value: line }]),
    removedUnits: leftLines.length,
    addedUnits: rightLines.length,
  };
}
