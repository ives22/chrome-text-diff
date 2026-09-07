import { useState, type KeyboardEvent } from "react";
import { Clock3, Edit3, FileClock, Trash2, X } from "lucide-react";
import type { HistoryEntry } from "../core/storage";
import { IconButton } from "./IconButton";

interface HistoryPanelProps {
  history: HistoryEntry[];
  onRestore: (entry: HistoryEntry) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
}

export function HistoryPanel({
  history,
  onRestore,
  onRename,
  onDelete,
  onClearAll,
}: HistoryPanelProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");

  const beginRename = (entry: HistoryEntry) => {
    setEditingId(entry.id);
    setTitle(entry.title);
  };

  const submitRename = (id: string) => {
    if (title.trim()) onRename(id, title);
    setEditingId(null);
  };

  if (history.length === 0) {
    return (
      <div className="history-empty">
        <FileClock size={26} aria-hidden="true" />
        <strong>暂无历史记录</strong>
      </div>
    );
  }

  return (
    <div className="history-panel">
      <div className="panel-heading-row">
        <span>已保存 {history.length}</span>
        <button type="button" className="text-button danger-text" onClick={onClearAll}>
          清空全部
        </button>
      </div>
      <div className="history-list">
        {history.map((entry) => (
          <article className="history-item" key={entry.id}>
            {editingId === entry.id ? (
              <div className="history-rename">
                <input
                  autoFocus
                  aria-label="历史标题"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  onBlur={() => submitRename(entry.id)}
                  onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                    if (event.key === "Enter") submitRename(entry.id);
                    if (event.key === "Escape") setEditingId(null);
                  }}
                />
                <IconButton label="取消重命名" onClick={() => setEditingId(null)}>
                  <X size={14} />
                </IconButton>
              </div>
            ) : (
              <button
                type="button"
                className="history-open"
                aria-label={`打开 ${entry.title}`}
                onClick={() => onRestore(entry)}
              >
                <strong>{entry.title}</strong>
                <span>{entry.leftName} ↔ {entry.rightName}</span>
              </button>
            )}
            <div className="history-footer">
              <span><Clock3 size={12} />{formatDate(entry.createdAt)}</span>
              <span className="history-stats" title="受影响行数">
                −{entry.stats.removedLines} +{entry.stats.addedLines}
              </span>
              <IconButton label={`重命名 ${entry.title}`} onClick={() => beginRename(entry)}>
                <Edit3 size={14} />
              </IconButton>
              <IconButton label={`删除 ${entry.title}`} tone="danger" onClick={() => onDelete(entry.id)}>
                <Trash2 size={14} />
              </IconButton>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
