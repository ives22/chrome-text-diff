import {
  ArrowDown,
  ArrowUp,
  CaseSensitive,
  Columns2,
  History,
  Pilcrow,
  Rows3,
  SlidersHorizontal,
  Space,
  WrapText,
} from "lucide-react";
import type { HistoryEntry } from "../core/storage";
import type { CompareOptions, DiffGranularity } from "../core/types";
import { HistoryPanel } from "./HistoryPanel";
import { IconButton } from "./IconButton";

interface ToolSidebarProps {
  panel: "tools" | "history";
  options: CompareOptions;
  history: HistoryEntry[];
  activeHunkIndex: number;
  hunkCount: number;
  onPanelChange: (panel: "tools" | "history") => void;
  onOptionsChange: (options: CompareOptions) => void;
  onPreviousHunk: () => void;
  onNextHunk: () => void;
  onRestoreHistory: (entry: HistoryEntry) => void;
  onRenameHistory: (id: string, title: string) => void;
  onDeleteHistory: (id: string) => void;
  onClearHistory: () => void;
}

export function ToolSidebar(props: ToolSidebarProps) {
  const updateOption = <Key extends keyof CompareOptions>(
    key: Key,
    value: CompareOptions[Key],
  ) => props.onOptionsChange({ ...props.options, [key]: value });

  return (
    <aside className="tool-sidebar" aria-label="TextDiff 侧栏">
      <div className="sidebar-tabs" role="tablist" aria-label="侧栏面板">
        <button
          type="button"
          role="tab"
          aria-label="工具"
          aria-selected={props.panel === "tools"}
          className={props.panel === "tools" ? "is-active" : ""}
          onClick={() => props.onPanelChange("tools")}
        >
          <SlidersHorizontal size={15} aria-hidden="true" />工具
        </button>
        <button
          type="button"
          role="tab"
          aria-label="历史"
          aria-selected={props.panel === "history"}
          className={props.panel === "history" ? "is-active" : ""}
          onClick={() => props.onPanelChange("history")}
        >
          <History size={15} aria-hidden="true" />历史
          {props.history.length > 0 && <span className="tab-count">{props.history.length}</span>}
        </button>
      </div>

      <div className="sidebar-body">
        {props.panel === "history" ? (
          <HistoryPanel
            history={props.history}
            onRestore={props.onRestoreHistory}
            onRename={props.onRenameHistory}
            onDelete={props.onDeleteHistory}
            onClearAll={props.onClearHistory}
          />
        ) : (
          <div className="tools-panel">
            <ToolGroup label="视图">
              <div className="segmented-control">
                <button
                  type="button"
                  aria-label="拆分视图"
                  aria-pressed={props.options.viewMode === "split"}
                  onClick={() => updateOption("viewMode", "split")}
                >
                  <Columns2 size={15} aria-hidden="true" />拆分
                </button>
                <button
                  type="button"
                  aria-label="统一视图"
                  aria-pressed={props.options.viewMode === "unified"}
                  onClick={() => updateOption("viewMode", "unified")}
                >
                  <Rows3 size={15} aria-hidden="true" />统一
                </button>
              </div>
            </ToolGroup>

            <ToolGroup label="比对精度">
              <div className="segmented-control precision-control">
                {(["smart", "word", "character"] as DiffGranularity[]).map((value) => (
                  <button
                    type="button"
                    key={value}
                    aria-pressed={props.options.granularity === value}
                    onClick={() => updateOption("granularity", value)}
                  >
                    {value === "smart" ? "智能" : value === "word" ? "单词" : "字符"}
                  </button>
                ))}
              </div>
            </ToolGroup>

            <ToolGroup label="忽略规则">
              <ToggleRow
                icon={<CaseSensitive size={16} />}
                label="忽略大小写"
                checked={props.options.ignoreCase}
                onChange={(checked) => updateOption("ignoreCase", checked)}
              />
              <ToggleRow
                icon={<Space size={16} />}
                label="忽略空白变化"
                checked={props.options.ignoreWhitespace}
                onChange={(checked) => updateOption("ignoreWhitespace", checked)}
              />
              <ToggleRow
                icon={<Pilcrow size={16} />}
                label="忽略空行"
                checked={props.options.ignoreBlankLines}
                onChange={(checked) => updateOption("ignoreBlankLines", checked)}
              />
              <ToggleRow
                icon={<WrapText size={16} />}
                label="自动换行"
                checked={props.options.wrapLines}
                onChange={(checked) => updateOption("wrapLines", checked)}
              />
            </ToolGroup>

            <ToolGroup label="差异导航">
              <div className="diff-navigation">
                <IconButton
                  label="上一处差异"
                  disabled={props.hunkCount === 0}
                  onClick={props.onPreviousHunk}
                >
                  <ArrowUp size={16} />
                </IconButton>
                <span>{props.hunkCount ? `${props.activeHunkIndex + 1} / ${props.hunkCount}` : "0 / 0"}</span>
                <IconButton
                  label="下一处差异"
                  disabled={props.hunkCount === 0}
                  onClick={props.onNextHunk}
                >
                  <ArrowDown size={16} />
                </IconButton>
              </div>
            </ToolGroup>
          </div>
        )}
      </div>
      <footer className="sidebar-footer">
        <span className="offline-dot" aria-hidden="true" />仅本地处理
      </footer>
    </aside>
  );
}

function ToolGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="tool-group">
      <h2>{label}</h2>
      {children}
    </section>
  );
}

function ToggleRow({
  icon,
  label,
  checked,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="toggle-row">
      <span className="toggle-label">{icon}{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="toggle-track" aria-hidden="true"><span /></span>
    </label>
  );
}
