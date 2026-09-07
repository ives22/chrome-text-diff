export const MAX_MERGE_UNDO_STEPS = 20;
export const MAX_MERGE_UNDO_BYTES = 16 * 1024 * 1024;

export interface MergeUndoEntry {
  target: "left" | "right";
  previousText: string;
  hunkIndex: number;
}

export function pushMergeUndo(
  stack: MergeUndoEntry[],
  entry: MergeUndoEntry,
): MergeUndoEntry[] {
  const next = [...stack, entry].slice(-MAX_MERGE_UNDO_STEPS);
  while (next.length > 1 && mergeUndoBytes(next) > MAX_MERGE_UNDO_BYTES) {
    next.shift();
  }
  return next;
}

export function mergeUndoBytes(stack: MergeUndoEntry[]): number {
  const encoder = new TextEncoder();
  return stack.reduce((total, entry) => total + encoder.encode(entry.previousText).byteLength, 0);
}
