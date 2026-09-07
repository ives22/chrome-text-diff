import { describe, expect, it, vi } from "vitest";
import {
  AI_SETTINGS_KEY,
  createDefaultAiSettings,
  deleteModelProfile,
  completeAiOnboarding,
  getModelSecret,
  loadAiSettings,
  saveModelProfile,
  setActiveModelProfile,
  type AiStorageAdapter,
  type StorageArea,
} from "../src/ai/aiStorage";
import {
  ensureOriginPermission,
  getOriginPattern,
  normalizeBaseUrl,
} from "../src/ai/permissions";
import { MODEL_PRESETS } from "../src/ai/presets";
import type { ModelProfile } from "../src/ai/types";

class MemoryArea implements StorageArea {
  data: Record<string, unknown> = {};
  async get(key: string) { return { [key]: this.data[key] }; }
  async set(items: Record<string, unknown>) { Object.assign(this.data, items); }
  async remove(key: string) { delete this.data[key]; }
}

function createStorage(): AiStorageAdapter {
  return { local: new MemoryArea(), session: new MemoryArea() };
}

const profile: ModelProfile = {
  id: "profile-1",
  name: "测试模型",
  provider: "custom",
  baseUrl: "https://models.example.com/v1",
  model: "example-chat",
  rememberApiKey: false,
};

describe("AI provider configuration", () => {
  it("provides editable OpenAI, DeepSeek, and Qwen endpoint presets", () => {
    expect(MODEL_PRESETS.map((item) => item.id)).toEqual([
      "openai",
      "deepseek",
      "qwen-cn",
      "qwen-intl",
      "custom",
    ]);
    expect(MODEL_PRESETS.find((item) => item.id === "openai")?.baseUrl)
      .toBe("https://api.openai.com/v1");
    expect(MODEL_PRESETS.find((item) => item.id === "deepseek")?.baseUrl)
      .toBe("https://api.deepseek.com");
    expect(MODEL_PRESETS.find((item) => item.id === "qwen-cn")?.baseUrl)
      .toContain("dashscope.aliyuncs.com/compatible-mode/v1");
  });

  it("normalizes valid endpoints and rejects unsafe URL shapes", () => {
    expect(normalizeBaseUrl(" https://models.example.com/v1/ "))
      .toBe("https://models.example.com/v1");
    expect(normalizeBaseUrl("http://10.0.0.8:8000/v1"))
      .toBe("http://10.0.0.8:8000/v1");
    expect(() => normalizeBaseUrl("ftp://models.example.com"))
      .toThrow("仅支持 HTTP 或 HTTPS 地址");
    expect(() => normalizeBaseUrl("https://user:pass@models.example.com/v1"))
      .toThrow("地址中不能包含用户名或密码");
    expect(() => normalizeBaseUrl("https://models.example.com/v1#token"))
      .toThrow("地址中不能包含片段");
  });

  it("requests only the configured origin from Chrome", async () => {
    const permissions = {
      contains: vi.fn().mockResolvedValue(false),
      request: vi.fn().mockResolvedValue(true),
      remove: vi.fn().mockResolvedValue(true),
    };

    expect(getOriginPattern("https://models.example.com/v1"))
      .toBe("https://models.example.com/*");
    await expect(ensureOriginPermission("https://models.example.com/v1", permissions))
      .resolves.toBe(true);
    expect(permissions.contains).toHaveBeenCalledWith({
      origins: ["https://models.example.com/*"],
    });
    expect(permissions.request).toHaveBeenCalledWith({
      origins: ["https://models.example.com/*"],
    });
  });
});

describe("AI settings storage", () => {
  it("loads a versioned empty configuration", async () => {
    const settings = await loadAiSettings(createStorage());
    expect(settings).toEqual(createDefaultAiSettings());
  });

  it("stores session secrets separately from profile metadata", async () => {
    const storage = createStorage();
    const settings = await saveModelProfile(
      createDefaultAiSettings(),
      profile,
      "sk-session-secret",
      storage,
    );

    expect(settings.activeProfileId).toBe(profile.id);
    expect(await getModelSecret(profile, storage)).toBe("sk-session-secret");
    expect(JSON.stringify((storage.local as MemoryArea).data)).not.toContain("sk-session-secret");
    expect(JSON.stringify((storage.local as MemoryArea).data[AI_SETTINGS_KEY])).not.toContain("apiKey");
  });

  it("moves a remembered secret to local storage without retaining a session copy", async () => {
    const storage = createStorage();
    const settings = await saveModelProfile(
      createDefaultAiSettings(),
      profile,
      "sk-move-me",
      storage,
    );
    const remembered = { ...profile, rememberApiKey: true };

    await saveModelProfile(settings, remembered, undefined, storage);

    expect(await getModelSecret(remembered, storage)).toBe("sk-move-me");
    expect(JSON.stringify((storage.session as MemoryArea).data)).not.toContain("sk-move-me");
    expect(JSON.stringify((storage.local as MemoryArea).data)).toContain("sk-move-me");
  });

  it("clears consent when the endpoint changes and removes both secret copies on delete", async () => {
    const storage = createStorage();
    const consented = {
      ...profile,
      consentedOrigin: "https://models.example.com",
      consentedAt: "2026-09-07T00:00:00.000Z",
    };
    let settings = await saveModelProfile(
      createDefaultAiSettings(),
      consented,
      "sk-delete-me",
      storage,
    );
    const changed = {
      ...consented,
      baseUrl: "https://other.example.com/v1",
      rememberApiKey: true,
    };

    settings = await saveModelProfile(settings, changed, "sk-delete-me", storage);
    expect(settings.profiles[0]).not.toHaveProperty("consentedAt");
    expect(settings.profiles[0]).not.toHaveProperty("consentedOrigin");

    settings = await deleteModelProfile(settings, profile.id, storage);
    expect(settings.profiles).toEqual([]);
    expect(JSON.stringify((storage.local as MemoryArea).data)).not.toContain("sk-delete-me");
    expect(JSON.stringify((storage.session as MemoryArea).data)).not.toContain("sk-delete-me");
  });

  it("completes onboarding and switches the active profile without changing secrets", async () => {
    const storage = createStorage();
    let settings = await saveModelProfile(
      createDefaultAiSettings(),
      profile,
      "sk-keep",
      storage,
    );
    const second = { ...profile, id: "profile-2", name: "第二个模型" };
    settings = await saveModelProfile(settings, second, "sk-second", storage);

    settings = await setActiveModelProfile(settings, second.id, storage);
    settings = await completeAiOnboarding(settings, storage);

    expect(settings.activeProfileId).toBe(second.id);
    expect(settings.onboardingCompleted).toBe(true);
    expect(await getModelSecret(profile, storage)).toBe("sk-keep");
  });
});
