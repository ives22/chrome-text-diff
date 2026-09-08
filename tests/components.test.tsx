import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DiffViewer } from "../src/components/DiffViewer";
import { HistoryPanel } from "../src/components/HistoryPanel";
import { InputWorkspace } from "../src/components/InputWorkspace";
import { ResultToolbar } from "../src/components/ResultToolbar";
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
  aiBusy: false,
  onExplainAi: vi.fn(),
  onCopyLeft: vi.fn(),
  onCopyRight: vi.fn(),
  leftLineCount: 2,
  rightLineCount: 2,
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
        mergePanelOpen
      />,
    );

    const panel = screen.getByRole("group", { name: "当前差异操作" });
    expect(panel).toContainElement(screen.getByLabelText("左侧空白占位"));
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
    expect(screen.queryByText("74 行未变")).not.toBeInTheDocument();
    expect(screen.getByTitle("57 个删除差异单元，影响 50 行")).toBeInTheDocument();
    expect(screen.getByTitle("67 个新增差异单元，影响 61 行")).toBeInTheDocument();
  });

  it("places each statistic and full-text copy action in its own pane header", async () => {
    const user = userEvent.setup();
    const onCopyLeft = vi.fn();
    const onCopyRight = vi.fn();
    const { container } = render(
      <DiffViewer
        result={result}
        viewMode="split"
        wrapLines
        activeHunkIndex={0}
        {...viewerActions}
        onCopyLeft={onCopyLeft}
        onCopyRight={onCopyRight}
        leftLineCount={124}
        rightLineCount={135}
      />,
    );

    const leftSummary = container.querySelector(".diff-pane-summary-left") as HTMLElement;
    const rightSummary = container.querySelector(".diff-pane-summary-right") as HTMLElement;
    expect(leftSummary).toContainElement(screen.getByText("1 删除"));
    expect(leftSummary).toContainElement(screen.getByRole("button", { name: "复制原始文本" }));
    expect(rightSummary).toContainElement(screen.getByText("1 新增"));
    expect(rightSummary).toContainElement(screen.getByRole("button", { name: "复制更改后文本" }));
    expect(within(leftSummary).getByText("124 行")).toBeInTheDocument();
    expect(within(rightSummary).getByText("135 行")).toBeInTheDocument();
    expect(within(leftSummary).getByRole("button", { name: "复制原始文本" })).toHaveTextContent("复制");
    expect(within(rightSummary).getByRole("button", { name: "复制更改后文本" })).toHaveTextContent("复制");
    expect(container.querySelector(".diff-global-summary")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "复制原始文本" }));
    await user.click(screen.getByRole("button", { name: "复制更改后文本" }));
    expect(onCopyLeft).toHaveBeenCalledOnce();
    expect(onCopyRight).toHaveBeenCalledOnce();
  });

  it("opens inline controls from a changed row and merges in either direction", async () => {
    const user = userEvent.setup();
    const onMerge = vi.fn();
    const onPreviousHunk = vi.fn();
    const onNextHunk = vi.fn();
    const onExplainAi = vi.fn();

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
          onPreviousHunk={onPreviousHunk}
          onNextHunk={onNextHunk}
          onMerge={onMerge}
          aiBusy={false}
          onExplainAi={onExplainAi}
          onCopyLeft={vi.fn()}
          onCopyRight={vi.fn()}
          leftLineCount={2}
          rightLineCount={2}
        />
      );
    }

    render(<Harness />);
    expect(screen.queryByRole("group", { name: "当前差异操作" })).not.toBeInTheDocument();

    await user.click(screen.getByText("eta"));
    const panel = screen.getByRole("group", { name: "当前差异操作" });
    expect(panel).toHaveClass("hunk-merge-panel");
    expect(panel).toHaveTextContent("更改 1 / 1");
    expect(panel.querySelector(".hunk-position")).toHaveAttribute("aria-live", "polite");
    expect(panel).toContainElement(screen.getByText("eta"));
    expect(panel).toContainElement(screen.getByText("ravo"));
    expect(document.querySelectorAll(".hunk-merge-panel")).toHaveLength(1);

    const header = panel.querySelector(".hunk-panel-header");
    const footer = panel.querySelector(".hunk-panel-footer");
    expect(header).not.toBeNull();
    expect(footer).not.toBeNull();
    expect(within(header as HTMLElement).getByRole("button", { name: "上一个差异" }))
      .toHaveTextContent("上一处");
    expect(within(header as HTMLElement).getByRole("button", { name: "下一个差异" }))
      .toHaveTextContent("下一处");
    expect(within(header as HTMLElement).queryByRole("button", { name: "关闭合并操作" }))
      .not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "上一个差异" }));
    await user.click(screen.getByRole("button", { name: "下一个差异" }));
    expect(onPreviousHunk).toHaveBeenCalledOnce();
    expect(onNextHunk).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "AI 解释当前差异" }));
    expect(onExplainAi).toHaveBeenCalledOnce();

    const footerButtons = within(footer as HTMLElement).getAllByRole("button");
    expect(footerButtons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "合并到右侧",
      "关闭合并操作",
      "合并到左侧",
    ]);
    await user.click(footerButtons[0]!);
    await user.click(footerButtons[2]!);
    expect(onMerge).toHaveBeenNthCalledWith(1, "left-to-right");
    expect(onMerge).toHaveBeenNthCalledWith(2, "right-to-left");

    await user.click(footerButtons[1]!);
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
        aiBusy={false}
        onExplainAi={vi.fn()}
        onCopyLeft={vi.fn()}
        onCopyRight={vi.fn()}
        leftLineCount={2}
        rightLineCount={2}
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
        aiBusy={false}
        onExplainAi={vi.fn()}
        onCopyLeft={vi.fn()}
        onCopyRight={vi.fn()}
        leftLineCount={2}
        rightLineCount={2}
      />,
    );
    const unifiedPanel = screen.getByRole("group", { name: "当前差异操作" });
    expect(unifiedPanel.querySelectorAll(".hunk-panel-content-row")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "用左侧替换右侧" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "用右侧替换左侧" })).toBeInTheDocument();
  });

  it("reserves stacked split-row height on compact screens", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 375 });
    const { container } = render(
      <DiffViewer
        result={result}
        viewMode="split"
        wrapLines
        activeHunkIndex={0}
        mergePanelOpen
        isComparing={false}
        onSelectHunk={vi.fn()}
        onCloseMergePanel={vi.fn()}
        onPreviousHunk={vi.fn()}
        onNextHunk={vi.fn()}
        onMerge={vi.fn()}
        aiBusy={false}
        onExplainAi={vi.fn()}
        onCopyLeft={vi.fn()}
        onCopyRight={vi.fn()}
        leftLineCount={2}
        rightLineCount={2}
      />,
    );

    const canvas = container.querySelector(".virtual-canvas") as HTMLElement;
    expect(Number.parseFloat(canvas.style.height)).toBeGreaterThanOrEqual(206);
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
  });
});

describe("ResultToolbar", () => {
  it("keeps patch copy in the toolbar without duplicating the two full-text copy actions", () => {
    render(
      <ResultToolbar
        title="before ↔ after"
        unchangedLines={74}
        hunkCount={22}
        onEdit={vi.fn()}
        onSwap={vi.fn()}
        onCopyPatch={vi.fn()}
        onSave={vi.fn()}
        onExport={vi.fn()}
        canUndo={false}
        onUndo={vi.fn()}
        busy={false}
        aiBusy={false}
        onAiAnalyze={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "复制补丁" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "复制原始文本" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "复制更改后文本" })).not.toBeInTheDocument();
    const titleLine = screen.getByRole("heading", { name: "before ↔ after" }).parentElement;
    const globalSummary = screen.getByLabelText("74 行未变，22 处差异");
    expect(titleLine).toHaveClass("result-title-line");
    expect(screen.getByRole("heading", { name: "before ↔ after" }).nextElementSibling)
      .toBe(globalSummary);
    expect(globalSummary).toHaveTextContent(/74 行未变\s*·\s*22 处差异/);
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
