import {
  ArrowLeft,
  ArrowLeftRight,
  Copy,
  Download,
  Save,
  Sparkles,
  Undo2,
} from "lucide-react";
import { IconButton } from "./IconButton";

interface ResultToolbarProps {
  title: string;
  unchangedLines: number;
  hunkCount: number;
  onEdit: () => void;
  onSwap: () => void;
  onCopyPatch: () => void;
  onSave: () => void;
  onExport: () => void;
  canUndo: boolean;
  onUndo: () => void;
  busy: boolean;
  aiBusy: boolean;
  onAiAnalyze: () => void;
}

export function ResultToolbar(props: ResultToolbarProps) {
  return (
    <header className="result-toolbar">
      <div className="result-title-group">
        <button type="button" className="button button-quiet" disabled={props.busy} onClick={props.onEdit}>
          <ArrowLeft size={16} aria-hidden="true" />编辑输入
        </button>
        <div className="result-title">
          <span className="eyebrow">当前比较</span>
          <div className="result-title-line">
            <h1>{props.title}</h1>
            <div
              className="result-global-summary"
              aria-label={`${props.unchangedLines} 行未变，${props.hunkCount} 处差异`}
            >
              <span className="result-unchanged-count">{props.unchangedLines} 行未变</span>
              <span aria-hidden="true">·</span>
              <span className="result-hunk-count">{props.hunkCount} 处差异</span>
            </div>
          </div>
        </div>
      </div>
      <div className="result-actions">
        <IconButton label="交换两侧文本" disabled={props.busy} onClick={props.onSwap}><ArrowLeftRight size={16} /></IconButton>
        <IconButton label="撤销最近一次合并" disabled={!props.canUndo || props.busy} onClick={props.onUndo}>
          <Undo2 size={16} />
        </IconButton>
        <button type="button" className="button button-quiet" disabled={props.busy} onClick={props.onCopyPatch}>
          <Copy size={16} aria-hidden="true" />复制补丁
        </button>
        <button type="button" className="button button-quiet" disabled={props.busy} onClick={props.onExport}>
          <Download size={16} aria-hidden="true" />导出
        </button>
        <button
          type="button"
          className="button button-ai"
          aria-label="AI 分析本次比较"
          disabled={props.busy || props.aiBusy}
          onClick={props.onAiAnalyze}
        >
          <Sparkles size={16} aria-hidden="true" />AI 分析
        </button>
        <button type="button" className="button button-primary" aria-label="保存比较" disabled={props.busy} onClick={props.onSave}>
          <Save size={16} aria-hidden="true" />保存
        </button>
      </div>
    </header>
  );
}
