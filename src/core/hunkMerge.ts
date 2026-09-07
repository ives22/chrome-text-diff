import type { DraftState } from "./storage";
import type { DiffHunk, LineRange, MergeDirection } from "./types";

interface LogicalLine {
  content: string;
  ending: string;
}

interface MergedLine extends LogicalLine {
  index: number;
  origin: "source" | "target";
}

export function applyHunkMerge(
  draft: DraftState,
  hunk: DiffHunk,
  direction: MergeDirection,
): DraftState {
  if (direction === "left-to-right") {
    return {
      ...draft,
      rightText: replaceLineRange(
        draft.rightText,
        hunk.rightRange,
        draft.leftText,
        hunk.leftRange,
      ),
    };
  }

  return {
    ...draft,
    leftText: replaceLineRange(
      draft.leftText,
      hunk.leftRange,
      draft.rightText,
      hunk.rightRange,
    ),
  };
}

export function applyHunkReplacement(
  draft: DraftState,
  hunk: DiffHunk,
  target: "left" | "right",
  replacementText: string,
): DraftState {
  const replacementLines = parseLogicalLines(replacementText);
  const replacementRange = { from: 0, to: replacementLines.length };
  if (target === "left") {
    return {
      ...draft,
      leftText: replaceLineRange(
        draft.leftText,
        hunk.leftRange,
        replacementText,
        replacementRange,
      ),
    };
  }
  return {
    ...draft,
    rightText: replaceLineRange(
      draft.rightText,
      hunk.rightRange,
      replacementText,
      replacementRange,
    ),
  };
}

function replaceLineRange(
  targetText: string,
  targetRange: LineRange,
  sourceText: string,
  sourceRange: LineRange,
): string {
  const targetLines = parseLogicalLines(targetText);
  const sourceLines = parseLogicalLines(sourceText);
  assertValidRange(targetRange, targetLines.length);
  assertValidRange(sourceRange, sourceLines.length);

  const output: MergedLine[] = [
    ...targetLines.slice(0, targetRange.from).map((line, index) => ({
      ...line,
      index,
      origin: "target" as const,
    })),
    ...sourceLines.slice(sourceRange.from, sourceRange.to).map((line, index) => ({
      ...line,
      index: sourceRange.from + index,
      origin: "source" as const,
    })),
    ...targetLines.slice(targetRange.to).map((line, index) => ({
      ...line,
      index: targetRange.to + index,
      origin: "target" as const,
    })),
  ];

  const preferredEnding = detectLineEnding(targetText) ?? detectLineEnding(sourceText) ?? "\n";
  return output.map((line, index) => {
    const next = output[index + 1];
    if (!next) return line.content;

    const untouchedTargetBoundary =
      line.origin === "target" &&
      next.origin === "target" &&
      next.index === line.index + 1;
    const ending = untouchedTargetBoundary && line.ending
      ? line.ending
      : preferredEnding;
    return `${line.content}${ending}`;
  }).join("");
}

function parseLogicalLines(text: string): LogicalLine[] {
  if (text === "") return [];

  const lines: LogicalLine[] = [];
  let offset = 0;
  while (offset < text.length) {
    const remaining = text.slice(offset);
    const match = /\r\n|\r|\n/u.exec(remaining);
    if (!match || match.index === undefined) {
      lines.push({ content: remaining, ending: "" });
      offset = text.length;
      break;
    }

    const endingStart = offset + match.index;
    const ending = match[0];
    lines.push({ content: text.slice(offset, endingStart), ending });
    offset = endingStart + ending.length;
    if (offset === text.length) lines.push({ content: "", ending: "" });
  }

  return lines;
}

function assertValidRange(range: LineRange, lineCount: number) {
  if (
    !Number.isInteger(range.from) ||
    !Number.isInteger(range.to) ||
    range.from < 0 ||
    range.to < range.from ||
    range.to > lineCount
  ) {
    throw new RangeError("差异范围已失效，请重新比较后再合并。");
  }
}

function detectLineEnding(text: string): string | undefined {
  return /\r\n|\r|\n/u.exec(text)?.[0];
}
