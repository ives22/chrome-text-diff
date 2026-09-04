const WORKBENCH_PATH = "workbench.html";

chrome.action.onClicked.addListener(() => {
  void chrome.tabs.create({ url: chrome.runtime.getURL(WORKBENCH_PATH) });
});
