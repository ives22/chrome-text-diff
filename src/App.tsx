import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Menu,
  Moon,
  Monitor,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  Sun,
} from "lucide-react";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { DiffViewer } from "./components/DiffViewer";
import { IconButton } from "./components/IconButton";
import { InputWorkspace } from "./components/InputWorkspace";
import { ResultToolbar } from "./components/ResultToolbar";
import { ToolSidebar } from "./components/ToolSidebar";
import { createUnifiedPatch, validateText } from "./core/diffEngine";
import { DiffWorkerClient } from "./core/diffWorkerClient";
import { applyHunkMerge } from "./core/hunkMerge";
import { pushMergeUndo, type MergeUndoEntry } from "./core/mergeUndo";
import {
  addHistoryEntry,
  createDefaultAppState,
  createDefaultStorageAdapter,
  createHistoryEntry,
  deleteHistoryEntry,
  loadAppState,
  persistAppState,
  renameHistoryEntry,
  type AppState,
  type HistoryEntry,
  type StorageAdapter,
} from "./core/storage";
import type {
  CompareOptions,
  DiffResult,
  MergeDirection,
  ThemeMode,
} from "./core/types";
import type { ExtensionMessage } from "./extension/messages";
import { consumePendingCompare } from "./extension/pendingCompare";

interface DiffClient {
  compare(leftText: string, rightText: string, options: CompareOptions): Promise<DiffResult>;
  cancel(): void;
  dispose(): void;
}

interface AppProps {
  initialState?: AppState;
  storage?: StorageAdapter;
  diffClient?: DiffClient;
}

interface ComparisonNavigation {
  activeHunkIndex?: number;
  keepMergePanelOpen?: boolean;
  allowEmpty?: boolean;
}

export function App({ initialState, storage: providedStorage, diffClient }: AppProps = {}) {
  const storage = useMemo(
    () => providedStorage ?? createDefaultStorageAdapter(),
    [providedStorage],
  );
  const client = useMemo(() => diffClient ?? new DiffWorkerClient(), [diffClient]);
  const [state, setState] = useState<AppState>(() => initialState ?? createDefaultAppState());
  const [hydrated, setHydrated] = useState(Boolean(initialState));
  const [screen, setScreen] = useState<"input" | "result">("input");
  const [result, setResult] = useState<DiffResult | null>(null);
  const [panel, setPanel] = useState<"tools" | "history">("tools");
  const [activeHunkIndex, setActiveHunkIndex] = useState(0);
  const [mergePanelOpen, setMergePanelOpen] = useState(false);
  const [mergeUndoStack, setMergeUndoStack] = useState<MergeUndoEntry[]>([]);
  const [isComparing, setIsComparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmClearHistory, setConfirmClearHistory] = useState(false);
  const [isNarrow, setIsNarrow] = useState(() => window.innerWidth < 960);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const initialPendingHandled = useRef(false);
  const mergeInFlight = useRef(false);
  const comparisonSequence = useRef(0);

  useEffect(() => {
    if (initialState) return;
    let current = true;
    void loadAppState(storage).then((loaded) => {
      if (!current) return;
      if (window.innerWidth < 960 && loaded.draft.options.viewMode === "split") {
        loaded.draft.options = { ...loaded.draft.options, viewMode: "unified" };
      }
      setState(loaded);
      setHydrated(true);
    });
    return () => { current = false; };
  }, [initialState, storage]);

  useEffect(() => {
    if (!hydrated) return;
    const timeout = window.setTimeout(() => {
      void persistAppState(state, storage)
        .then(({ state: persisted, evicted }) => {
          if (evicted > 0) {
            setState(persisted);
            setNotice(`本地空间已满，已移除 ${evicted} 条较早记录。`);
          }
        })
        .catch((storageError: unknown) => {
          setNotice(storageError instanceof Error ? storageError.message : "本地保存失败。");
        });
    }, 600);
    return () => window.clearTimeout(timeout);
  }, [hydrated, state, storage]);

  useEffect(() => {
    document.documentElement.dataset.theme = state.settings.theme;
  }, [state.settings.theme]);

  useEffect(() => {
    if (!window.matchMedia) return;
    const media = window.matchMedia("(max-width: 959px)");
    const update = () => setIsNarrow(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => () => {
    if (!diffClient) client.dispose();
  }, [client, diffClient]);

  const patchDraft = (patch: Partial<AppState["draft"]>, clearMergeUndo = false) => {
    if (clearMergeUndo) setMergeUndoStack([]);
    setState((current) => ({
      ...current,
      draft: {
        ...current.draft,
        ...patch,
        updatedAt: new Date().toISOString(),
      },
    }));
  };

  const runComparison = useCallback(async (
    draft = state.draft,
    navigation: ComparisonNavigation = {},
  ): Promise<DiffResult | null> => {
    const validationError = getValidationError(
      draft.leftText,
      draft.rightText,
      navigation.allowEmpty,
    );
    if (validationError) {
      setError(validationError);
      return null;
    }

    setError(null);
    setIsComparing(true);
    const sequence = comparisonSequence.current + 1;
    comparisonSequence.current = sequence;
    try {
      const nextResult = await client.compare(draft.leftText, draft.rightText, draft.options);
      if (comparisonSequence.current !== sequence) return null;
      const nextHunkIndex = nextResult.hunks.length
        ? Math.min(navigation.activeHunkIndex ?? 0, nextResult.hunks.length - 1)
        : 0;
      setResult(nextResult);
      setScreen("result");
      setActiveHunkIndex(nextHunkIndex);
      setMergePanelOpen(Boolean(navigation.keepMergePanelOpen && nextResult.hunks.length));
      setMobileSidebarOpen(false);
      return nextResult;
    } catch (comparisonError) {
      if (comparisonError instanceof Error && comparisonError.name === "AbortError") return null;
      if (comparisonSequence.current !== sequence) return null;
      setError(comparisonError instanceof Error ? comparisonError.message : "差异计算失败。");
      setScreen("input");
      return null;
    } finally {
      if (comparisonSequence.current === sequence) setIsComparing(false);
    }
  }, [client, state.draft]);

  const applyPendingCompare = useCallback(async () => {
    const pending = await consumePendingCompare();
    if (!pending) return;
    const draft = {
      ...state.draft,
      leftText: pending.leftText,
      rightText: pending.rightText,
      leftName: pending.leftName,
      rightName: pending.rightName,
      updatedAt: new Date().toISOString(),
    };
    setState((current) => ({ ...current, draft }));
    setMergeUndoStack([]);
    setMergePanelOpen(false);
    setScreen("input");
    if (pending.autoCompare) await runComparison(draft);
  }, [runComparison, state.draft]);

  useEffect(() => {
    if (!hydrated || initialPendingHandled.current) return;
    initialPendingHandled.current = true;
    void applyPendingCompare();
  }, [applyPendingCompare, hydrated]);

  useEffect(() => {
    if (typeof chrome === "undefined" || !chrome.runtime?.onMessage) return;
    const listener = (message: ExtensionMessage) => {
      if (message.type === "PENDING_COMPARE_READY") void applyPendingCompare();
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [applyPendingCompare]);

  const handleOptionsChange = (options: CompareOptions) => {
    const previous = state.draft.options;
    const draft = { ...state.draft, options, updatedAt: new Date().toISOString() };
    setState((current) => ({ ...current, draft }));

    const requiresRecompare =
      previous.granularity !== options.granularity ||
      previous.ignoreCase !== options.ignoreCase ||
      previous.ignoreWhitespace !== options.ignoreWhitespace ||
      previous.ignoreBlankLines !== options.ignoreBlankLines;
    if (result && requiresRecompare) {
      void runComparison(draft, {
        activeHunkIndex,
        keepMergePanelOpen: mergePanelOpen,
      });
    }
  };

  const handleSwap = () => {
    if (isComparing) return;
    const draft = {
      ...state.draft,
      leftText: state.draft.rightText,
      rightText: state.draft.leftText,
      leftName: state.draft.rightName,
      rightName: state.draft.leftName,
      updatedAt: new Date().toISOString(),
    };
    setMergeUndoStack([]);
    setMergePanelOpen(false);
    setState((current) => ({ ...current, draft }));
    if (result) void runComparison(draft);
  };

  const moveHunk = (direction: -1 | 1) => {
    if (!result?.hunks.length) return;
    setActiveHunkIndex((current) =>
      (current + direction + result.hunks.length) % result.hunks.length,
    );
  };

  const handleMerge = async (direction: MergeDirection) => {
    const hunk = result?.hunks[activeHunkIndex];
    if (!hunk || isComparing || mergeInFlight.current) return;

    let draft: AppState["draft"];
    try {
      draft = {
        ...applyHunkMerge(state.draft, hunk, direction),
        updatedAt: new Date().toISOString(),
      };
    } catch (mergeError) {
      setNotice(mergeError instanceof Error ? mergeError.message : "当前差异无法合并。");
      return;
    }

    const target = direction === "left-to-right" ? "right" : "left";
    const targetText = target === "right" ? draft.rightText : draft.leftText;
    const validation = validateText(targetText);
    if (!validation.valid) {
      setNotice(formatValidationError(target === "right" ? "更改后文本" : "原始文本", validation.reason));
      return;
    }

    const previousText = target === "right" ? state.draft.rightText : state.draft.leftText;
    if (targetText === previousText) {
      setNotice("当前差异无需合并。");
      return;
    }

    mergeInFlight.current = true;
    setMergeUndoStack((current) => pushMergeUndo(current, {
      target,
      previousText,
      hunkIndex: activeHunkIndex,
    }));
    setState((current) => ({ ...current, draft }));

    try {
      const nextResult = await runComparison(draft, {
        activeHunkIndex,
        keepMergePanelOpen: true,
        allowEmpty: true,
      });
      if (nextResult) {
        setNotice(nextResult.hunks.length
          ? `已将当前差异合并到${target === "right" ? "右侧" : "左侧"}。`
          : "合并完成，两侧文本已一致。");
      }
    } finally {
      mergeInFlight.current = false;
    }
  };

  const handleUndoMerge = async () => {
    const entry = mergeUndoStack.at(-1);
    if (!entry || isComparing || mergeInFlight.current) return;

    mergeInFlight.current = true;
    const draft = {
      ...state.draft,
      [entry.target === "left" ? "leftText" : "rightText"]: entry.previousText,
      updatedAt: new Date().toISOString(),
    };
    setMergeUndoStack((current) => current.slice(0, -1));
    setState((current) => ({ ...current, draft }));
    setNotice("已撤销最近一次合并。");
    try {
      await runComparison(draft, {
        activeHunkIndex: entry.hunkIndex,
        keepMergePanelOpen: true,
        allowEmpty: true,
      });
    } finally {
      mergeInFlight.current = false;
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        void runComparison();
      }
      if (
        screen === "result" &&
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        event.key.toLowerCase() === "z" &&
        mergeUndoStack.length > 0 &&
        !isEditableTarget(event.target)
      ) {
        event.preventDefault();
        void handleUndoMerge();
      }
      if (event.key === "Escape" && mergePanelOpen) {
        event.preventDefault();
        setMergePanelOpen(false);
      }
      if (event.altKey && event.key === "ArrowDown") {
        event.preventDefault();
        moveHunk(1);
      }
      if (event.altKey && event.key === "ArrowUp") {
        event.preventDefault();
        moveHunk(-1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const handleFileLoad = async (side: "left" | "right", file: File) => {
    if (file.size > 2 * 1024 * 1024) {
      setError(`${file.name} 超过 2 MB，无法导入。`);
      return;
    }
    const text = await file.text();
    if (text.slice(0, 8_192).includes("\0")) {
      setError(`${file.name} 不是可识别的文本文件。`);
      return;
    }
    setError(null);
    patchDraft(side === "left"
      ? { leftText: text, leftName: file.name }
      : { rightText: text, rightName: file.name }, true);
  };

  const handleSave = () => {
    if (!result || isComparing) return;
    const entry = createHistoryEntry({
      title: createComparisonTitle(state.draft.leftName, state.draft.rightName),
      leftName: state.draft.leftName,
      rightName: state.draft.rightName,
      leftText: state.draft.leftText,
      rightText: state.draft.rightText,
      options: state.draft.options,
      stats: {
        addedLines: result.stats.addedLines,
        removedLines: result.stats.removedLines,
        unchangedLines: result.stats.unchangedLines,
        hunks: result.stats.hunks,
      },
    });
    setState((current) => addHistoryEntry(current, entry));
    setNotice("比较已保存到本地历史。");
  };

  const handleRestoreHistory = (entry: HistoryEntry) => {
    const draft = {
      leftText: entry.leftText,
      rightText: entry.rightText,
      leftName: entry.leftName,
      rightName: entry.rightName,
      options: entry.options,
      updatedAt: new Date().toISOString(),
    };
    setState((current) => ({ ...current, draft }));
    setMergeUndoStack([]);
    setMergePanelOpen(false);
    setPanel("tools");
    void runComparison(draft);
  };

  const copyText = async (value: string, success: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(success);
    } catch {
      setNotice("复制失败，请检查剪贴板权限。");
    }
  };

  const patch = createUnifiedPatch(
    state.draft.leftName,
    state.draft.rightName,
    state.draft.leftText,
    state.draft.rightText,
  );

  const exportPatch = () => {
    if (isComparing) return;
    const blob = new Blob([patch], { type: "text/x-diff;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${safeFileStem(createComparisonTitle(state.draft.leftName, state.draft.rightName))}.patch`;
    link.click();
    URL.revokeObjectURL(url);
    setNotice("补丁文件已导出。");
  };

  const cycleTheme = () => {
    const order: ThemeMode[] = ["system", "light", "dark"];
    const next = order[(order.indexOf(state.settings.theme) + 1) % order.length] ?? "system";
    setState((current) => ({ ...current, settings: { ...current.settings, theme: next } }));
  };

  const toggleSidebar = () => {
    if (isNarrow) {
      setMobileSidebarOpen((open) => !open);
    } else {
      setState((current) => ({
        ...current,
        settings: {
          ...current.settings,
          sidebarCollapsed: !current.settings.sidebarCollapsed,
        },
      }));
    }
  };

  const sidebarHidden = !isNarrow && state.settings.sidebarCollapsed;
  const sidebarToggleLabel = isNarrow
    ? mobileSidebarOpen ? "关闭侧栏" : "打开侧栏"
    : sidebarHidden ? "展开侧栏" : "收起侧栏";
  const themeIcon = state.settings.theme === "dark"
    ? <Moon size={17} />
    : state.settings.theme === "light"
      ? <Sun size={17} />
      : <Monitor size={17} />;

  return (
    <div className={`app-shell ${sidebarHidden ? "sidebar-collapsed" : ""} ${mobileSidebarOpen ? "sidebar-mobile-open" : ""}`}>
      <header className="app-header">
        <div className="brand-cluster">
          <IconButton
            label={sidebarToggleLabel}
            className="sidebar-toggle"
            onClick={toggleSidebar}
          >
            {isNarrow ? <Menu size={18} /> : sidebarHidden ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </IconButton>
          <div className="brand-mark" aria-hidden="true"><span>T</span><span>D</span></div>
          <div className="brand-name"><strong>TextDiff</strong><span>文本对比</span></div>
        </div>
        <div className="header-status">
          <span className="privacy-badge"><ShieldCheck size={14} />离线</span>
          <IconButton label={`主题：${themeLabel(state.settings.theme)}`} onClick={cycleTheme}>
            {themeIcon}
          </IconButton>
        </div>
      </header>

      <ToolSidebar
        panel={panel}
        options={state.draft.options}
        history={state.history}
        activeHunkIndex={activeHunkIndex}
        hunkCount={result?.hunks.length ?? 0}
        onPanelChange={setPanel}
        onOptionsChange={handleOptionsChange}
        onPreviousHunk={() => moveHunk(-1)}
        onNextHunk={() => moveHunk(1)}
        onRestoreHistory={handleRestoreHistory}
        onRenameHistory={(id, title) => setState((current) => renameHistoryEntry(current, id, title))}
        onDeleteHistory={(id) => setState((current) => deleteHistoryEntry(current, id))}
        onClearHistory={() => setConfirmClearHistory(true)}
      />

      {mobileSidebarOpen && (
        <button
          type="button"
          className="sidebar-scrim"
          aria-label="点击背景关闭侧栏"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      <main className="main-workspace">
        {screen === "input" || !result ? (
          <InputWorkspace
            leftText={state.draft.leftText}
            rightText={state.draft.rightText}
            leftName={state.draft.leftName}
            rightName={state.draft.rightName}
            onLeftChange={(leftText) => patchDraft({ leftText }, true)}
            onRightChange={(rightText) => patchDraft({ rightText }, true)}
            onLeftNameChange={(leftName) => patchDraft({ leftName })}
            onRightNameChange={(rightName) => patchDraft({ rightName })}
            onCompare={() => void runComparison()}
            onSwap={handleSwap}
            onClear={() => {
              patchDraft({ leftText: "", rightText: "" }, true);
              setError(null);
            }}
            onFileLoad={(side, file) => void handleFileLoad(side, file)}
            isComparing={isComparing}
            error={error}
          />
        ) : (
          <section className="result-workspace">
            <ResultToolbar
              title={createComparisonTitle(state.draft.leftName, state.draft.rightName)}
              onEdit={() => setScreen("input")}
              onSwap={handleSwap}
              onCopyLeft={() => void copyText(state.draft.leftText, "原始文本已复制。")}
              onCopyRight={() => void copyText(state.draft.rightText, "更改后文本已复制。")}
              onCopyPatch={() => void copyText(patch, "补丁已复制。")}
              onSave={handleSave}
              onExport={exportPatch}
              canUndo={mergeUndoStack.length > 0 && !isComparing}
              onUndo={() => void handleUndoMerge()}
              busy={isComparing}
            />
            <DiffViewer
              result={result}
              viewMode={state.draft.options.viewMode}
              wrapLines={state.draft.options.wrapLines}
              activeHunkIndex={activeHunkIndex}
              mergePanelOpen={mergePanelOpen}
              isComparing={isComparing}
              onSelectHunk={(index) => {
                setActiveHunkIndex(index);
                setMergePanelOpen(true);
              }}
              onCloseMergePanel={() => setMergePanelOpen(false)}
              onPreviousHunk={() => moveHunk(-1)}
              onNextHunk={() => moveHunk(1)}
              onMerge={(direction) => void handleMerge(direction)}
            />
          </section>
        )}
      </main>

      {notice && (
        <button type="button" className="toast" role="status" onClick={() => setNotice(null)}>
          {notice}
        </button>
      )}

      <ConfirmDialog
        open={confirmClearHistory}
        title="清空全部历史？"
        message="保存的比较记录将从当前浏览器中移除。"
        confirmLabel="清空历史"
        onCancel={() => setConfirmClearHistory(false)}
        onConfirm={() => {
          setState((current) => ({ ...current, history: [] }));
          setConfirmClearHistory(false);
          setNotice("历史记录已清空。");
        }}
      />
    </div>
  );
}

function getValidationError(
  leftText: string,
  rightText: string,
  allowEmpty = false,
): string | null {
  if (!allowEmpty && !leftText && !rightText) return "请至少输入一侧文本。";
  const left = validateText(leftText);
  const right = validateText(rightText);
  if (!left.valid) return formatValidationError("原始文本", left.reason);
  if (!right.valid) return formatValidationError("更改后文本", right.reason);
  return null;
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

function formatValidationError(label: string, reason?: "bytes" | "lines"): string {
  return reason === "bytes"
    ? `${label}超过 2 MB，无法比较。`
    : `${label}超过 20,000 行，无法比较。`;
}

function createComparisonTitle(leftName: string, rightName: string): string {
  return `${baseName(leftName, "原始文本")} ↔ ${baseName(rightName, "更改后文本")}`;
}

function baseName(value: string, fallback: string): string {
  const name = value.trim().replace(/\.[^.]+$/u, "");
  return name || fallback;
}

function safeFileStem(value: string): string {
  return value.replace(/[\\/:*?"<>|]/gu, "-").replace(/\s+/gu, "-");
}

function themeLabel(theme: ThemeMode): string {
  return theme === "dark" ? "深色" : theme === "light" ? "浅色" : "跟随系统";
}
