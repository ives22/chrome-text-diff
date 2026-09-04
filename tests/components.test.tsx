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
  stats: { added: 1, removed: 1, unchanged: 1, hunks: 1 },
  hunks: [{ id: "hunk-1", rowStart: 1, rowEnd: 1, leftStart: 2, rightStart: 2 }],
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
      />,
    );

    expect(screen.getByText("1 行新增")).toBeInTheDocument();
    expect(screen.getByText("1 行删除")).toBeInTheDocument();
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
      />,
    );

    expect(screen.getByLabelText("删除第 2 行")).toBeInTheDocument();
    expect(screen.getByLabelText("新增第 2 行")).toBeInTheDocument();
  });

  it("does not show a change marker in an empty split placeholder", () => {
    const additionOnly: DiffResult = {
      stats: { added: 1, removed: 0, unchanged: 0, hunks: 1 },
      hunks: [{ id: "hunk-1", rowStart: 0, rowEnd: 0, rightStart: 1 }],
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
      />,
    );

    expect(screen.getByLabelText("左侧空白占位")).toHaveTextContent("");
    expect(screen.getByLabelText("右侧新增第 1 行")).toHaveTextContent("+new line");
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
        stats: result.stats,
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
