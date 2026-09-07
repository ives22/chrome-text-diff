import { useMemo, useState, type FormEvent } from "react";
import { AlertTriangle, CheckCircle2, LoaderCircle, PlugZap } from "lucide-react";
import { isInsecureBaseUrl } from "../../ai/permissions";
import { MODEL_PRESETS } from "../../ai/presets";
import type { ModelConnectionResult, ModelProfile } from "../../ai/types";

interface ModelProfileFormProps {
  initialProfile?: ModelProfile;
  hasStoredKey: boolean;
  requireSuccessfulTest?: boolean;
  submitLabel?: string;
  onTest: (profile: ModelProfile, apiKey?: string) => Promise<ModelConnectionResult>;
  onSubmit: (profile: ModelProfile, apiKey?: string) => Promise<void>;
  onCancel: () => void;
}

export function ModelProfileForm({
  initialProfile,
  hasStoredKey,
  requireSuccessfulTest = false,
  submitLabel = "保存配置",
  onTest,
  onSubmit,
  onCancel,
}: ModelProfileFormProps) {
  const initialPreset = MODEL_PRESETS.find((preset) =>
    preset.provider === initialProfile?.provider && preset.baseUrl === initialProfile.baseUrl,
  )?.id ?? (initialProfile ? "custom" : "openai");
  const preset = MODEL_PRESETS.find((item) => item.id === initialPreset) ?? MODEL_PRESETS[0]!;
  const [id] = useState(() => initialProfile?.id ?? crypto.randomUUID());
  const [presetId, setPresetId] = useState(preset.id);
  const [name, setName] = useState(initialProfile?.name ?? preset.name);
  const [provider, setProvider] = useState(initialProfile?.provider ?? preset.provider);
  const [baseUrl, setBaseUrl] = useState(initialProfile?.baseUrl ?? preset.baseUrl);
  const [model, setModel] = useState(initialProfile?.model ?? "");
  const [apiKey, setApiKey] = useState("");
  const [storedKeyUsable, setStoredKeyUsable] = useState(hasStoredKey);
  const [rememberApiKey, setRememberApiKey] = useState(initialProfile?.rememberApiKey ?? false);
  const [httpAcknowledged, setHttpAcknowledged] = useState(false);
  const [busy, setBusy] = useState<"test" | "save" | null>(null);
  const [tested, setTested] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const current = useMemo<ModelProfile>(() => ({
    id,
    name,
    provider,
    baseUrl,
    model,
    rememberApiKey,
    ...(initialProfile?.consentedAt ? { consentedAt: initialProfile.consentedAt } : {}),
    ...(initialProfile?.consentedOrigin ? { consentedOrigin: initialProfile.consentedOrigin } : {}),
  }), [baseUrl, id, initialProfile, model, name, provider, rememberApiKey]);
  const insecure = safelyIsInsecure(baseUrl);
  const hasKey = Boolean(apiKey.trim() || storedKeyUsable);
  const valid = Boolean(name.trim() && baseUrl.trim() && model.trim() && hasKey);
  const permitted = valid && (!insecure || httpAcknowledged);

  const resetTest = () => {
    setTested(false);
    setStatus(null);
    setError(null);
  };

  const selectPreset = (value: string) => {
    const next = MODEL_PRESETS.find((item) => item.id === value) ?? MODEL_PRESETS.at(-1)!;
    setPresetId(next.id);
    setProvider(next.provider);
    setName(next.name);
    setBaseUrl(next.baseUrl);
    setModel("");
    setApiKey("");
    setStoredKeyUsable(Boolean(
      initialProfile &&
      hasStoredKey &&
      safelyOrigin(next.baseUrl) === safelyOrigin(initialProfile.baseUrl),
    ));
    setHttpAcknowledged(false);
    resetTest();
  };

  const testConnection = async () => {
    if (!permitted) return;
    setBusy("test");
    setError(null);
    try {
      const result = await onTest(current, apiKey.trim() || undefined);
      setTested(true);
      setStatus(`连接成功 · ${result.model} · ${result.elapsedMs} ms`);
    } catch (testError) {
      setTested(false);
      setError(testError instanceof Error ? testError.message : "连接测试失败。");
    } finally {
      setBusy(null);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!permitted || (requireSuccessfulTest && !tested)) return;
    setBusy("save");
    setError(null);
    try {
      await onSubmit(current, apiKey.trim() || undefined);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "模型配置保存失败。");
    } finally {
      setBusy(null);
    }
  };

  return (
    <form className="model-profile-form" onSubmit={(event) => void submit(event)}>
      <label className="field-label">
        <span>供应商预设</span>
        <select aria-label="供应商预设" value={presetId} onChange={(event) => selectPreset(event.target.value)}>
          {MODEL_PRESETS.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <div className="model-field-grid">
        <label className="field-label">
          <span>配置名称</span>
          <input aria-label="配置名称" value={name} onChange={(event) => { setName(event.target.value); resetTest(); }} />
        </label>
        <label className="field-label">
          <span>模型 ID</span>
          <input
            aria-label="模型 ID"
            value={model}
            placeholder={MODEL_PRESETS.find((item) => item.id === presetId)?.modelPlaceholder}
            onChange={(event) => { setModel(event.target.value); resetTest(); }}
          />
        </label>
      </div>
      <label className="field-label">
        <span>API 地址</span>
        <input aria-label="API 地址" inputMode="url" value={baseUrl} onChange={(event) => {
          const value = event.target.value;
          setBaseUrl(value);
          setStoredKeyUsable(Boolean(
            initialProfile &&
            hasStoredKey &&
            safelyOrigin(value) === safelyOrigin(initialProfile.baseUrl),
          ));
          setHttpAcknowledged(false);
          resetTest();
        }} />
      </label>
      <label className="field-label">
        <span>API 密钥</span>
        <input
          aria-label="API 密钥"
          type="password"
          autoComplete="off"
          value={apiKey}
          placeholder={hasStoredKey ? "已保存，留空保持不变" : "输入 API 密钥"}
          onChange={(event) => { setApiKey(event.target.value); resetTest(); }}
        />
      </label>
      <label className="check-row">
        <input type="checkbox" checked={rememberApiKey} onChange={(event) => setRememberApiKey(event.target.checked)} />
        <span>在本机记住密钥</span>
        <small>保存在扩展隔离存储中，但未额外加密</small>
      </label>
      {insecure && (
        <label className="http-warning">
          <AlertTriangle size={16} aria-hidden="true" />
          <input
            type="checkbox"
            aria-label="我了解 HTTP 明文传输风险"
            checked={httpAcknowledged}
            onChange={(event) => setHttpAcknowledged(event.target.checked)}
          />
          <span>我了解 HTTP 明文传输风险，密钥和差异文本可能被窃听。</span>
        </label>
      )}
      {(status || error) && (
        <div className={error ? "form-status form-status-error" : "form-status"} role="status">
          {error ? <AlertTriangle size={15} /> : <CheckCircle2 size={15} />}
          <span>{error ?? status}</span>
        </div>
      )}
      <div className="model-form-actions">
        <button type="button" className="button button-quiet" onClick={onCancel}>取消</button>
        <button
          type="button"
          className="button button-quiet"
          aria-label="测试连接"
          disabled={!permitted || busy !== null}
          onClick={() => void testConnection()}
        >
          {busy === "test" ? <LoaderCircle className="spin" size={16} /> : <PlugZap size={16} />}
          测试连接
        </button>
        <button
          type="submit"
          className="button button-primary"
          aria-label={submitLabel}
          disabled={!permitted || busy !== null || (requireSuccessfulTest && !tested)}
        >
          {busy === "save" && <LoaderCircle className="spin" size={16} />}
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

function safelyIsInsecure(value: string): boolean {
  try {
    return isInsecureBaseUrl(value);
  } catch {
    return false;
  }
}

function safelyOrigin(value: string): string | undefined {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}
