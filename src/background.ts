import {
  WORKBENCH_TAB_KEY,
  handleContextMenuClick,
  handleRuntimeMessage,
  initializeContextMenus,
  openOrFocusWorkbench,
  type ChromeBackgroundApi,
} from "./extension/backgroundService";
import type { ExtensionMessage } from "./extension/messages";

const api = chrome as unknown as ChromeBackgroundApi;

chrome.runtime.onInstalled.addListener(() => {
  void initializeContextMenus(api);
});

chrome.action.onClicked.addListener(() => {
  void openOrFocusWorkbench(api);
});

chrome.contextMenus.onClicked.addListener((info) => {
  void handleContextMenuClick(info, api);
});

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse) => {
    void handleRuntimeMessage(message, api)
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) => sendResponse({
        ok: false,
        message: error instanceof Error ? error.message : "扩展操作失败。",
      }));
    return true;
  },
);

chrome.tabs.onRemoved.addListener((tabId) => {
  void chrome.storage.session.get(WORKBENCH_TAB_KEY).then((stored) => {
    if (stored[WORKBENCH_TAB_KEY] === tabId) {
      return chrome.storage.session.remove(WORKBENCH_TAB_KEY);
    }
    return undefined;
  });
});
