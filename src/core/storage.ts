import { compressToUTF16, decompressFromUTF16 } from "lz-string";
import {
  DEFAULT_COMPARE_OPTIONS,
  type CompareOptions,
  type DiffStats,
  type ThemeMode,
} from "./types";

export const STORAGE_KEY = "textdiff:state";
export const PENDING_COMPARE_KEY = "textdiff:pending-compare";
export const MAX_HISTORY_ENTRIES = 20;
export const MAX_STORAGE_BYTES = 8 * 1024 * 1024;

export interface DraftState {
  leftText: string;
  rightText: string;
  leftName: string;
  rightName: string;
  options: CompareOptions;
  updatedAt: string | null;
}

export interface AppSettings {
  theme: ThemeMode;
  sidebarCollapsed: boolean;
}

export interface HistoryEntry {
  id: string;
  title: string;
  createdAt: string;
  leftName: string;
  rightName: string;
  leftText: string;
  rightText: string;
  options: CompareOptions;
  stats: DiffStats;
}

export interface AppState {
  schemaVersion: 1;
  settings: AppSettings;
  draft: DraftState;
  history: HistoryEntry[];
}

export type HistoryInput = Omit<HistoryEntry, "id" | "createdAt">;

export interface StorageAdapter {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

interface StoredText {
  encoding: "lz-utf16";
  value: string;
}

interface StoredAppState extends Omit<AppState, "draft" | "history"> {
  draft: Omit<DraftState, "leftText" | "rightText"> & {
    leftText: StoredText;
    rightText: StoredText;
  };
  history: Array<
    Omit<HistoryEntry, "leftText" | "rightText"> & {
      leftText: StoredText;
      rightText: StoredText;
    }
  >;
}

export function createDefaultAppState(): AppState {
  return {
    schemaVersion: 1,
    settings: { theme: "system", sidebarCollapsed: false },
    draft: {
      leftText: "",
      rightText: "",
      leftName: "原始文本.txt",
      rightName: "更改后文本.txt",
      options: { ...DEFAULT_COMPARE_OPTIONS },
      updatedAt: null,
    },
    history: [],
  };
}

export function createHistoryEntry(
  input: HistoryInput,
  dependencies: { id?: string; now?: string } = {},
): HistoryEntry {
  return {
    ...input,
    id: dependencies.id ?? crypto.randomUUID(),
    createdAt: dependencies.now ?? new Date().toISOString(),
  };
}

export function addHistoryEntry(state: AppState, entry: HistoryEntry): AppState {
  return {
    ...state,
    history: [entry, ...state.history.filter((item) => item.id !== entry.id)].slice(
      0,
      MAX_HISTORY_ENTRIES,
    ),
  };
}

export function renameHistoryEntry(state: AppState, id: string, title: string): AppState {
  const normalizedTitle = title.trim();
  if (!normalizedTitle) return state;
  return {
    ...state,
    history: state.history.map((entry) =>
      entry.id === id ? { ...entry, title: normalizedTitle } : entry,
    ),
  };
}

export function deleteHistoryEntry(state: AppState, id: string): AppState {
  return { ...state, history: state.history.filter((entry) => entry.id !== id) };
}

export async function loadAppState(adapter = createDefaultStorageAdapter()): Promise<AppState> {
  try {
    const stored = (await adapter.get(STORAGE_KEY))[STORAGE_KEY];
    if (!isStoredAppState(stored)) return createDefaultAppState();
    return decodeState(stored);
  } catch {
    return createDefaultAppState();
  }
}

export async function persistAppState(
  state: AppState,
  adapter = createDefaultStorageAdapter(),
  limits: { byteLimit?: number } = {},
): Promise<{ state: AppState; evicted: number }> {
  const byteLimit = limits.byteLimit ?? MAX_STORAGE_BYTES;
  let candidate: AppState = {
    ...state,
    history: state.history.slice(0, MAX_HISTORY_ENTRIES),
  };
  let stored = encodeState(candidate);
  let evicted = state.history.length - candidate.history.length;

  while (serializedBytes(stored) >= byteLimit && candidate.history.length > 0) {
    candidate = { ...candidate, history: candidate.history.slice(0, -1) };
    stored = encodeState(candidate);
    evicted += 1;
  }

  if (serializedBytes(stored) >= byteLimit) {
    throw new Error("当前草稿超过本地存储容量，请缩短文本后重试。");
  }

  await adapter.set({ [STORAGE_KEY]: stored });
  return { state: candidate, evicted };
}

export function estimateStoredBytes(state: AppState): number {
  return serializedBytes(encodeState(state));
}

export function createDefaultStorageAdapter(): StorageAdapter {
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    return {
      get: (key) => chrome.storage.local.get(key),
      set: (items) => chrome.storage.local.set(items),
    };
  }

  return {
    async get(key) {
      const raw = localStorage.getItem(key);
      return { [key]: raw ? JSON.parse(raw) : undefined };
    },
    async set(items) {
      for (const [key, value] of Object.entries(items)) {
        localStorage.setItem(key, JSON.stringify(value));
      }
    },
  };
}

function encodeState(state: AppState): StoredAppState {
  return {
    schemaVersion: 1,
    settings: state.settings,
    draft: {
      ...state.draft,
      leftText: encodeText(state.draft.leftText),
      rightText: encodeText(state.draft.rightText),
    },
    history: state.history.map((entry) => ({
      ...entry,
      leftText: encodeText(entry.leftText),
      rightText: encodeText(entry.rightText),
    })),
  };
}

function decodeState(stored: StoredAppState): AppState {
  return {
    schemaVersion: 1,
    settings: stored.settings,
    draft: {
      ...stored.draft,
      leftText: decodeText(stored.draft.leftText),
      rightText: decodeText(stored.draft.rightText),
    },
    history: stored.history.map((entry) => ({
      ...entry,
      leftText: decodeText(entry.leftText),
      rightText: decodeText(entry.rightText),
    })),
  };
}

function encodeText(value: string): StoredText {
  return { encoding: "lz-utf16", value: compressToUTF16(value) };
}

function decodeText(value: StoredText): string {
  return decompressFromUTF16(value.value) ?? "";
}

function serializedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function isStoredAppState(value: unknown): value is StoredAppState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<StoredAppState>;
  return (
    candidate.schemaVersion === 1 &&
    Boolean(candidate.settings) &&
    Boolean(candidate.draft) &&
    Array.isArray(candidate.history)
  );
}
