import { AlertTriangle, LoaderCircle, RefreshCw, Sparkles, Square, X } from "lucide-react";
import type { BoundHunkSuggestion } from "../../ai/suggestions";
import type { AiAnalysisResult, ModelProfile } from "../../ai/types";
import { IconButton } from "../IconButton";

export type AiRunStatus = "idle" | "loading" | "success" | "error";

interface DisplaySuggestion {
  suggestion: BoundHunkSuggestion;
  stale: boolean;
}

interface AiResultDrawerProps {
  open: boolean;
  scope: "full" | "hunk";
  status: AiRunStatus;
  result: AiAnalysisResult | null;
  suggestions: DisplaySuggestion[];
  profiles: ModelProfile[];
  activeProfileId: string | null;
  error: string | null;
  onScopeChange: (scope: "full" | "hunk") => void;
  onModelChange: (profileId: string) => void;
  onRegenerate: () => void;
  onCancel: () => void;
  onClose: () => void;
  onPreviewSuggestion: (suggestion: BoundHunkSuggestion) => void;
}

export function AiResultDrawer(props: AiResultDrawerProps) {
  if (!props.open) return null;
  const title = props.scope === "full" ? "整体分析" : "当前差异";

  return (
    <aside className="ai-result-drawer" aria-label="AI 分析结果">
      <header className="ai-result-header">
        <div><span className="eyebrow">AI 助手</span><h2>{title}</h2></div>
        <IconButton label="关闭 AI 分析结果" onClick={props.onClose}><X size={18} /></IconButton>
      </header>
      <div className="ai-scope-tabs" role="tablist" aria-label="AI 分析范围">
        <button type="button" role="tab" aria-selected={props.scope === "full"} onClick={() => props.onScopeChange("full")}>整体分析</button>
        <button type="button" role="tab" aria-selected={props.scope === "hunk"} onClick={() => props.onScopeChange("hunk")}>当前差异</button>
      </div>
      <div className="ai-result-toolbar">
        <label>
          <span className="visually-hidden">AI 模型</span>
          <select aria-label="AI 模型" value={props.activeProfileId ?? ""} onChange={(event) => props.onModelChange(event.target.value)}>
            {props.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
          </select>
        </label>
        {props.status === "loading" ? (
          <button type="button" className="button button-quiet button-small" onClick={props.onCancel}><Square size={14} />取消</button>
        ) : (
          <IconButton label="重新生成 AI 分析" onClick={props.onRegenerate}><RefreshCw size={16} /></IconButton>
        )}
      </div>
      <div className="ai-result-content" aria-live="polite">
        {props.status === "loading" && (
          <div className="ai-loading"><LoaderCircle className="spin" size={22} /><strong>正在分析差异</strong><span>请保持当前页面打开</span></div>
        )}
        {props.status === "error" && (
          <div className="ai-error"><AlertTriangle size={19} /><strong>分析失败</strong><p>{props.error}</p></div>
        )}
        {props.status === "idle" && (
          <div className="ai-loading"><Sparkles size={22} /><strong>尚未生成{title}</strong><span>点击重新生成开始分析</span></div>
        )}
        {props.result && props.status === "success" && (
          <>
            <section className="ai-answer-section"><h3><Sparkles size={15} />结论</h3><p>{props.result.summary}</p></section>
            {props.result.risks.length > 0 && (
              <section className="ai-answer-section"><h3><AlertTriangle size={15} />注意事项</h3><ul>{props.result.risks.map((risk, index) => <li key={`${index}-${risk}`}>{risk}</li>)}</ul></section>
            )}
            {props.suggestions.length > 0 && (
              <section className="ai-answer-section"><h3>修改建议</h3><div className="ai-suggestion-list">
                {props.suggestions.map(({ suggestion, stale }) => (
                  <article className="ai-suggestion-item" key={`${suggestion.hunkId}-${suggestion.explanation}`}>
                    <div><strong>{suggestion.hunkId}</strong>{stale && <span className="stale-badge">建议已过期</span>}</div>
                    <p>{suggestion.explanation}</p>
                    {suggestion.replacementText !== undefined && (
                      <button
                        type="button"
                        className="button button-quiet button-small"
                        aria-label={`预览 ${suggestion.hunkId} 的建议`}
                        disabled={stale}
                        onClick={() => props.onPreviewSuggestion(suggestion)}
                      >预览修改</button>
                    )}
                  </article>
                ))}
              </div></section>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
