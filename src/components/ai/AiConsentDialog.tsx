import { AlertTriangle, Send, ShieldAlert } from "lucide-react";
import { isInsecureBaseUrl } from "../../ai/permissions";
import type { ModelProfile } from "../../ai/types";

interface AiConsentDialogProps {
  open: boolean;
  profile: ModelProfile;
  scope: "full" | "hunk";
  requestCount: number;
  requiresConsent: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function AiConsentDialog(props: AiConsentDialogProps) {
  if (!props.open) return null;
  const insecure = isInsecureBaseUrl(props.profile.baseUrl);
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={props.onCancel}>
      <section className="ai-consent-dialog" role="dialog" aria-modal="true" aria-label="发送至模型服务？" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-icon"><ShieldAlert size={19} /></div>
        <div><h2>发送至模型服务？</h2><p>
          将向 <strong>{new URL(props.profile.baseUrl).origin}</strong> 发送
          {props.scope === "full" ? "左右完整文本" : "当前差异块"}。
        </p></div>
        <div className="ai-consent-details">
          {props.requiresConsent && <span>这是该模型配置首次发送文本，确认后同一地址不再重复提示。</span>}
          {props.requestCount > 1 && <span>预计发起 {props.requestCount} 次模型请求，包括最终汇总。</span>}
          {insecure && <span className="danger-text"><AlertTriangle size={14} />HTTP 明文连接可能泄露密钥和文本。</span>}
        </div>
        <div className="dialog-actions">
          <button type="button" className="button button-quiet" onClick={props.onCancel}>取消</button>
          <button type="button" className="button button-primary" onClick={props.onConfirm}><Send size={15} />确认发送</button>
        </div>
      </section>
    </div>
  );
}
