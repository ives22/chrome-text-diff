import {
  ArrowLeft,
  ArrowLeftRight,
  Clipboard,
  Copy,
  Download,
  Save,
  Undo2,
} from "lucide-react";
import { IconButton } from "./IconButton";

interface ResultToolbarProps {
  title: string;
  onEdit: () => void;
  onSwap: () => void;
  onCopyLeft: () => void;
  onCopyRight: () => void;
  onCopyPatch: () => void;
  onSave: () => void;
  onExport: () => void;
  canUndo: boolean;
  onUndo: () => void;
  busy: boolean;
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
          <h1>{props.title}</h1>
        </div>
      </div>
      <div className="result-actions">
        <IconButton label="交换两侧文本" disabled={props.busy} onClick={props.onSwap}><ArrowLeftRight size={16} /></IconButton>
        <IconButton label="撤销最近一次合并" disabled={!props.canUndo || props.busy} onClick={props.onUndo}>
          <Undo2 size={16} />
        </IconButton>
        <IconButton label="复制原始文本" onClick={props.onCopyLeft}><Copy size={16} /></IconButton>
        <IconButton label="复制更改后文本" onClick={props.onCopyRight}><Clipboard size={16} /></IconButton>
        <button type="button" className="button button-quiet" disabled={props.busy} onClick={props.onCopyPatch}>
          <Copy size={16} aria-hidden="true" />复制补丁
        </button>
        <button type="button" className="button button-quiet" disabled={props.busy} onClick={props.onExport}>
          <Download size={16} aria-hidden="true" />导出
        </button>
        <button type="button" className="button button-primary" aria-label="保存比较" disabled={props.busy} onClick={props.onSave}>
          <Save size={16} aria-hidden="true" />保存
        </button>
      </div>
    </header>
  );
}
