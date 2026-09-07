import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { computeDiff } from "../src/core/diffEngine";
import { createDefaultAppState, type StorageAdapter } from "../src/core/storage";
import type { DiffResult } from "../src/core/types";

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
});
