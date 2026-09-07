import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, X } from "lucide-react";
import type { DiffViewMode, MergeDirection } from "../core/types";
import { IconButton } from "./IconButton";

interface HunkControlHeaderProps {
  current: number;
  total: number;
  onPrevious: () => void;
  onNext: () => void;
}

interface HunkMergeActionsProps {
  viewMode: DiffViewMode;
  disabled: boolean;
  onMerge: (direction: MergeDirection) => void;
  onClose: () => void;
}

export function HunkControlHeader({
  current,
  total,
  onPrevious,
  onNext,
}: HunkControlHeaderProps) {
  return (
    <div className="hunk-panel-header">
      <div className="hunk-position">
        <strong>更改</strong>{" "}
        <span>{current} / {total}</span>
      </div>
      <div className="hunk-navigation" role="group" aria-label="差异块导航">
        <button
          type="button"
          className="hunk-nav-button"
          aria-label="上一个差异"
          title="上一个差异"
          onClick={onPrevious}
        >
          <ArrowUp size={14} aria-hidden="true" />
          <span>上一处</span>
        </button>
        <button
          type="button"
          className="hunk-nav-button"
          aria-label="下一个差异"
          title="下一个差异"
          onClick={onNext}
        >
          <ArrowDown size={14} aria-hidden="true" />
          <span>下一处</span>
        </button>
      </div>
    </div>
  );
}

export function HunkMergeActions({
  viewMode,
  disabled,
  onMerge,
  onClose,
}: HunkMergeActionsProps) {
  const leftToRightLabel = viewMode === "unified" ? "用左侧替换右侧" : "合并到右侧";
  const rightToLeftLabel = viewMode === "unified" ? "用右侧替换左侧" : "合并到左侧";

  return (
    <div
      className={`hunk-panel-footer hunk-merge-${viewMode}`}
      role="group"
      aria-label="差异合并方向"
    >
      <div className="hunk-merge-side hunk-merge-from-left">
        <button
          type="button"
          className="merge-button merge-button-right"
          aria-label={leftToRightLabel}
          disabled={disabled}
          onClick={() => onMerge("left-to-right")}
        >
          <span className="merge-label-short">合并到右侧</span>
          <span className="merge-label-long">用左侧替换右侧</span>
          <ArrowRight size={15} />
        </button>
      </div>
      <div className="hunk-close-slot">
        <IconButton
          label="关闭合并操作"
          className="hunk-close-button"
          onClick={onClose}
        >
          <X size={16} />
        </IconButton>
      </div>
      <div className="hunk-merge-side hunk-merge-from-right">
        <button
          type="button"
          className="merge-button merge-button-left"
          aria-label={rightToLeftLabel}
          disabled={disabled}
          onClick={() => onMerge("right-to-left")}
        >
          <ArrowLeft size={15} />
          <span className="merge-label-short">合并到左侧</span>
          <span className="merge-label-long">用右侧替换左侧</span>
        </button>
      </div>
    </div>
  );
}
