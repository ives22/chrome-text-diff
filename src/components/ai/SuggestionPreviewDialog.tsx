import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Sparkles } from "lucide-react";
import type { BoundHunkSuggestion } from "../../ai/suggestions";
import { computeDiff } from "../../core/diffEngine";
import type { CompareOptions } from "../../core/types";

interface SuggestionPreviewDialogProps {
  open: boolean;
  suggestion: BoundHunkSuggestion;
  leftText: string;
  rightText: string;
  options: CompareOptions;
  onCancel: () => void;
  onApply: (target: "left" | "right") => void;
}

export function SuggestionPreviewDialog(props: SuggestionPreviewDialogProps) {
  const [target, setTarget] = useState<"left" | "right">(
    props.suggestion.recommendedTarget ?? "right",
  );
  const before = target === "left" ? props.leftText : props.rightText;
  const replacement = props.suggestion.replacementText ?? "";
  const preview = useMemo(
    () => computeDiff(before, replacement, { ...props.options, ignoreCase: false, ignoreWhitespace: false, ignoreBlankLines: false }),
    [before, props.options, replacement],
  );
  if (!props.open) return null;

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={props.onCancel}>
      <section className="suggestion-dialog" role="dialog" aria-modal="true" aria-label="预览 AI 修改建议" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div className="dialog-icon"><Sparkles size={19} /></div>
          <div><h2>预览 AI 修改建议</h2><p>{props.suggestion.explanation}</p></div>
        </header>
        <div className="suggestion-target" role="group" aria-label="应用目标">
          <button type="button" aria-label="应用目标：左侧" aria-pressed={target === "left"} onClick={() => setTarget("left")}><ArrowLeft size={15} />左侧</button>
          <button type="button" aria-label="应用目标：右侧" aria-pressed={target === "right"} onClick={() => setTarget("right")}>右侧<ArrowRight size={15} /></button>
        </div>
        <div className="suggestion-diff" aria-label="建议差异预览">
          {preview.rows.flatMap((row) => {
            if (row.kind === "change") {
              return [
                ...(row.left ? [{ id: `${row.id}-remove`, kind: "remove" as const, text: row.left.text }] : []),
                ...(row.right ? [{ id: `${row.id}-add`, kind: "add" as const, text: row.right.text }] : []),
              ];
            }
            const cell = row.left ?? row.right;
            return cell ? [{ id: row.id, kind: row.kind, text: cell.text }] : [];
          }).map((row) => (
            <div className={`suggestion-line suggestion-line-${row.kind}`} key={row.id}>
              <span aria-hidden="true">{row.kind === "add" ? "+" : row.kind === "remove" ? "−" : " "}</span>
              <code>{row.text || " "}</code>
            </div>
          ))}
        </div>
        <div className="dialog-actions">
          <button type="button" className="button button-quiet" onClick={props.onCancel}>取消</button>
          <button type="button" className="button button-primary" aria-label={`确认应用到${target === "left" ? "左侧" : "右侧"}`} onClick={() => props.onApply(target)}>
            确认应用到{target === "left" ? "左侧" : "右侧"}
          </button>
        </div>
      </section>
    </div>
  );
}
