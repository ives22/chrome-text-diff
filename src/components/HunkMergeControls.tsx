import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, X } from "lucide-react";
import type { DiffViewMode, MergeDirection } from "../core/types";
import { IconButton } from "./IconButton";

interface HunkControlHeaderProps {
  current: number;
  total: number;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
}

interface HunkMergeActionsProps {
  viewMode: DiffViewMode;
  disabled: boolean;
  onMerge: (direction: MergeDirection) => void;
}

export function HunkControlHeader({
  current,
  total,
  onPrevious,
  onNext,
  onClose,
}: HunkControlHeaderProps) {
  return (
    <div className="hunk-control-header" role="group" aria-label="当前差异操作">
      <div className="hunk-position">
        <strong>更改</strong>{" "}
        <span>{current} / {total}</span>
      </div>
      <div className="hunk-control-buttons">
        <IconButton label="上一个差异" onClick={onPrevious}>
          <ArrowUp size={15} />
        </IconButton>
        <IconButton label="下一个差异" onClick={onNext}>
          <ArrowDown size={15} />
        </IconButton>
        <IconButton label="关闭合并操作" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </div>
    </div>
  );
}

export function HunkMergeActions({
  viewMode,
  disabled,
  onMerge,
}: HunkMergeActionsProps) {
  const leftToRightLabel = viewMode === "unified" ? "用左侧替换右侧" : "合并到右侧";
  const rightToLeftLabel = viewMode === "unified" ? "用右侧替换左侧" : "合并到左侧";

  return (
    <div
      className={`hunk-merge-actions hunk-merge-${viewMode}`}
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
