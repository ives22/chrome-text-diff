import type { DiffHunk, DiffResult } from "../core/types";
import type { AiHunkContext } from "./analysis";
import type { HunkSuggestion } from "./types";

export interface SuggestionSnapshot {
  leftText: string;
  rightText: string;
  originalIndex: number;
}

export interface BoundHunkSuggestion extends HunkSuggestion {
  snapshot: SuggestionSnapshot;
}

export interface ResolvedSuggestionHunk {
  hunk: DiffHunk;
  index: number;
}

export function createAiHunkContexts(result: DiffResult): AiHunkContext[] {
  return result.hunks.map((hunk) => {
    const rows = result.rows.slice(hunk.rowStart, hunk.rowEnd + 1);
    return {
      hunkId: hunk.id,
      leftText: rows.flatMap((row) => row.left ? [row.left.text] : []).join("\n"),
      rightText: rows.flatMap((row) => row.right ? [row.right.text] : []).join("\n"),
    };
  });
}

export function bindAiSuggestions(
  result: DiffResult,
  suggestions: HunkSuggestion[],
): BoundHunkSuggestion[] {
  const contexts = createAiHunkContexts(result);
  const indexById = new Map(contexts.map((context, index) => [context.hunkId, index]));
  return suggestions.flatMap((suggestion) => {
    const index = indexById.get(suggestion.hunkId);
    const context = index === undefined ? undefined : contexts[index];
    if (index === undefined || !context) return [];
    return [{
      ...suggestion,
      snapshot: {
        leftText: context.leftText,
        rightText: context.rightText,
        originalIndex: index,
      },
    }];
  });
}

export function resolveSuggestionHunk(
  result: DiffResult,
  suggestion: BoundHunkSuggestion,
): ResolvedSuggestionHunk | null {
  const contexts = createAiHunkContexts(result);
  const candidates = contexts.flatMap((context, index) =>
    context.leftText === suggestion.snapshot.leftText &&
    context.rightText === suggestion.snapshot.rightText
      ? [{ hunk: result.hunks[index]!, index }]
      : [],
  );
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!;

  const ranked = candidates
    .map((candidate) => ({
      ...candidate,
      distance: Math.abs(candidate.index - suggestion.snapshot.originalIndex),
    }))
    .sort((left, right) => left.distance - right.distance);
  if (ranked[0]?.distance === ranked[1]?.distance) return null;
  return ranked[0] ?? null;
}
