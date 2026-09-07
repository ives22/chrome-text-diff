import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DiffViewer } from "../src/components/DiffViewer";
import { HistoryPanel } from "../src/components/HistoryPanel";
import { InputWorkspace } from "../src/components/InputWorkspace";
import { createHistoryEntry } from "../src/core/storage";
import { DEFAULT_COMPARE_OPTIONS, type DiffResult } from "../src/core/types";

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
    unchangedLines: 1,
    hunks: 1,
  },
  hunks: [{
    id: "hunk-1",
    rowStart: 1,
    rowEnd: 1,
    leftRange: { from: 1, to: 2 },
    rightRange: { from: 1, to: 2 },
  }],
  rows: [
    {
      id: "row-1",
      kind: "equal",
      left: { lineNumber: 1, text: "alpha" },
      right: { lineNumber: 1, text: "alpha" },
    },
    {
      id: "row-2",
      hunkId: "hunk-1",
      kind: "change",
      left: {
        lineNumber: 2,
        text: "beta",
        segments: [
          { type: "equal", value: "b" },
          { type: "remove", value: "eta" },
        ],
      },
      right: {
        lineNumber: 2,
        text: "bravo",
        segments: [
          { type: "equal", value: "b" },
          { type: "add", value: "ravo" },
        ],
      },
    },
  ],
};

const viewerActions = {
  mergePanelOpen: false,
  isComparing: false,
  onSelectHunk: vi.fn(),
  onCloseMergePanel: vi.fn(),
  onPreviousHunk: vi.fn(),
  onNextHunk: vi.fn(),
  onMerge: vi.fn(),
};

describe("InputWorkspace", () => {
  it("keeps compare disabled until at least one editor contains text", async () => {
    const user = userEvent.setup();
    const onCompare = vi.fn();

    function Harness() {
      const [leftText, setLeftText] = useState("");
      const [rightText, setRightText] = useState("");
      return (
        <InputWorkspace
          leftText={leftText}
          rightText={rightText}
          leftName="原始文本.txt"
          rightName="更改后文本.txt"
          onLeftChange={setLeftText}
          onRightChange={setRightText}
          onLeftNameChange={vi.fn()}
          onRightNameChange={vi.fn()}
          onCompare={onCompare}
          onSwap={vi.fn()}
          onClear={vi.fn()}
          onFileLoad={vi.fn()}
          isComparing={false}
          error={null}
        />
      );
    }

    render(<Harness />);
    const compareButton = screen.getByRole("button", { name: "查找差异" });
    expect(compareButton).toBeDisabled();

    await user.type(screen.getByLabelText("原始文本内容"), "alpha");
    expect(compareButton).toBeEnabled();
    await user.click(compareButton);
    expect(onCompare).toHaveBeenCalledOnce();
  });
});

describe("DiffViewer", () => {
  it("renders aligned split rows and word-level emphasis", () => {
    render(
      <DiffViewer
        result={result}
        viewMode="split"
        wrapLines
        activeHunkIndex={0}
        {...viewerActions}
      />,
    );

    expect(screen.getByText("1 新增")).toBeInTheDocument();
    expect(screen.getByText("1 删除")).toBeInTheDocument();
    expect(screen.getAllByText("1 行")).toHaveLength(2);
    expect(screen.getAllByText("alpha")).toHaveLength(2);
    expect(screen.getByText("eta")).toHaveClass("segment-remove");
    expect(screen.getByText("ravo")).toHaveClass("segment-add");
  });

  it("renders removal and addition on separate rows in unified mode", () => {
    render(
      <DiffViewer
        result={result}
        viewMode="unified"
        wrapLines={false}
        activeHunkIndex={0}
        {...viewerActions}
      />,
    );

    expect(screen.getByLabelText("删除第 2 行")).toBeInTheDocument();
    expect(screen.getByLabelText("新增第 2 行")).toBeInTheDocument();
  });

  it("does not show a change marker in an empty split placeholder", () => {
    const additionOnly: DiffResult = {
      stats: {
        addedUnits: 1,
        removedUnits: 0,
        addedLines: 1,
        removedLines: 0,
        unchangedLines: 0,
        hunks: 1,
      },
      hunks: [{
        id: "hunk-1",
        rowStart: 0,
        rowEnd: 0,
        leftRange: { from: 0, to: 0 },
        rightRange: { from: 0, to: 1 },
      }],
      rows: [{
        id: "row-1",
        hunkId: "hunk-1",
        kind: "add",
        right: { lineNumber: 1, text: "new line" },
      }],
    };

    render(
      <DiffViewer
        result={additionOnly}
        viewMode="split"
        wrapLines
        activeHunkIndex={0}
        {...viewerActions}
      />,
    );

    expect(screen.getByLabelText("左侧空白占位")).toHaveTextContent("");
    expect(screen.getByLabelText("右侧新增第 1 行")).toHaveTextContent("+new line");
  });

  it("shows Diffchecker-compatible units with affected lines as secondary text", () => {
    render(
      <DiffViewer
        result={{
          ...result,
          stats: {
            addedUnits: 67,
            removedUnits: 57,
            addedLines: 61,
            removedLines: 50,
            unchangedLines: 74,
            hunks: 22,
          },
        }}
        viewMode="split"
        wrapLines
        activeHunkIndex={0}
        {...viewerActions}
      />,
    );

    expect(screen.getByText("57 删除")).toBeInTheDocument();
    expect(screen.getByText("67 新增")).toBeInTheDocument();
    expect(screen.getByText("50 行")).toBeInTheDocument();
    expect(screen.getByText("61 行")).toBeInTheDocument();
    expect(screen.getByText("74 行未变")).toBeInTheDocument();
    expect(screen.getByTitle("57 个删除差异单元，影响 50 行")).toBeInTheDocument();
    expect(screen.getByTitle("67 个新增差异单元，影响 61 行")).toBeInTheDocument();
  });

  it("opens inline controls from a changed row and merges in either direction", async () => {
    const user = userEvent.setup();
    const onMerge = vi.fn();

    function Harness({ viewMode = "split" }: { viewMode?: "split" | "unified" }) {
      const [mergePanelOpen, setMergePanelOpen] = useState(false);
      return (
        <DiffViewer
          result={result}
          viewMode={viewMode}
          wrapLines
          activeHunkIndex={0}
          mergePanelOpen={mergePanelOpen}
          isComparing={false}
          onSelectHunk={() => setMergePanelOpen(true)}
          onCloseMergePanel={() => setMergePanelOpen(false)}
          onPreviousHunk={vi.fn()}
          onNextHunk={vi.fn()}
          onMerge={onMerge}
        />
      );
    }

    render(<Harness />);
    expect(screen.queryByRole("group", { name: "当前差异操作" })).not.toBeInTheDocument();

    await user.click(screen.getByText("eta"));
    expect(screen.getByRole("group", { name: "当前差异操作" })).toHaveTextContent("更改 1 / 1");
    await user.click(screen.getByRole("button", { name: "合并到右侧" }));
    await user.click(screen.getByRole("button", { name: "合并到左侧" }));
    expect(onMerge).toHaveBeenNthCalledWith(1, "left-to-right");
    expect(onMerge).toHaveBeenNthCalledWith(2, "right-to-left");

    await user.click(screen.getByRole("button", { name: "关闭合并操作" }));
    expect(screen.queryByRole("group", { name: "当前差异操作" })).not.toBeInTheDocument();
  });

  it("supports keyboard selection and explicit unified merge labels", async () => {
    const user = userEvent.setup();
    const onSelectHunk = vi.fn();
    const { rerender } = render(
      <DiffViewer
        result={result}
        viewMode="unified"
        wrapLines
        activeHunkIndex={0}
        mergePanelOpen={false}
        isComparing={false}
        onSelectHunk={onSelectHunk}
        onCloseMergePanel={vi.fn()}
        onPreviousHunk={vi.fn()}
        onNextHunk={vi.fn()}
        onMerge={vi.fn()}
      />,
    );

    const hunkButton = screen.getByRole("button", { name: "选择第 1 处差异进行合并" });
    hunkButton.focus();
    await user.keyboard("{Enter}");
    expect(onSelectHunk).toHaveBeenCalledWith(0);

    rerender(
      <DiffViewer
        result={result}
        viewMode="unified"
        wrapLines
        activeHunkIndex={0}
        mergePanelOpen
        isComparing={false}
        onSelectHunk={onSelectHunk}
        onCloseMergePanel={vi.fn()}
        onPreviousHunk={vi.fn()}
        onNextHunk={vi.fn()}
        onMerge={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "用左侧替换右侧" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "用右侧替换左侧" })).toBeInTheDocument();
  });
});

describe("HistoryPanel", () => {
  it("restores, renames, and deletes a saved comparison", async () => {
    const user = userEvent.setup();
    const entry = createHistoryEntry(
      {
        title: "配置变更",
        leftName: "before.yaml",
        rightName: "after.yaml",
        leftText: "a",
        rightText: "b",
        options: DEFAULT_COMPARE_OPTIONS,
        stats: {
          addedLines: result.stats.addedLines,
          removedLines: result.stats.removedLines,
          unchangedLines: result.stats.unchangedLines,
          hunks: result.stats.hunks,
        },
      },
      { id: "history-1", now: "2026-09-05T00:00:00.000Z" },
    );
    const onRestore = vi.fn();
    const onRename = vi.fn();
    const onDelete = vi.fn();

    render(
      <HistoryPanel
        history={[entry]}
        onRestore={onRestore}
        onRename={onRename}
        onDelete={onDelete}
        onClearAll={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "打开 配置变更" }));
    expect(onRestore).toHaveBeenCalledWith(entry);

    await user.click(screen.getByRole("button", { name: "重命名 配置变更" }));
    const titleInput = screen.getByLabelText("历史标题");
    await user.clear(titleInput);
    await user.type(titleInput, "发布前检查");
    await user.keyboard("{Enter}");
    expect(onRename).toHaveBeenCalledWith("history-1", "发布前检查");

    await user.click(screen.getByRole("button", { name: "删除 配置变更" }));
    expect(onDelete).toHaveBeenCalledWith("history-1");
  });
});
