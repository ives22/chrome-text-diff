import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AiConsentDialog } from "../src/components/ai/AiConsentDialog";
import { AiResultDrawer } from "../src/components/ai/AiResultDrawer";
import { AiSettingsDrawer } from "../src/components/ai/AiSettingsDrawer";
import { AiSetupWizard } from "../src/components/ai/AiSetupWizard";
import { ModelProfileForm } from "../src/components/ai/ModelProfileForm";
import { SuggestionPreviewDialog } from "../src/components/ai/SuggestionPreviewDialog";
import { createDefaultAiSettings } from "../src/ai/aiStorage";
import type { BoundHunkSuggestion } from "../src/ai/suggestions";
import type { AiAnalysisResult, ModelProfile } from "../src/ai/types";
import { DEFAULT_COMPARE_OPTIONS } from "../src/core/types";

const profile: ModelProfile = {
  id: "profile-1",
  name: "内网模型",
  provider: "custom",
  baseUrl: "http://models.internal/v1",
  model: "chat-model",
  rememberApiKey: false,
};

describe("ModelProfileForm", () => {
  it("requires an explicit insecure HTTP acknowledgement before test or save", async () => {
    const user = userEvent.setup();
    const onTest = vi.fn().mockResolvedValue({ elapsedMs: 30, model: "chat-model", origin: "http://models.internal" });
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <ModelProfileForm
        initialProfile={profile}
        hasStoredKey={false}
        onTest={onTest}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText("API 密钥"), "sk-test");
    expect(screen.getByRole("button", { name: "测试连接" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "保存配置" })).toBeDisabled();

    await user.click(screen.getByLabelText("我了解 HTTP 明文传输风险"));
    await user.click(screen.getByRole("button", { name: "测试连接" }));
    expect(onTest).toHaveBeenCalledWith(expect.objectContaining({ baseUrl: profile.baseUrl }), "sk-test");
    expect(await screen.findByRole("status")).toHaveTextContent("连接成功");
    await user.click(screen.getByRole("button", { name: "保存配置" }));
    expect(onSubmit).toHaveBeenCalledOnce();
  });
});

describe("AI onboarding and settings", () => {
  it("allows a fresh-install setup wizard to be skipped", async () => {
    const user = userEvent.setup();
    const onSkip = vi.fn();
    render(
      <AiSetupWizard
        open
        onSkip={onSkip}
        onTest={vi.fn()}
        onComplete={vi.fn()}
      />,
    );

    expect(screen.getByRole("dialog", { name: "配置 AI 模型" })).toHaveTextContent("本地比较始终可用");
    await user.click(screen.getByRole("button", { name: "稍后配置" }));
    expect(onSkip).toHaveBeenCalledOnce();
  });

  it("lists multiple profiles and exposes active, edit, delete, and add actions", async () => {
    const user = userEvent.setup();
    const second = { ...profile, id: "profile-2", name: "备用模型", baseUrl: "https://models.example.com/v1" };
    const onSetActive = vi.fn();
    const onDelete = vi.fn();
    render(
      <AiSettingsDrawer
        open
        settings={{
          ...createDefaultAiSettings(),
          profiles: [profile, second],
          activeProfileId: profile.id,
        }}
        secretProfileIds={new Set([profile.id])}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onTest={vi.fn()}
        onSetActive={onSetActive}
        onDelete={onDelete}
      />,
    );

    expect(screen.getByRole("dialog", { name: "AI 模型设置" })).toBeInTheDocument();
    expect(screen.getByText("当前使用")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "使用 备用模型" }));
    expect(onSetActive).toHaveBeenCalledWith(second.id);
    await user.click(screen.getByRole("button", { name: "删除 备用模型" }));
    expect(onDelete).toHaveBeenCalledWith(second.id);
    await user.click(screen.getByRole("button", { name: "添加模型" }));
    expect(screen.getByLabelText("供应商预设")).toBeInTheDocument();
  });
});

describe("AI analysis UI", () => {
  const analysis: AiAnalysisResult = {
    summary: "资源类型和副本数发生变化。",
    risks: ["确认持久卷策略"],
    suggestions: [],
  };
  const bound: BoundHunkSuggestion = {
    hunkId: "hunk-1",
    explanation: "建议保留新的副本数。",
    replacementText: "replicas: 2",
    recommendedTarget: "right",
    snapshot: { leftText: "replicas: 1", rightText: "replicas: 2", originalIndex: 0 },
  };

  it("renders full analysis and disables stale suggestion previews", async () => {
    const user = userEvent.setup();
    const onPreviewSuggestion = vi.fn();
    render(
      <AiResultDrawer
        open
        scope="full"
        status="success"
        result={analysis}
        suggestions={[{ suggestion: bound, stale: true }]}
        profiles={[profile]}
        activeProfileId={profile.id}
        error={null}
        onScopeChange={vi.fn()}
        onModelChange={vi.fn()}
        onRegenerate={vi.fn()}
        onCancel={vi.fn()}
        onClose={vi.fn()}
        onPreviewSuggestion={onPreviewSuggestion}
      />,
    );

    expect(screen.getByRole("complementary", { name: "AI 分析结果" })).toHaveTextContent("整体分析");
    expect(screen.getByText(analysis.summary)).toBeInTheDocument();
    expect(screen.getByText("建议已过期")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "预览 hunk-1 的建议" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "重新生成 AI 分析" }));
  });

  it("describes the first-send scope and request count before transmission", () => {
    render(
      <AiConsentDialog
        open
        profile={profile}
        scope="full"
        requestCount={4}
        requiresConsent
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByRole("dialog", { name: "发送至模型服务？" }))
      .toHaveTextContent("左右完整文本");
    expect(screen.getByText(/预计发起 4 次模型请求/)).toBeInTheDocument();
    expect(screen.getByText(/HTTP 明文连接/)).toBeInTheDocument();
  });

  it("previews a suggestion locally and applies it only after target confirmation", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(
      <SuggestionPreviewDialog
        open
        suggestion={bound}
        leftText="replicas: 1"
        rightText="replicas: 2"
        options={DEFAULT_COMPARE_OPTIONS}
        onCancel={vi.fn()}
        onApply={onApply}
      />,
    );

    expect(screen.getByRole("dialog", { name: "预览 AI 修改建议" })).toHaveTextContent("replicas: 2");
    expect(screen.getByRole("button", { name: "应用目标：右侧" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "应用目标：左侧" }));
    await user.click(screen.getByRole("button", { name: "确认应用到左侧" }));
    expect(onApply).toHaveBeenCalledWith("left");
  });
});
