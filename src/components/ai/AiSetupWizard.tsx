import { useState } from "react";
import { BrainCircuit, ShieldCheck, Sparkles } from "lucide-react";
import type { ModelConnectionResult, ModelListResult, ModelProfile } from "../../ai/types";
import { ModelProfileForm } from "./ModelProfileForm";

interface AiSetupWizardProps {
  open: boolean;
  onSkip: () => void;
  onListModels: (profile: ModelProfile, apiKey?: string) => Promise<ModelListResult>;
  onTest: (profile: ModelProfile, apiKey?: string) => Promise<ModelConnectionResult>;
  onComplete: (profile: ModelProfile, apiKey?: string) => Promise<void>;
}

export function AiSetupWizard({ open, onSkip, onListModels, onTest, onComplete }: AiSetupWizardProps) {
  const [stage, setStage] = useState<"intro" | "config">("intro");
  if (!open) return null;

  return (
    <div className="ai-modal-backdrop">
      <section className="ai-setup-dialog" role="dialog" aria-modal="true" aria-label="配置 AI 模型">
        {stage === "intro" ? (
          <>
            <div className="ai-setup-icon"><BrainCircuit size={24} /></div>
            <span className="eyebrow">可选能力</span>
            <h1>配置 AI 模型</h1>
            <p>本地比较始终可用。只有点击 AI 分析或解释时，指定文本才会发送到你配置的模型服务。</p>
            <div className="ai-setup-points">
              <span><ShieldCheck size={16} />密钥不进入文本、历史或日志</span>
              <span><Sparkles size={16} />支持整体分析、单块解释和建议预览</span>
            </div>
            <div className="ai-setup-actions">
              <button type="button" className="button button-quiet" onClick={onSkip}>稍后配置</button>
              <button type="button" className="button button-primary" onClick={() => setStage("config")}>开始配置</button>
            </div>
          </>
        ) : (
          <>
            <span className="eyebrow">模型连接</span>
            <h1>添加第一个模型</h1>
            <p>请先完成连接测试，测试消息不包含你的差异文本。</p>
            <ModelProfileForm
              hasStoredKey={false}
              onListModels={onListModels}
              requireSuccessfulTest
              submitLabel="完成配置"
              onTest={onTest}
              onSubmit={onComplete}
              onCancel={() => setStage("intro")}
            />
          </>
        )}
      </section>
    </div>
  );
}
