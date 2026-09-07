import { normalizeBaseUrl } from "./permissions";
import type { AiSettings, ModelProfile } from "./types";

export const AI_SETTINGS_KEY = "textdiff:ai-settings";
export const AI_LOCAL_SECRETS_KEY = "textdiff:ai-secrets-local";
export const AI_SESSION_SECRETS_KEY = "textdiff:ai-secrets-session";

export interface StorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface AiStorageAdapter {
  local: StorageArea;
  session: StorageArea;
}

interface SecretVault {
  schemaVersion: 1;
  keys: Record<string, string>;
}

export function createDefaultAiSettings(): AiSettings {
  return {
    schemaVersion: 1,
    onboardingCompleted: false,
    activeProfileId: null,
    profiles: [],
  };
}

export async function loadAiSettings(
  storage = createDefaultAiStorageAdapter(),
): Promise<AiSettings> {
  try {
    const stored = (await storage.local.get(AI_SETTINGS_KEY))[AI_SETTINGS_KEY];
    return decodeAiSettings(stored) ?? createDefaultAiSettings();
  } catch {
    return createDefaultAiSettings();
  }
}

export async function persistAiSettings(
  settings: AiSettings,
  storage = createDefaultAiStorageAdapter(),
): Promise<void> {
  await storage.local.set({ [AI_SETTINGS_KEY]: settings });
}

export async function saveModelProfile(
  settings: AiSettings,
  profile: ModelProfile,
  apiKey: string | undefined,
  storage = createDefaultAiStorageAdapter(),
): Promise<AiSettings> {
  const existing = settings.profiles.find((item) => item.id === profile.id);
  const normalizedProfile: ModelProfile = {
    ...profile,
    name: profile.name.trim(),
    model: profile.model.trim(),
    baseUrl: normalizeBaseUrl(profile.baseUrl),
  };
  if (!normalizedProfile.name) throw new Error("请输入配置名称。");
  if (!normalizedProfile.model) throw new Error("请输入模型 ID。");

  const originChanged = Boolean(
    existing && new URL(existing.baseUrl).origin !== new URL(normalizedProfile.baseUrl).origin,
  );
  if (originChanged && !apiKey?.trim()) {
    throw new Error("地址变更后必须重新输入 API 密钥。");
  }
  if (existing && existing.baseUrl !== normalizedProfile.baseUrl) {
    delete normalizedProfile.consentedOrigin;
    delete normalizedProfile.consentedAt;
  }

  const secret = apiKey?.trim() || await getAnySecret(profile.id, storage);
  if (secret) {
    const target = normalizedProfile.rememberApiKey ? storage.local : storage.session;
    const targetKey = normalizedProfile.rememberApiKey
      ? AI_LOCAL_SECRETS_KEY
      : AI_SESSION_SECRETS_KEY;
    const other = normalizedProfile.rememberApiKey ? storage.session : storage.local;
    const otherKey = normalizedProfile.rememberApiKey
      ? AI_SESSION_SECRETS_KEY
      : AI_LOCAL_SECRETS_KEY;
    await writeSecret(target, targetKey, profile.id, secret);
    await removeSecret(other, otherKey, profile.id);
  }

  const profiles = existing
    ? settings.profiles.map((item) => item.id === profile.id ? normalizedProfile : item)
    : [...settings.profiles, normalizedProfile];
  const next: AiSettings = {
    ...settings,
    profiles,
    activeProfileId: settings.activeProfileId ?? profile.id,
  };
  await persistAiSettings(next, storage);
  return next;
}

export async function getModelSecret(
  profile: ModelProfile,
  storage = createDefaultAiStorageAdapter(),
): Promise<string | undefined> {
  const area = profile.rememberApiKey ? storage.local : storage.session;
  const key = profile.rememberApiKey ? AI_LOCAL_SECRETS_KEY : AI_SESSION_SECRETS_KEY;
  return (await loadVault(area, key)).keys[profile.id];
}

export async function deleteModelProfile(
  settings: AiSettings,
  profileId: string,
  storage = createDefaultAiStorageAdapter(),
): Promise<AiSettings> {
  await Promise.all([
    removeSecret(storage.local, AI_LOCAL_SECRETS_KEY, profileId),
    removeSecret(storage.session, AI_SESSION_SECRETS_KEY, profileId),
  ]);
  const profiles = settings.profiles.filter((profile) => profile.id !== profileId);
  const next: AiSettings = {
    ...settings,
    profiles,
    activeProfileId: settings.activeProfileId === profileId
      ? profiles[0]?.id ?? null
      : settings.activeProfileId,
  };
  await persistAiSettings(next, storage);
  return next;
}

export async function setActiveModelProfile(
  settings: AiSettings,
  profileId: string,
  storage = createDefaultAiStorageAdapter(),
): Promise<AiSettings> {
  if (!settings.profiles.some((profile) => profile.id === profileId)) {
    throw new Error("所选模型配置不存在。");
  }
  const next = { ...settings, activeProfileId: profileId };
  await persistAiSettings(next, storage);
  return next;
}

export async function completeAiOnboarding(
  settings: AiSettings,
  storage = createDefaultAiStorageAdapter(),
): Promise<AiSettings> {
  const next = { ...settings, onboardingCompleted: true };
  await persistAiSettings(next, storage);
  return next;
}

export function createDefaultAiStorageAdapter(): AiStorageAdapter {
  if (typeof chrome !== "undefined" && chrome.storage?.local && chrome.storage?.session) {
    return {
      local: wrapChromeArea(chrome.storage.local),
      session: wrapChromeArea(chrome.storage.session),
    };
  }
  return {
    local: createWebStorageArea(localStorage),
    session: createWebStorageArea(sessionStorage),
  };
}

function wrapChromeArea(area: chrome.storage.StorageArea): StorageArea {
  return {
    get: (key) => area.get(key),
    set: (items) => area.set(items),
    remove: (key) => area.remove(key),
  };
}

function createWebStorageArea(area: Storage): StorageArea {
  return {
    async get(key) {
      const value = area.getItem(key);
      return { [key]: value ? JSON.parse(value) : undefined };
    },
    async set(items) {
      for (const [key, value] of Object.entries(items)) {
        area.setItem(key, JSON.stringify(value));
      }
    },
    async remove(key) { area.removeItem(key); },
  };
}

async function getAnySecret(
  profileId: string,
  storage: AiStorageAdapter,
): Promise<string | undefined> {
  const [local, session] = await Promise.all([
    loadVault(storage.local, AI_LOCAL_SECRETS_KEY),
    loadVault(storage.session, AI_SESSION_SECRETS_KEY),
  ]);
  return session.keys[profileId] ?? local.keys[profileId];
}

async function loadVault(area: StorageArea, key: string): Promise<SecretVault> {
  const value = (await area.get(key))[key];
  if (
    value &&
    typeof value === "object" &&
    (value as Partial<SecretVault>).schemaVersion === 1 &&
    (value as Partial<SecretVault>).keys &&
    typeof (value as Partial<SecretVault>).keys === "object"
  ) {
    return value as SecretVault;
  }
  return { schemaVersion: 1, keys: {} };
}

async function writeSecret(
  area: StorageArea,
  key: string,
  profileId: string,
  secret: string,
) {
  const vault = await loadVault(area, key);
  await area.set({
    [key]: { ...vault, keys: { ...vault.keys, [profileId]: secret } },
  });
}

async function removeSecret(area: StorageArea, key: string, profileId: string) {
  const vault = await loadVault(area, key);
  if (!(profileId in vault.keys)) return;
  const keys = { ...vault.keys };
  delete keys[profileId];
  if (Object.keys(keys).length === 0) {
    await area.remove(key);
  } else {
    await area.set({ [key]: { ...vault, keys } });
  }
}

function decodeAiSettings(value: unknown): AiSettings | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<AiSettings>;
  if (
    candidate.schemaVersion !== 1 ||
    typeof candidate.onboardingCompleted !== "boolean" ||
    !Array.isArray(candidate.profiles)
  ) {
    return null;
  }
  const profiles = candidate.profiles.flatMap((profile) => {
    if (!profile || typeof profile !== "object") return [];
    const item = profile as Partial<ModelProfile>;
    if (
      typeof item.id !== "string" || !item.id ||
      typeof item.name !== "string" || !item.name ||
      (item.provider !== "openai" && item.provider !== "deepseek" && item.provider !== "qwen" && item.provider !== "custom") ||
      typeof item.baseUrl !== "string" ||
      typeof item.model !== "string" || !item.model ||
      typeof item.rememberApiKey !== "boolean"
    ) {
      return [];
    }
    let baseUrl: string;
    try {
      baseUrl = normalizeBaseUrl(item.baseUrl);
    } catch {
      return [];
    }
    const sanitized: ModelProfile = {
      id: item.id,
      name: item.name,
      provider: item.provider,
      baseUrl,
      model: item.model,
      rememberApiKey: item.rememberApiKey,
    };
    const origin = new URL(baseUrl).origin;
    if (item.consentedOrigin === origin && typeof item.consentedAt === "string") {
      sanitized.consentedOrigin = origin;
      sanitized.consentedAt = item.consentedAt;
    }
    return [sanitized];
  });
  const activeProfileId = typeof candidate.activeProfileId === "string" &&
    profiles.some((profile) => profile.id === candidate.activeProfileId)
    ? candidate.activeProfileId
    : profiles[0]?.id ?? null;
  return {
    schemaVersion: 1,
    onboardingCompleted: candidate.onboardingCompleted,
    activeProfileId,
    profiles,
  };
}
