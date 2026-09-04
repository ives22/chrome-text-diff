import { useRef, useState, type DragEvent } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
import { ArrowLeftRight, Eraser, FileUp, LoaderCircle, Search } from "lucide-react";

export interface InputWorkspaceProps {
  leftText: string;
  rightText: string;
  leftName: string;
  rightName: string;
  onLeftChange: (value: string) => void;
  onRightChange: (value: string) => void;
  onLeftNameChange: (value: string) => void;
  onRightNameChange: (value: string) => void;
  onCompare: () => void;
  onSwap: () => void;
  onClear: () => void;
  onFileLoad: (side: "left" | "right", file: File) => void;
  isComparing: boolean;
  error: string | null;
}

interface EditorPanelProps {
  side: "left" | "right";
  label: string;
  value: string;
  fileName: string;
  onChange: (value: string) => void;
  onNameChange: (value: string) => void;
  onFileLoad: (side: "left" | "right", file: File) => void;
}

export function InputWorkspace(props: InputWorkspaceProps) {
  const canCompare = Boolean(props.leftText || props.rightText) && !props.isComparing;

  return (
    <section className="input-workspace" aria-labelledby="workspace-title">
      <div className="workspace-heading">
        <div>
          <span className="eyebrow">本地工作台</span>
          <h1 id="workspace-title">比较文本</h1>
        </div>
        <div className="input-actions">
          <button type="button" className="button button-quiet" onClick={props.onSwap}>
            <ArrowLeftRight size={16} aria-hidden="true" />
            交换
          </button>
          <button type="button" className="button button-quiet" onClick={props.onClear}>
            <Eraser size={16} aria-hidden="true" />
            清空
          </button>
        </div>
      </div>

      <div className="editor-grid">
        <EditorPanel
          side="left"
          label="原始文本"
          value={props.leftText}
          fileName={props.leftName}
          onChange={props.onLeftChange}
          onNameChange={props.onLeftNameChange}
          onFileLoad={props.onFileLoad}
        />
        <EditorPanel
          side="right"
          label="更改后文本"
          value={props.rightText}
          fileName={props.rightName}
          onChange={props.onRightChange}
          onNameChange={props.onRightNameChange}
          onFileLoad={props.onFileLoad}
        />
      </div>

      <div className="compare-bar">
        <div className="validation-message" role="status" aria-live="polite">
          {props.error}
        </div>
        <button
          type="button"
          className="button button-primary compare-button"
          onClick={props.onCompare}
          disabled={!canCompare}
        >
          {props.isComparing ? (
            <LoaderCircle className="spin" size={17} aria-hidden="true" />
          ) : (
            <Search size={17} aria-hidden="true" />
          )}
          {props.isComparing ? "正在比较" : "查找差异"}
        </button>
      </div>
    </section>
  );
}

function EditorPanel({
  side,
  label,
  value,
  fileName,
  onChange,
  onNameChange,
  onFileLoad,
}: EditorPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const lineCount = value === "" ? 0 : value.replace(/\r\n?/g, "\n").split("\n").length;

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) onFileLoad(side, file);
  };

  return (
    <article
      className={`editor-panel ${dragging ? "is-dragging" : ""}`}
      onDragEnter={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <header className="editor-panel-header">
        <div className="editor-identity">
          <span className={`side-dot side-dot-${side}`} aria-hidden="true" />
          <span className="editor-label">{label}</span>
          <input
            className="file-name-input"
            aria-label={`${label}文件名`}
            value={fileName}
            onChange={(event) => onNameChange(event.target.value)}
          />
        </div>
        <div className="editor-meta">
          <span>{lineCount.toLocaleString("zh-CN")} 行</span>
          <span>{value.length.toLocaleString("zh-CN")} 字符</span>
          <button
            type="button"
            className="button button-small"
            onClick={() => inputRef.current?.click()}
          >
            <FileUp size={15} aria-hidden="true" />
            打开文件
          </button>
          <input
            ref={inputRef}
            className="visually-hidden"
            type="file"
            accept=".txt,.md,.json,.yaml,.yml,.xml,.csv,.log,.conf,.ini,.toml"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onFileLoad(side, file);
              event.target.value = "";
            }}
          />
        </div>
      </header>
      <CodeMirror
        className="text-editor"
        aria-label={`${label}内容`}
        value={value}
        height="100%"
        extensions={[EditorView.lineWrapping]}
        basicSetup={{
          autocompletion: false,
          bracketMatching: false,
          closeBrackets: false,
          foldGutter: false,
          highlightActiveLine: true,
          highlightActiveLineGutter: true,
        }}
        onChange={onChange}
      />
      {dragging && <div className="drop-overlay">{label}</div>}
    </article>
  );
}
