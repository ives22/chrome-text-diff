import { PENDING_COMPARE_KEY, PENDING_ORIGINAL_KEY } from "../core/storage";
import type { ExtensionMessage, PendingCompare, PendingOriginal } from "./messages";

export const WORKBENCH_TAB_KEY = "textdiff:workbench-tab-id";
export const CONTEXT_MENU_ORIGINAL = "textdiff-set-original";
export const CONTEXT_MENU_COMPARE = "textdiff-compare-selection";

interface StoredArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove?(key: string): Promise<void>;
}

export interface ChromeBackgroundApi {
  runtime: {
    getURL(path: string): string;
    sendMessage?(message: ExtensionMessage): Promise<unknown>;
  };
  tabs: {
    get(tabId: number): Promise<{ id?: number; windowId?: number }>;
    create(properties: { url: string }): Promise<{ id?: number; windowId?: number }>;
    update(tabId: number, properties: { active: boolean }): Promise<unknown>;
  };
  windows: {
    update(windowId: number, properties: { focused: boolean }): Promise<unknown>;
  };
  storage: {
    session: StoredArea;
    local: StoredArea;
  };
  contextMenus: {
    removeAll(): Promise<void>;
    create(properties: {
      id: string;
      title: string;
      contexts: ["selection"];
    }): unknown;
  };
  action: {
    setBadgeText(details: { text: string }): Promise<void>;
    setBadgeBackgroundColor(details: { color: string }): Promise<void>;
  };
}

export async function initializeContextMenus(api: ChromeBackgroundApi): Promise<void> {
  await api.contextMenus.removeAll();
  api.contextMenus.create({
    id: CONTEXT_MENU_ORIGINAL,
    title: "TextDiff：设为原文",
    contexts: ["selection"],
  });
  api.contextMenus.create({
    id: CONTEXT_MENU_COMPARE,
    title: "TextDiff：作为新文本并比较",
    contexts: ["selection"],
  });
}

export async function handleExtensionInstalled(
  reason: string,
  api: ChromeBackgroundApi,
): Promise<void> {
  await initializeContextMenus(api);
  if (reason === "install") {
    await openOrFocusWorkbench(api, "workbench.html?setup=1");
  }
}

export async function openOrFocusWorkbench(
  api: ChromeBackgroundApi,
  path = "workbench.html",
): Promise<number> {
  const stored = await api.storage.session.get(WORKBENCH_TAB_KEY);
  const existingTabId = stored[WORKBENCH_TAB_KEY];

  if (typeof existingTabId === "number") {
    try {
      const tab = await api.tabs.get(existingTabId);
      await api.tabs.update(existingTabId, { active: true });
      if (typeof tab.windowId === "number") {
        await api.windows.update(tab.windowId, { focused: true });
      }
      return existingTabId;
    } catch {
      await api.storage.session.remove?.(WORKBENCH_TAB_KEY);
    }
  }

  const tab = await api.tabs.create({ url: api.runtime.getURL(path) });
  if (typeof tab.id !== "number") throw new Error("无法创建 TextDiff 工作台标签页。");
  await api.storage.session.set({ [WORKBENCH_TAB_KEY]: tab.id });
  return tab.id;
}

export async function handleContextMenuClick(
  info: { menuItemId: string | number; selectionText?: string },
  api: ChromeBackgroundApi,
): Promise<void> {
  const selection = info.selectionText;
  if (!selection) return;

  if (info.menuItemId === CONTEXT_MENU_ORIGINAL) {
    await storeOriginal(selection, api);
    return;
  }

  if (info.menuItemId === CONTEXT_MENU_COMPARE) {
    await queueComparison(selection, api);
  }
}

export async function handleRuntimeMessage(
  message: ExtensionMessage,
  api: ChromeBackgroundApi,
): Promise<void> {
  if (message.type === "OPEN_WORKBENCH") {
    await openOrFocusWorkbench(api);
  } else if (message.type === "SET_ORIGINAL_SELECTION") {
    await storeOriginal(message.text, api);
  } else if (message.type === "COMPARE_SELECTION") {
    await queueComparison(message.text, api);
  }
}

async function storeOriginal(text: string, api: ChromeBackgroundApi): Promise<void> {
  const original: PendingOriginal = {
    schemaVersion: 1,
    text,
    updatedAt: new Date().toISOString(),
  };
  await api.storage.local.set({ [PENDING_ORIGINAL_KEY]: original });
  await api.action.setBadgeBackgroundColor({ color: "#147D69" });
  await api.action.setBadgeText({ text: "A" });
}

async function queueComparison(text: string, api: ChromeBackgroundApi): Promise<void> {
  const stored = await api.storage.local.get(PENDING_ORIGINAL_KEY);
  const original = isPendingOriginal(stored[PENDING_ORIGINAL_KEY])
    ? stored[PENDING_ORIGINAL_KEY].text
    : "";
  const pending: PendingCompare = {
    schemaVersion: 1,
    leftText: original,
    rightText: text,
    leftName: "网页选取-原文.txt",
    rightName: "网页选取-新文本.txt",
    autoCompare: Boolean(original),
    createdAt: new Date().toISOString(),
  };
  await api.storage.local.set({ [PENDING_COMPARE_KEY]: pending });
  await openOrFocusWorkbench(api);
  await api.action.setBadgeText({ text: "" });
  await api.runtime.sendMessage?.({ type: "PENDING_COMPARE_READY" }).catch(() => undefined);
}

function isPendingOriginal(value: unknown): value is PendingOriginal {
  return Boolean(
    value &&
    typeof value === "object" &&
    (value as Partial<PendingOriginal>).schemaVersion === 1 &&
    typeof (value as Partial<PendingOriginal>).text === "string",
  );
}
