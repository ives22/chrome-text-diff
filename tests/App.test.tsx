import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { computeDiff } from "../src/core/diffEngine";
import { createDefaultAppState, type StorageAdapter } from "../src/core/storage";
import type { DiffResult } from "../src/core/types";
import {
  createDefaultAiSettings,
  saveModelProfile,
  type AiStorageAdapter,
  type StorageArea,
} from "../src/ai/aiStorage";
import type { ModelProfile } from "../src/ai/types";

vi.mock("@uiw/react-codemirror", () => ({
  default: ({ value, onChange, "aria-label": ariaLabel }: {
    value: string;
    onChange: (value: string) => void;
    "aria-label": string;
  }) => (
    <textarea
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

const result: DiffResult = {
  stats: {
    addedUnits: 1,
    removedUnits: 1,
    addedLines: 1,
    removedLines: 1,
    unchangedLines: 0,
    hunks: 1,
  },
  hunks: [{
    id: "hunk-1",
    rowStart: 0,
    rowEnd: 0,
    leftRange: { from: 0, to: 1 },
    rightRange: { from: 0, to: 1 },
  }],
  rows: [
    {
      id: "row-1",
      kind: "change",
      hunkId: "hunk-1",
      left: { lineNumber: 1, text: "alpha" },
      right: { lineNumber: 1, text: "beta" },
    },
  ],
};

class MemoryStorage implements StorageAdapter {
  data: Record<string, unknown> = {};
  async get(key: string) { return { [key]: this.data[key] }; }
  async set(items: Record<string, unknown>) { Object.assign(this.data, items); }
}

class AiMemoryArea implements StorageArea {
  data: Record<string, unknown> = {};
  async get(key: string) { return { [key]: this.data[key] }; }
  async set(items: Record<string, unknown>) { Object.assign(this.data, items); }
  async remove(key: string) { delete this.data[key]; }
}

function createAiStorage(): AiStorageAdapter {
  return { local: new AiMemoryArea(), session: new AiMemoryArea() };
}

describe("App", () => {
  it("compares editor content, switches view, and saves the result to history", async () => {
    const user = userEvent.setup();
    const diffClient = {
      compare: vi.fn().mockResolvedValue(result),
      cancel: vi.fn(),
      dispose: vi.fn(),
    };

    render(
      <App
        initialState={createDefaultAppState()}
        storage={new MemoryStorage()}
        diffClient={diffClient}
      />,
    );

    await user.type(screen.getByLabelText("原始文本内容"), "alpha");
    await user.type(screen.getByLabelText("更改后文本内容"), "beta");
    await user.click(screen.getByRole("button", { name: "查找差异" }));

    expect(await screen.findByRole("region", { name: "差异结果" })).toBeInTheDocument();
    expect(diffClient.compare).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "统一视图" }));
    expect(screen.getByLabelText("删除第 1 行")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "保存比较" }));
    await user.click(screen.getByRole("tab", { name: "历史" }));
    expect(screen.getByRole("button", { name: /打开 原始文本 ↔ 更改后文本/ })).toBeInTheDocument();
  });

  it("announces the mobile sidebar action according to its open state", async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 768 });

    render(
      <App
        initialState={createDefaultAppState()}
        storage={new MemoryStorage()}
      />,
    );

    const openButton = screen.getByRole("button", { name: "打开侧栏" });
    await user.click(openButton);
    expect(screen.getByRole("button", { name: "关闭侧栏" })).toBeInTheDocument();

    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
  });

  it("merges one selected hunk, recomputes, and restores it with undo", async () => {
    const user = userEvent.setup();
    const initialState = createDefaultAppState();
    initialState.draft = {
      ...initialState.draft,
      leftText: "alpha",
      rightText: "beta",
      leftName: "before.txt",
      rightName: "after.txt",
    };
    const diffClient = {
      compare: vi.fn(async (leftText, rightText, options) =>
        computeDiff(leftText, rightText, options)),
      cancel: vi.fn(),
      dispose: vi.fn(),
    };

    render(
      <App
        initialState={initialState}
        storage={new MemoryStorage()}
        diffClient={diffClient}
      />,
    );

    await user.click(screen.getByRole("button", { name: "查找差异" }));
    await user.click(await screen.findByRole("button", { name: "选择第 1 处差异进行合并" }));
    await user.click(screen.getByRole("button", { name: "合并到右侧" }));

    await waitFor(() => expect(diffClient.compare).toHaveBeenCalledTimes(2));
    expect(screen.getByText("0 处差异")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "撤销最近一次合并" })).toBeEnabled();

    await user.click(screen.getByRole("tab", { name: "历史" }));
    expect(screen.getByText("暂无历史记录")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "撤销最近一次合并" }));
    await waitFor(() => expect(diffClient.compare).toHaveBeenCalledTimes(3));
    expect(screen.getByText("1 处差异")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "编辑输入" }));
    expect(screen.getByLabelText("原始文本内容")).toHaveValue("alpha");
    expect(screen.getByLabelText("更改后文本内容")).toHaveValue("beta");
  });

  it("merges right to left and closes the inline controls with Escape", async () => {
    const user = userEvent.setup();
    const initialState = createDefaultAppState();
    initialState.draft = { ...initialState.draft, leftText: "alpha", rightText: "beta" };
    const diffClient = {
      compare: vi.fn(async (leftText, rightText, options) =>
        computeDiff(leftText, rightText, options)),
      cancel: vi.fn(),
      dispose: vi.fn(),
    };

    render(<App initialState={initialState} storage={new MemoryStorage()} diffClient={diffClient} />);
    await user.click(screen.getByRole("button", { name: "查找差异" }));
    await user.click(await screen.findByRole("button", { name: "选择第 1 处差异进行合并" }));
    expect(screen.getByRole("group", { name: "当前差异操作" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("group", { name: "当前差异操作" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "选择第 1 处差异进行合并" }));
    await user.click(screen.getByRole("button", { name: "合并到左侧" }));
    await waitFor(() => expect(diffClient.compare).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole("button", { name: "编辑输入" }));
    expect(screen.getByLabelText("原始文本内容")).toHaveValue("beta");
    expect(screen.getByLabelText("更改后文本内容")).toHaveValue("beta");
  });

  it("navigates an open merge panel with plain arrow keys without hijacking controls or modifiers", async () => {
    const user = userEvent.setup();
    const initialState = createDefaultAppState();
    initialState.draft = {
      ...initialState.draft,
      leftText: "old-one\nstable\nold-two",
      rightText: "new-one\nstable\nnew-two",
    };
    const diffClient = {
      compare: vi.fn(async (leftText, rightText, options) =>
        computeDiff(leftText, rightText, options)),
      cancel: vi.fn(),
      dispose: vi.fn(),
    };

    render(<App initialState={initialState} storage={new MemoryStorage()} diffClient={diffClient} />);
    await user.click(screen.getByRole("button", { name: "查找差异" }));
    await user.click(await screen.findByRole("button", { name: "选择第 1 处差异进行合并" }));
    expect(screen.getByRole("group", { name: "当前差异操作" })).toHaveTextContent("更改 1 / 2");

    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("group", { name: "当前差异操作" })).toHaveTextContent("更改 2 / 2");
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("group", { name: "当前差异操作" })).toHaveTextContent("更改 1 / 2");

    await user.keyboard("{Alt>}{ArrowDown}{/Alt}");
    expect(screen.getByRole("group", { name: "当前差异操作" })).toHaveTextContent("更改 2 / 2");
    await user.keyboard("{Shift>}{ArrowUp}{/Shift}");
    expect(screen.getByRole("group", { name: "当前差异操作" })).toHaveTextContent("更改 2 / 2");

    await user.click(screen.getByRole("button", { name: "AI 模型设置" }));
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("group", { name: "当前差异操作" })).toHaveTextContent("更改 2 / 2");
    await user.click(screen.getByRole("button", { name: "关闭 AI 模型设置" }));

    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("group", { name: "当前差异操作" })).toHaveTextContent("更改 2 / 2");
    input.remove();
  });

  it("supports the undo shortcut and clears merge undo after manual editing", async () => {
    const user = userEvent.setup();
    const initialState = createDefaultAppState();
    initialState.draft = { ...initialState.draft, leftText: "alpha", rightText: "beta" };
    const diffClient = {
      compare: vi.fn(async (leftText, rightText, options) =>
        computeDiff(leftText, rightText, options)),
      cancel: vi.fn(),
      dispose: vi.fn(),
    };

    render(<App initialState={initialState} storage={new MemoryStorage()} diffClient={diffClient} />);
    await user.click(screen.getByRole("button", { name: "查找差异" }));
    await user.click(await screen.findByRole("button", { name: "选择第 1 处差异进行合并" }));
    await user.click(screen.getByRole("button", { name: "合并到右侧" }));
    await waitFor(() => expect(diffClient.compare).toHaveBeenCalledTimes(2));

    await user.keyboard("{Control>}z{/Control}");
    await waitFor(() => expect(diffClient.compare).toHaveBeenCalledTimes(3));
    expect(screen.getByText("1 处差异")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "合并到右侧" }));
    await waitFor(() => expect(diffClient.compare).toHaveBeenCalledTimes(4));
    await user.click(screen.getByRole("button", { name: "编辑输入" }));
    await user.type(screen.getByLabelText("原始文本内容"), "!");
    await user.click(screen.getByRole("button", { name: "查找差异" }));
    await waitFor(() => expect(diffClient.compare).toHaveBeenCalledTimes(5));
    expect(screen.getByRole("button", { name: "撤销最近一次合并" })).toBeDisabled();
  });

  it("rejects a merge that would exceed the line limit without changing the draft", async () => {
    const user = userEvent.setup();
    const leftText = Array.from({ length: 12_000 }, () => "").join("\n");
    const rightText = ["old", ...Array.from({ length: 8_999 }, () => "")].join("\n");
    const initialState = createDefaultAppState();
    initialState.draft = { ...initialState.draft, leftText, rightText };
    const largeHunkResult: DiffResult = {
      stats: {
        addedUnits: 1,
        removedUnits: 1,
        addedLines: 1,
        removedLines: 12_000,
        unchangedLines: 0,
        hunks: 1,
      },
      hunks: [{
        id: "hunk-1",
        rowStart: 0,
        rowEnd: 0,
        leftRange: { from: 0, to: 12_000 },
        rightRange: { from: 0, to: 1 },
      }],
      rows: [{
        id: "row-1",
        kind: "change",
        hunkId: "hunk-1",
        left: { lineNumber: 1, text: "" },
        right: { lineNumber: 1, text: "old" },
      }],
    };
    const diffClient = {
      compare: vi.fn().mockResolvedValue(largeHunkResult),
      cancel: vi.fn(),
      dispose: vi.fn(),
    };

    render(<App initialState={initialState} storage={new MemoryStorage()} diffClient={diffClient} />);
    await user.click(screen.getByRole("button", { name: "查找差异" }));
    await user.click(await screen.findByRole("button", { name: "选择第 1 处差异进行合并" }));
    await user.click(screen.getByRole("button", { name: "合并到右侧" }));

    expect(await screen.findByRole("status")).toHaveTextContent("更改后文本超过 20,000 行，无法比较。");
    expect(diffClient.compare).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "撤销最近一次合并" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "编辑输入" }));
    expect(screen.getByLabelText("更改后文本内容")).toHaveValue(rightText);
  });

  it("analyzes a full comparison, confirms first transmission, and applies a previewed suggestion", async () => {
    const user = userEvent.setup();
    const initialState = createDefaultAppState();
    initialState.draft = { ...initialState.draft, leftText: "old", rightText: "new" };
    const profile: ModelProfile = {
      id: "profile-1",
      name: "测试模型",
      provider: "custom",
      baseUrl: "https://models.example.com/v1",
      model: "test-chat",
      rememberApiKey: false,
    };
    const aiStorage = createAiStorage();
    const initialAiSettings = await saveModelProfile(
      createDefaultAiSettings(),
      profile,
      "sk-test",
      aiStorage,
    );
    const diffClient = {
      compare: vi.fn(async (leftText, rightText, options) => computeDiff(leftText, rightText, options)),
      cancel: vi.fn(),
      dispose: vi.fn(),
    };
    const aiClient = {
      listModels: vi.fn(),
      testConnection: vi.fn(),
      complete: vi.fn().mockResolvedValue(JSON.stringify({
        summary: "值发生变化。",
        risks: ["确认业务语义"],
        suggestions: [{
          hunkId: "hunk-1",
          explanation: "建议统一为 resolved。",
          replacementText: "resolved",
          recommendedTarget: "right",
        }],
      })),
    };

    render(
      <App
        initialState={initialState}
        storage={new MemoryStorage()}
        diffClient={diffClient}
        initialAiSettings={initialAiSettings}
        aiStorage={aiStorage}
        aiClient={aiClient}
      />,
    );
    await user.click(screen.getByRole("button", { name: "查找差异" }));
    await user.click(await screen.findByRole("button", { name: "AI 分析本次比较" }));
    expect(screen.getByRole("dialog", { name: "发送至模型服务？" })).toHaveTextContent("左右完整文本");
    await user.click(screen.getByRole("button", { name: "确认发送" }));

    expect(await screen.findByText("值发生变化。")).toBeInTheDocument();
    expect(aiClient.complete).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "预览 hunk-1 的建议" }));
    expect(screen.getByRole("dialog", { name: "预览 AI 修改建议" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "确认应用到右侧" }));

    await waitFor(() => expect(diffClient.compare).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: "撤销最近一次合并" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "编辑输入" }));
    expect(screen.getByLabelText("原始文本内容")).toHaveValue("old");
    expect(screen.getByLabelText("更改后文本内容")).toHaveValue("resolved");
  });

  it("sends only the selected hunk through the inline AI explanation action", async () => {
    const user = userEvent.setup();
    const initialState = createDefaultAppState();
    initialState.draft = {
      ...initialState.draft,
      leftText: "unchanged-head\nold-value\nunchanged-tail",
      rightText: "unchanged-head\nnew-value\nunchanged-tail",
    };
    const profile: ModelProfile = {
      id: "profile-1",
      name: "测试模型",
      provider: "custom",
      baseUrl: "https://models.example.com/v1",
      model: "test-chat",
      rememberApiKey: false,
      consentedOrigin: "https://models.example.com",
      consentedAt: "2026-09-07T00:00:00.000Z",
    };
    const aiStorage = createAiStorage();
    const initialAiSettings = await saveModelProfile(
      createDefaultAiSettings(),
      profile,
      "sk-test",
      aiStorage,
    );
    const diffClient = {
      compare: vi.fn(async (leftText, rightText, options) => computeDiff(leftText, rightText, options)),
      cancel: vi.fn(),
      dispose: vi.fn(),
    };
    const aiClient = {
      listModels: vi.fn(),
      testConnection: vi.fn(),
      complete: vi.fn().mockResolvedValue(JSON.stringify({
        summary: "当前值发生变化。",
        risks: [],
        suggestions: [],
      })),
    };

    render(
      <App
        initialState={initialState}
        storage={new MemoryStorage()}
        diffClient={diffClient}
        initialAiSettings={initialAiSettings}
        aiStorage={aiStorage}
        aiClient={aiClient}
      />,
    );
    await user.click(screen.getByRole("button", { name: "查找差异" }));
    await user.click(await screen.findByRole("button", { name: "选择第 1 处差异进行合并" }));
    await user.click(screen.getByRole("button", { name: "AI 解释当前差异" }));
    expect(await screen.findByText("当前值发生变化。")).toBeInTheDocument();

    const messages = aiClient.complete.mock.calls[0]?.[2];
    expect(JSON.stringify(messages)).toContain("old-value");
    expect(JSON.stringify(messages)).toContain("new-value");
    expect(JSON.stringify(messages)).not.toContain("unchanged-head");
    expect(JSON.stringify(messages)).not.toContain("unchanged-tail");
  });
});
