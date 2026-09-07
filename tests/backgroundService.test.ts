import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONTEXT_MENU_COMPARE,
  CONTEXT_MENU_ORIGINAL,
  WORKBENCH_TAB_KEY,
  handleContextMenuClick,
  handleExtensionInstalled,
  initializeContextMenus,
  openOrFocusWorkbench,
  type ChromeBackgroundApi,
} from "../src/extension/backgroundService";
import { PENDING_COMPARE_KEY, PENDING_ORIGINAL_KEY } from "../src/core/storage";

function createChromeApi() {
  const session: Record<string, unknown> = {};
  const local: Record<string, unknown> = {};
  return {
    session,
    local,
    api: {
      runtime: { getURL: (path: string) => `chrome-extension://id/${path}` },
      tabs: {
        get: vi.fn(async (tabId: number) => ({ id: tabId, windowId: 7 })),
        create: vi.fn(async () => ({ id: 42, windowId: 8 })),
        update: vi.fn(async () => undefined),
      },
      windows: { update: vi.fn(async () => undefined) },
      storage: {
        session: {
          get: vi.fn(async (key: string) => ({ [key]: session[key] })),
          set: vi.fn(async (items: Record<string, unknown>) => Object.assign(session, items)),
          remove: vi.fn(async (key: string) => { delete session[key]; }),
        },
        local: {
          get: vi.fn(async (key: string) => ({ [key]: local[key] })),
          set: vi.fn(async (items: Record<string, unknown>) => Object.assign(local, items)),
        },
      },
      contextMenus: {
        removeAll: vi.fn(async () => undefined),
        create: vi.fn(() => undefined),
      },
      action: {
        setBadgeText: vi.fn(async () => undefined),
        setBadgeBackgroundColor: vi.fn(async () => undefined),
      },
    } as unknown as ChromeBackgroundApi,
  };
}

describe("background service", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("registers two selection-only context menu items", async () => {
    const { api } = createChromeApi();

    await initializeContextMenus(api);

    expect(api.contextMenus.removeAll).toHaveBeenCalledOnce();
    expect(api.contextMenus.create).toHaveBeenCalledTimes(2);
    expect(api.contextMenus.create).toHaveBeenCalledWith(expect.objectContaining({
      id: CONTEXT_MENU_ORIGINAL,
      contexts: ["selection"],
    }));
    expect(api.contextMenus.create).toHaveBeenCalledWith(expect.objectContaining({
      id: CONTEXT_MENU_COMPARE,
      contexts: ["selection"],
    }));
  });

  it("opens onboarding only for a fresh installation", async () => {
    const installed = createChromeApi();
    await handleExtensionInstalled("install", installed.api);
    expect(installed.api.tabs.create).toHaveBeenCalledWith({
      url: "chrome-extension://id/workbench.html?setup=1",
    });

    const updated = createChromeApi();
    await handleExtensionInstalled("update", updated.api);
    expect(updated.api.tabs.create).not.toHaveBeenCalled();
    expect(updated.api.contextMenus.create).toHaveBeenCalledTimes(2);
  });

  it("focuses an existing workbench tab instead of creating a duplicate", async () => {
    const { api, session } = createChromeApi();
    session[WORKBENCH_TAB_KEY] = 21;

    const tabId = await openOrFocusWorkbench(api);

    expect(tabId).toBe(21);
    expect(api.tabs.update).toHaveBeenCalledWith(21, { active: true });
    expect(api.windows.update).toHaveBeenCalledWith(7, { focused: true });
    expect(api.tabs.create).not.toHaveBeenCalled();
  });

  it("recreates a stale workbench tab and stores the new id", async () => {
    const { api, session } = createChromeApi();
    session[WORKBENCH_TAB_KEY] = 21;
    vi.mocked(api.tabs.get).mockRejectedValueOnce(new Error("missing"));

    const tabId = await openOrFocusWorkbench(api);

    expect(tabId).toBe(42);
    expect(session[WORKBENCH_TAB_KEY]).toBe(42);
    expect(api.tabs.create).toHaveBeenCalledWith({
      url: "chrome-extension://id/workbench.html",
    });
  });

  it("stores a selected original locally without opening a tab", async () => {
    const { api, local } = createChromeApi();

    await handleContextMenuClick(
      { menuItemId: CONTEXT_MENU_ORIGINAL, selectionText: "original" },
      api,
    );

    expect(local[PENDING_ORIGINAL_KEY]).toMatchObject({ text: "original", schemaVersion: 1 });
    expect(api.tabs.create).not.toHaveBeenCalled();
    expect(api.action.setBadgeText).toHaveBeenCalledWith({ text: "A" });
  });

  it("combines the saved original with a new selection and opens the workbench", async () => {
    const { api, local } = createChromeApi();
    local[PENDING_ORIGINAL_KEY] = { schemaVersion: 1, text: "before" };

    await handleContextMenuClick(
      { menuItemId: CONTEXT_MENU_COMPARE, selectionText: "after" },
      api,
    );

    expect(local[PENDING_COMPARE_KEY]).toMatchObject({
      schemaVersion: 1,
      leftText: "before",
      rightText: "after",
      autoCompare: true,
    });
    expect(api.tabs.create).toHaveBeenCalledOnce();
    expect(api.action.setBadgeText).toHaveBeenCalledWith({ text: "" });
  });
});
