import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Menu,
  Moon,
  Monitor,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  ShieldCheck,
  Sun,
} from "lucide-react";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { DiffViewer } from "./components/DiffViewer";
import { IconButton } from "./components/IconButton";
import { InputWorkspace } from "./components/InputWorkspace";
import { ResultToolbar } from "./components/ResultToolbar";
import { ToolSidebar } from "./components/ToolSidebar";
import { AiConsentDialog } from "./components/ai/AiConsentDialog";
import { AiResultDrawer, type AiRunStatus } from "./components/ai/AiResultDrawer";
import { AiSettingsDrawer } from "./components/ai/AiSettingsDrawer";
import { AiSetupWizard } from "./components/ai/AiSetupWizard";
import { SuggestionPreviewDialog } from "./components/ai/SuggestionPreviewDialog";
import { AiClient, type ChatMessage, type CompletionOptions } from "./ai/aiClient";
import {
  analyzeFullComparison,
  analyzeHunk,
  createFullTextAnalysisPlan,
} from "./ai/analysis";
import {
  completeAiOnboarding,
  createDefaultAiSettings,
  createDefaultAiStorageAdapter,
  deleteModelProfile,
  getModelSecret,
  loadAiSettings,
  saveModelProfile,
  setActiveModelProfile,
  type AiStorageAdapter,
} from "./ai/aiStorage";
import {
  createChromePermissionAdapter,
  ensureOriginPermission,
  getOriginPattern,
} from "./ai/permissions";
import {
  bindAiSuggestions,
  createAiHunkContexts,
  resolveSuggestionHunk,
  type BoundHunkSuggestion,
} from "./ai/suggestions";
import type {
  AiAnalysisResult,
  AiSettings,
  ModelConnectionResult,
  ModelListResult,
  ModelProfile,
} from "./ai/types";
import { createUnifiedPatch, validateText } from "./core/diffEngine";
import { DiffWorkerClient } from "./core/diffWorkerClient";
import { applyHunkMerge, applyHunkReplacement } from "./core/hunkMerge";
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

interface AiClientLike {
  listModels(
    profile: ModelProfile,
    apiKey: string,
    signal?: AbortSignal,
  ): Promise<ModelListResult>;
  complete(
    profile: ModelProfile,
    apiKey: string,
    messages: ChatMessage[],
    options?: CompletionOptions,
  ): Promise<string>;
  testConnection(
    profile: ModelProfile,
    apiKey: string,
    signal?: AbortSignal,
  ): Promise<ModelConnectionResult>;
}

interface AppProps {
  initialState?: AppState;
  storage?: StorageAdapter;
  diffClient?: DiffClient;
  initialAiSettings?: AiSettings;
  aiStorage?: AiStorageAdapter;
  aiClient?: AiClientLike;
}

interface ComparisonNavigation {
  activeHunkIndex?: number;
  keepMergePanelOpen?: boolean;
  allowEmpty?: boolean;
}

interface PendingAiAction {
  scope: "full" | "hunk";
  hunkIndex?: number;
  requestCount: number;
  requiresConsent: boolean;
}

interface SuggestionPreviewState {
  suggestion: BoundHunkSuggestion;
  leftText: string;
  rightText: string;
}

interface AiRunState {
  status: AiRunStatus;
  result: AiAnalysisResult | null;
  suggestions: BoundHunkSuggestion[];
  error: string | null;
}

function createEmptyAiRun(): AiRunState {
  return { status: "idle", result: null, suggestions: [], error: null };
}

export function App({
  initialState,
  storage: providedStorage,
  diffClient,
  initialAiSettings,
  aiStorage: providedAiStorage,
  aiClient: providedAiClient,
}: AppProps = {}) {
  const storage = useMemo(
    () => providedStorage ?? createDefaultStorageAdapter(),
    [providedStorage],
  );
  const client = useMemo(() => diffClient ?? new DiffWorkerClient(), [diffClient]);
  const aiStorage = useMemo(
    () => providedAiStorage ?? createDefaultAiStorageAdapter(),
    [providedAiStorage],
  );
  const aiClient = useMemo<AiClientLike>(
    () => providedAiClient ?? new AiClient(),
    [providedAiClient],
  );
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
  const [aiSettings, setAiSettings] = useState<AiSettings>(
    () => initialAiSettings ?? createDefaultAiSettings(),
  );
  const [aiHydrated, setAiHydrated] = useState(Boolean(initialAiSettings));
  const [secretProfileIds, setSecretProfileIds] = useState<Set<string>>(new Set());
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [aiOnboardingOpen, setAiOnboardingOpen] = useState(
    () => new URLSearchParams(window.location.search).get("setup") === "1",
  );
  const [aiDrawerOpen, setAiDrawerOpen] = useState(false);
  const [aiScope, setAiScope] = useState<"full" | "hunk">("full");
  const [aiRuns, setAiRuns] = useState<Record<"full" | "hunk", AiRunState>>(() => ({
    full: createEmptyAiRun(),
    hunk: createEmptyAiRun(),
  }));
  const [pendingAiAction, setPendingAiAction] = useState<PendingAiAction | null>(null);
  const [suggestionPreview, setSuggestionPreview] = useState<SuggestionPreviewState | null>(null);
  const [pendingDeleteProfileId, setPendingDeleteProfileId] = useState<string | null>(null);
  const initialPendingHandled = useRef(false);
  const mergeInFlight = useRef(false);
  const comparisonSequence = useRef(0);
  const aiAbortController = useRef<AbortController | null>(null);
  const aiRunningScope = useRef<"full" | "hunk" | null>(null);

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
    if (initialAiSettings) return;
    let current = true;
    void loadAiSettings(aiStorage).then((loaded) => {
      if (!current) return;
      setAiSettings(loaded);
      if (loaded.onboardingCompleted) setAiOnboardingOpen(false);
      setAiHydrated(true);
    });
    return () => { current = false; };
  }, [aiStorage, initialAiSettings]);

  useEffect(() => {
    if (!aiHydrated) return;
    let current = true;
    void Promise.all(aiSettings.profiles.map(async (profile) => ({
      id: profile.id,
      hasSecret: Boolean(await getModelSecret(profile, aiStorage)),
    }))).then((profiles) => {
      if (!current) return;
      setSecretProfileIds(new Set(profiles.filter((profile) => profile.hasSecret).map((profile) => profile.id)));
    });
    return () => { current = false; };
  }, [aiHydrated, aiSettings.profiles, aiStorage]);

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
    aiAbortController.current?.abort();
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

  const activeAiProfile = aiSettings.profiles.find(
    (profile) => profile.id === aiSettings.activeProfileId,
  ) ?? null;
  const activeAiRun = aiRuns[aiScope];
  const aiBusy = aiRuns.full.status === "loading" || aiRuns.hunk.status === "loading";

  const updateAiRun = (scope: "full" | "hunk", patch: Partial<AiRunState>) => {
    setAiRuns((current) => ({
      ...current,
      [scope]: { ...current[scope], ...patch },
    }));
  };

  const resolveAiSecret = async (profile: ModelProfile, provided?: string) => {
    const secret = provided?.trim() || await getModelSecret(profile, aiStorage);
    if (!secret) throw new Error("该模型尚未保存 API 密钥，请先编辑配置。");
    return secret;
  };

  const handleTestAiProfile = async (
    profile: ModelProfile,
    apiKey?: string,
  ): Promise<ModelConnectionResult> => {
    const secret = await resolveAiSecret(profile, apiKey);
    return aiClient.testConnection(profile, secret);
  };

  const handleListAiModels = async (
    profile: ModelProfile,
    apiKey?: string,
  ): Promise<ModelListResult> => {
    const secret = await resolveAiSecret(profile, apiKey);
    return aiClient.listModels(profile, secret);
  };

  const handleSaveAiProfile = async (profile: ModelProfile, apiKey?: string) => {
    if (!await ensureOriginPermission(profile.baseUrl, createChromePermissionAdapter())) {
      throw new Error("未获得该模型服务地址的访问权限。");
    }
    const next = await saveModelProfile(aiSettings, profile, apiKey, aiStorage);
    setAiSettings(next);
    if (apiKey?.trim()) {
      setSecretProfileIds((current) => new Set(current).add(profile.id));
    }
    setNotice(`模型配置“${profile.name}”已保存。`);
  };

  const finishAiOnboarding = () => {
    setAiOnboardingOpen(false);
    const url = new URL(window.location.href);
    url.searchParams.delete("setup");
    window.history.replaceState(null, "", url);
  };

  const handleCompleteAiOnboarding = async (profile: ModelProfile, apiKey?: string) => {
    if (!await ensureOriginPermission(profile.baseUrl, createChromePermissionAdapter())) {
      throw new Error("未获得该模型服务地址的访问权限。");
    }
    let next = await saveModelProfile(aiSettings, profile, apiKey, aiStorage);
    next = await completeAiOnboarding(next, aiStorage);
    setAiSettings(next);
    setSecretProfileIds((current) => new Set(current).add(profile.id));
    finishAiOnboarding();
    setNotice("AI 模型已配置，可从比较结果开始分析。");
  };

  const handleSkipAiOnboarding = async () => {
    const next = await completeAiOnboarding(aiSettings, aiStorage);
    setAiSettings(next);
    finishAiOnboarding();
  };

  const handleSetActiveAiProfile = async (profileId: string) => {
    try {
      const next = await setActiveModelProfile(aiSettings, profileId, aiStorage);
      setAiSettings(next);
      aiAbortController.current?.abort();
      setAiRuns({ full: createEmptyAiRun(), hunk: createEmptyAiRun() });
    } catch (profileError) {
      setNotice(profileError instanceof Error ? profileError.message : "无法切换模型配置。");
    }
  };

  const handleDeleteAiProfile = async (profileId: string) => {
    const profile = aiSettings.profiles.find((item) => item.id === profileId);
    if (!profile) return;
    try {
      if (aiSettings.activeProfileId === profileId) {
        aiAbortController.current?.abort();
        aiAbortController.current = null;
        aiRunningScope.current = null;
        setAiRuns({ full: createEmptyAiRun(), hunk: createEmptyAiRun() });
      }
      const next = await deleteModelProfile(aiSettings, profileId, aiStorage);
      setAiSettings(next);
      setSecretProfileIds((current) => {
        const ids = new Set(current);
        ids.delete(profileId);
        return ids;
      });
      const origin = new URL(profile.baseUrl).origin;
      if (!next.profiles.some((item) => new URL(item.baseUrl).origin === origin)) {
        await createChromePermissionAdapter().remove({ origins: [getOriginPattern(profile.baseUrl)] });
      }
      if (next.profiles.length === 0) {
        aiAbortController.current?.abort();
        setAiDrawerOpen(false);
      }
      setNotice(`模型配置“${profile.name}”已删除。`);
    } catch (deleteError) {
      setNotice(deleteError instanceof Error ? deleteError.message : "模型配置删除失败。");
    } finally {
      setPendingDeleteProfileId(null);
    }
  };

  const executeAiAction = async (
    action: PendingAiAction,
    profile: ModelProfile,
  ) => {
    if (!result) return;
    const resultSnapshot = result;
    const draftSnapshot = state.draft;
    let secret: string;
    try {
      secret = await resolveAiSecret(profile);
    } catch (secretError) {
      setNotice(secretError instanceof Error ? secretError.message : "缺少 API 密钥。");
      setAiSettingsOpen(true);
      return;
    }

    aiAbortController.current?.abort();
    const controller = new AbortController();
    aiAbortController.current = controller;
    aiRunningScope.current = action.scope;
    setAiScope(action.scope);
    setAiDrawerOpen(true);
    updateAiRun(action.scope, {
      status: "loading",
      error: null,
      result: null,
      suggestions: [],
    });

    try {
      const contexts = createAiHunkContexts(resultSnapshot);
      let analysis: AiAnalysisResult;
      if (action.scope === "full") {
        analysis = await analyzeFullComparison(aiClient, profile, secret, {
            leftText: draftSnapshot.leftText,
            rightText: draftSnapshot.rightText,
            leftName: draftSnapshot.leftName,
            rightName: draftSnapshot.rightName,
            hunks: contexts,
          }, controller.signal);
      } else {
        const context = contexts[action.hunkIndex ?? activeHunkIndex];
        if (!context) throw new Error("当前差异块已失效，请重新选择后再分析。");
        analysis = await analyzeHunk(aiClient, profile, secret, {
          ...context,
          leftName: draftSnapshot.leftName,
          rightName: draftSnapshot.rightName,
          options: draftSnapshot.options,
        }, controller.signal);
      }
      if (aiAbortController.current !== controller) return;
      updateAiRun(action.scope, {
        result: analysis,
        suggestions: bindAiSuggestions(resultSnapshot, analysis.suggestions),
        status: "success",
      });
    } catch (analysisError) {
      if (aiAbortController.current !== controller) return;
      const code = analysisError && typeof analysisError === "object"
        ? (analysisError as { code?: string }).code
        : undefined;
      if (code === "CANCELLED") {
        updateAiRun(action.scope, { status: "idle" });
      } else {
        updateAiRun(action.scope, {
          error: analysisError instanceof Error ? analysisError.message : "AI 分析失败。",
          status: "error",
        });
      }
    } finally {
      if (aiAbortController.current === controller) {
        aiAbortController.current = null;
        aiRunningScope.current = null;
      }
    }
  };

  const prepareAiAction = async (scope: "full" | "hunk") => {
    if (!result) return;
    if (!activeAiProfile) {
      setNotice("请先配置一个 AI 模型。");
      setAiSettingsOpen(true);
      return;
    }
    if (!await getModelSecret(activeAiProfile, aiStorage)) {
      setNotice("当前模型缺少 API 密钥，请先编辑配置。");
      setAiSettingsOpen(true);
      return;
    }

    let requestCount = 1;
    try {
      if (scope === "full") {
        requestCount = createFullTextAnalysisPlan(
          state.draft.leftText,
          state.draft.rightText,
        ).requestCount;
      }
    } catch (planError) {
      setNotice(planError instanceof Error ? planError.message : "当前文本无法进行全文 AI 分析。");
      return;
    }
    const requiresConsent = activeAiProfile.consentedOrigin !== new URL(activeAiProfile.baseUrl).origin;
    const action: PendingAiAction = {
      scope,
      hunkIndex: scope === "hunk" ? activeHunkIndex : undefined,
      requestCount,
      requiresConsent,
    };
    if (requiresConsent || requestCount > 1) {
      setPendingAiAction(action);
    } else {
      await executeAiAction(action, activeAiProfile);
    }
  };

  const confirmAiAction = async () => {
    if (!pendingAiAction || !activeAiProfile) return;
    let profile = activeAiProfile;
    if (pendingAiAction.requiresConsent) {
      profile = {
        ...activeAiProfile,
        consentedOrigin: new URL(activeAiProfile.baseUrl).origin,
        consentedAt: new Date().toISOString(),
      };
      const next = await saveModelProfile(aiSettings, profile, undefined, aiStorage);
      setAiSettings(next);
    }
    const action = pendingAiAction;
    setPendingAiAction(null);
    await executeAiAction(action, profile);
  };

  const cancelAiAnalysis = () => {
    const scope = aiRunningScope.current ?? aiScope;
    aiAbortController.current?.abort();
    aiAbortController.current = null;
    aiRunningScope.current = null;
    updateAiRun(scope, { status: "idle" });
  };

  const previewAiSuggestion = (suggestion: BoundHunkSuggestion) => {
    if (!result) return;
    const resolved = resolveSuggestionHunk(result, suggestion);
    if (!resolved) {
      setNotice("该建议已过期，请重新生成 AI 分析。");
      return;
    }
    const context = createAiHunkContexts(result)[resolved.index];
    if (!context) return;
    setSuggestionPreview({
      suggestion,
      leftText: context.leftText,
      rightText: context.rightText,
    });
  };

  const applyAiSuggestion = async (target: "left" | "right") => {
    if (!suggestionPreview || !result || suggestionPreview.suggestion.replacementText === undefined) return;
    const resolved = resolveSuggestionHunk(result, suggestionPreview.suggestion);
    if (!resolved) {
      setSuggestionPreview(null);
      setNotice("该建议已过期，请重新生成 AI 分析。");
      return;
    }
    const draft = {
      ...applyHunkReplacement(
        state.draft,
        resolved.hunk,
        target,
        suggestionPreview.suggestion.replacementText,
      ),
      updatedAt: new Date().toISOString(),
    };
    const targetText = target === "left" ? draft.leftText : draft.rightText;
    const validation = validateText(targetText);
    if (!validation.valid) {
      setNotice(formatValidationError(target === "left" ? "原始文本" : "更改后文本", validation.reason));
      return;
    }
    const previousText = target === "left" ? state.draft.leftText : state.draft.rightText;
    setMergeUndoStack((current) => pushMergeUndo(current, {
      target,
      previousText,
      hunkIndex: resolved.index,
    }));
    setState((current) => ({ ...current, draft }));
    setSuggestionPreview(null);
    await runComparison(draft, {
      activeHunkIndex: resolved.index,
      keepMergePanelOpen: true,
      allowEmpty: true,
    });
    setNotice(`AI 建议已应用到${target === "left" ? "左侧" : "右侧"}，可使用撤销恢复。`);
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
      const blocksPlainHunkNavigation =
        aiSettingsOpen ||
        aiOnboardingOpen ||
        aiDrawerOpen ||
        Boolean(pendingAiAction) ||
        Boolean(suggestionPreview) ||
        confirmClearHistory ||
        Boolean(pendingDeleteProfileId);
      if (
        screen === "result" &&
        mergePanelOpen &&
        !isComparing &&
        !blocksPlainHunkNavigation &&
        !event.defaultPrevented &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey &&
        !isEditableTarget(event.target) &&
        (event.key === "ArrowUp" || event.key === "ArrowDown")
      ) {
        event.preventDefault();
        moveHunk(event.key === "ArrowUp" ? -1 : 1);
        return;
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
  const displayedAiSuggestions = activeAiRun.suggestions.map((suggestion) => ({
    suggestion,
    stale: !result || !resolveSuggestionHunk(result, suggestion),
  }));
  const profilePendingDelete = aiSettings.profiles.find(
    (profile) => profile.id === pendingDeleteProfileId,
  );

  return (
    <div className={`app-shell ${sidebarHidden ? "sidebar-collapsed" : ""} ${mobileSidebarOpen ? "sidebar-mobile-open" : ""} ${aiDrawerOpen ? "ai-drawer-open" : ""}`}>
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
          <span className="privacy-badge" title={activeAiProfile ? "本地比较；仅在点击 AI 功能时发送指定文本" : "全部功能仅在本地处理"}>
            <ShieldCheck size={14} />{activeAiProfile ? "本地比较 · AI 按需" : "离线"}
          </span>
          <IconButton label="AI 模型设置" onClick={() => setAiSettingsOpen(true)}>
            <Settings size={17} />
          </IconButton>
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
              onCopyPatch={() => void copyText(patch, "补丁已复制。")}
              onSave={handleSave}
              onExport={exportPatch}
              canUndo={mergeUndoStack.length > 0 && !isComparing}
              onUndo={() => void handleUndoMerge()}
              busy={isComparing || aiBusy}
              aiBusy={aiBusy}
              onAiAnalyze={() => void prepareAiAction("full")}
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
              aiBusy={aiBusy}
              onExplainAi={() => void prepareAiAction("hunk")}
              onCopyLeft={() => void copyText(state.draft.leftText, "原始文本已复制。")}
              onCopyRight={() => void copyText(state.draft.rightText, "更改后文本已复制。")}
            />
          </section>
        )}
      </main>

      <AiResultDrawer
        open={aiDrawerOpen}
        scope={aiScope}
        status={activeAiRun.status}
        result={activeAiRun.result}
        suggestions={displayedAiSuggestions}
        profiles={aiSettings.profiles}
        activeProfileId={aiSettings.activeProfileId}
        error={activeAiRun.error}
        onScopeChange={setAiScope}
        onModelChange={(profileId) => void handleSetActiveAiProfile(profileId)}
        onRegenerate={() => void prepareAiAction(aiScope)}
        onCancel={cancelAiAnalysis}
        onClose={() => {
          if (aiBusy) cancelAiAnalysis();
          setAiDrawerOpen(false);
        }}
        onPreviewSuggestion={previewAiSuggestion}
      />

      <AiSettingsDrawer
        open={aiSettingsOpen}
        settings={aiSettings}
        secretProfileIds={secretProfileIds}
        onClose={() => setAiSettingsOpen(false)}
        onSave={handleSaveAiProfile}
        onListModels={handleListAiModels}
        onTest={handleTestAiProfile}
        onSetActive={(profileId) => void handleSetActiveAiProfile(profileId)}
        onDelete={setPendingDeleteProfileId}
      />

      <AiSetupWizard
        open={aiHydrated && aiOnboardingOpen}
        onSkip={() => void handleSkipAiOnboarding()}
        onListModels={handleListAiModels}
        onTest={handleTestAiProfile}
        onComplete={handleCompleteAiOnboarding}
      />

      {pendingAiAction && activeAiProfile && (
        <AiConsentDialog
          open
          profile={activeAiProfile}
          scope={pendingAiAction.scope}
          requestCount={pendingAiAction.requestCount}
          requiresConsent={pendingAiAction.requiresConsent}
          onCancel={() => setPendingAiAction(null)}
          onConfirm={() => void confirmAiAction()}
        />
      )}

      {suggestionPreview && (
        <SuggestionPreviewDialog
          open
          suggestion={suggestionPreview.suggestion}
          leftText={suggestionPreview.leftText}
          rightText={suggestionPreview.rightText}
          options={state.draft.options}
          onCancel={() => setSuggestionPreview(null)}
          onApply={(target) => void applyAiSuggestion(target)}
        />
      )}

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
      <ConfirmDialog
        open={Boolean(profilePendingDelete)}
        title="删除模型配置？"
        message={profilePendingDelete
          ? `“${profilePendingDelete.name}”的配置和本地密钥将被移除。`
          : "模型配置和本地密钥将被移除。"}
        confirmLabel="删除模型"
        onCancel={() => setPendingDeleteProfileId(null)}
        onConfirm={() => {
          if (pendingDeleteProfileId) void handleDeleteAiProfile(pendingDeleteProfileId);
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
