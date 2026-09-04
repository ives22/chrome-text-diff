export type DiffGranularity = "smart" | "word" | "character";
export type DiffViewMode = "split" | "unified";
export type ThemeMode = "system" | "light" | "dark";
export type DiffRowKind = "equal" | "change" | "add" | "remove";
export type DiffSegmentType = "equal" | "add" | "remove";

export interface CompareOptions {
  viewMode: DiffViewMode;
  granularity: DiffGranularity;
  ignoreCase: boolean;
  ignoreWhitespace: boolean;
  ignoreBlankLines: boolean;
  wrapLines: boolean;
}

export interface DiffSegment {
  type: DiffSegmentType;
  value: string;
}

export interface DiffCell {
  lineNumber: number;
  text: string;
  segments?: DiffSegment[];
}

export interface DiffRow {
  id: string;
  kind: DiffRowKind;
  hunkId?: string;
  left?: DiffCell;
  right?: DiffCell;
}

export interface DiffHunk {
  id: string;
  rowStart: number;
  rowEnd: number;
  leftStart?: number;
  rightStart?: number;
}

export interface DiffStats {
  added: number;
  removed: number;
  unchanged: number;
  hunks: number;
}

export interface DiffResult {
  rows: DiffRow[];
  hunks: DiffHunk[];
  stats: DiffStats;
}

export const DEFAULT_COMPARE_OPTIONS: CompareOptions = {
  viewMode: "split",
  granularity: "smart",
  ignoreCase: false,
  ignoreWhitespace: false,
  ignoreBlankLines: false,
  wrapLines: true,
};
