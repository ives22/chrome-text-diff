import { describe, expect, it } from "vitest";
import { compressToUTF16 } from "lz-string";
import { DEFAULT_COMPARE_OPTIONS, type HistoryStats } from "../src/core/types";
import {
  MAX_HISTORY_ENTRIES,
  STORAGE_KEY,
  addHistoryEntry,
  createDefaultAppState,
  createHistoryEntry,
  deleteHistoryEntry,
  estimateStoredBytes,
  loadAppState,
  persistAppState,
  renameHistoryEntry,
  type StorageAdapter,
} from "../src/core/storage";

class MemoryStorage implements StorageAdapter {
  data: Record<string, unknown> = {};

  async get(key: string) {
    return { [key]: this.data[key] };
  }

  async set(items: Record<string, unknown>) {
    Object.assign(this.data, items);
  }
}

const stats: HistoryStats = {
  addedLines: 1,
  removedLines: 1,
  unchangedLines: 3,
  hunks: 1,
};

describe("app storage", () => {
  it("returns a versioned default state when storage is empty", async () => {
    const state = await loadAppState(new MemoryStorage());

    expect(state).toEqual(createDefaultAppState());
    expect(state.schemaVersion).toBe(2);
  });

  it("migrates version one drafts and history without losing text", async () => {
    const storage = new MemoryStorage();
    storage.data[STORAGE_KEY] = {
      schemaVersion: 1,
      settings: { theme: "dark", sidebarCollapsed: true },
      draft: {
        leftText: encodeLegacyText("legacy left"),
        rightText: encodeLegacyText("legacy right"),
        leftName: "before.yaml",
        rightName: "after.yaml",
        options: DEFAULT_COMPARE_OPTIONS,
        updatedAt: "2026-09-05T00:00:00.000Z",
      },
      history: [{
        id: "legacy-history",
        title: "旧版记录",
        createdAt: "2026-09-05T00:00:00.000Z",
        leftName: "before.yaml",
        rightName: "after.yaml",
        leftText: encodeLegacyText("old content"),
        rightText: encodeLegacyText("new content"),
        options: DEFAULT_COMPARE_OPTIONS,
        stats: { added: 7, removed: 5, unchanged: 11, hunks: 2 },
      }],
    };

    const state = await loadAppState(storage);

    expect(state.schemaVersion).toBe(2);
    expect(state.draft).toMatchObject({
      leftText: "legacy left",
      rightText: "legacy right",
      leftName: "before.yaml",
      rightName: "after.yaml",
    });
    expect(state.history[0]).toMatchObject({
      leftText: "old content",
      rightText: "new content",
      stats: {
        addedLines: 7,
        removedLines: 5,
        unchangedLines: 11,
        hunks: 2,
      },
    });
  });

  it("round-trips compressed draft and history text", async () => {
    const storage = new MemoryStorage();
    const initial = createDefaultAppState();
    initial.draft.leftText = "alpha\n".repeat(100);
    initial.draft.rightText = "beta\n".repeat(100);
    initial.history = [
      createHistoryEntry(
        {
          title: "配置变更",
          leftName: "before.yaml",
          rightName: "after.yaml",
          leftText: initial.draft.leftText,
          rightText: initial.draft.rightText,
          options: DEFAULT_COMPARE_OPTIONS,
          stats,
        },
        { id: "history-1", now: "2026-09-05T00:00:00.000Z" },
      ),
    ];

    await persistAppState(initial, storage);
    const raw = JSON.stringify(storage.data[STORAGE_KEY]);
    const restored = await loadAppState(storage);

    expect(raw.length).toBeLessThan(initial.draft.leftText.length + initial.draft.rightText.length);
    expect(restored).toEqual(initial);
  });

  it("keeps the newest twenty history entries", () => {
    let state = createDefaultAppState();

    for (let index = 0; index < MAX_HISTORY_ENTRIES + 1; index += 1) {
      const entry = createHistoryEntry(
        {
          title: `比较 ${index}`,
          leftName: "left.txt",
          rightName: "right.txt",
          leftText: `left ${index}`,
          rightText: `right ${index}`,
          options: DEFAULT_COMPARE_OPTIONS,
          stats,
        },
        { id: `history-${index}`, now: `2026-09-05T00:00:${String(index).padStart(2, "0")}.000Z` },
      );
      state = addHistoryEntry(state, entry);
    }

    expect(state.history).toHaveLength(MAX_HISTORY_ENTRIES);
    expect(state.history[0]?.id).toBe("history-20");
    expect(state.history.at(-1)?.id).toBe("history-1");
  });

  it("evicts old history until the configured byte budget fits", async () => {
    const storage = new MemoryStorage();
    const state = createDefaultAppState();
    state.history = ["oldest", "middle", "newest"].map((id, index) =>
      createHistoryEntry(
        {
          title: id,
          leftName: "left.txt",
          rightName: "right.txt",
          leftText: `${id}-${"abcdefghij".repeat(10 + index)}`,
          rightText: `${id}-${"jihgfedcba".repeat(10 + index)}`,
          options: DEFAULT_COMPARE_OPTIONS,
          stats,
        },
        { id, now: `2026-09-05T00:00:0${index}.000Z` },
      ),
    ).reverse();

    const newestOnly = { ...state, history: state.history.slice(0, 1) };
    const byteLimit = Math.ceil(
      (estimateStoredBytes(newestOnly) + estimateStoredBytes(state)) / 2,
    );
    const result = await persistAppState(state, storage, { byteLimit });

    expect(result.evicted).toBeGreaterThan(0);
    expect(result.state.history[0]?.id).toBe("newest");
    expect(JSON.stringify(storage.data[STORAGE_KEY]).length).toBeLessThan(byteLimit);
  });

  it("renames and deletes a saved comparison without mutating other entries", () => {
    const state = createDefaultAppState();
    state.history = [
      createHistoryEntry(
        {
          title: "旧标题",
          leftName: "left.txt",
          rightName: "right.txt",
          leftText: "a",
          rightText: "b",
          options: DEFAULT_COMPARE_OPTIONS,
          stats,
        },
        { id: "one", now: "2026-09-05T00:00:00.000Z" },
      ),
    ];

    const renamed = renameHistoryEntry(state, "one", "新标题");
    const deleted = deleteHistoryEntry(renamed, "one");

    expect(renamed.history[0]?.title).toBe("新标题");
    expect(deleted.history).toEqual([]);
    expect(state.history[0]?.title).toBe("旧标题");
  });

  it("falls back to defaults for an unknown schema version", async () => {
    const storage = new MemoryStorage();
    storage.data[STORAGE_KEY] = { schemaVersion: 99, history: [{ unsafe: true }] };

    await expect(loadAppState(storage)).resolves.toEqual(createDefaultAppState());
  });
});

function encodeLegacyText(value: string) {
  return { encoding: "lz-utf16", value: compressToUTF16(value) };
}
