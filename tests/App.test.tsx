import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
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
  stats: { added: 1, removed: 1, unchanged: 0, hunks: 1 },
  hunks: [{ id: "hunk-1", rowStart: 0, rowEnd: 0, leftStart: 1, rightStart: 1 }],
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
});
