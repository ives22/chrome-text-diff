import {
  createChromePermissionAdapter,
  ensureOriginPermission,
  normalizeBaseUrl,
  type PermissionAdapter,
} from "./permissions";
import type { ModelConnectionResult, ModelProfile } from "./types";

export type AiClientErrorCode =
  | "AUTH_ERROR"
  | "MODEL_NOT_FOUND"
  | "RATE_LIMIT"
  | "SERVICE_ERROR"
  | "REQUEST_ERROR"
  | "NETWORK_ERROR"
  | "INVALID_RESPONSE"
  | "PERMISSION_DENIED"
  | "MISSING_API_KEY"
  | "CANCELLED"
  | "TIMEOUT";

export class AiClientError extends Error {
  constructor(
    public readonly code: AiClientErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AiClientError";
  }
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompletionOptions {
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface AiClientDependencies {
  fetch?: FetchLike;
  permissions?: PermissionAdapter;
  now?: () => number;
}

export class AiClient {
  private readonly fetch: FetchLike;
  private readonly permissions: PermissionAdapter;
  private readonly now: () => number;

  constructor(dependencies: AiClientDependencies = {}) {
    this.fetch = dependencies.fetch ?? fetch;
    this.permissions = dependencies.permissions ?? createChromePermissionAdapter();
    this.now = dependencies.now ?? Date.now;
  }

  async testConnection(
    profile: ModelProfile,
    apiKey: string,
    signal?: AbortSignal,
  ): Promise<ModelConnectionResult> {
    const startedAt = this.now();
    await this.complete(profile, apiKey, [{ role: "user", content: "只回复 OK" }], {
      maxTokens: 8,
      temperature: 0,
      timeoutMs: 20_000,
      signal,
    });
    return {
      elapsedMs: Math.max(0, this.now() - startedAt),
      model: profile.model,
      origin: new URL(normalizeBaseUrl(profile.baseUrl)).origin,
    };
  }

  async complete(
    profile: ModelProfile,
    apiKey: string,
    messages: ChatMessage[],
    options: CompletionOptions = {},
  ): Promise<string> {
    if (!apiKey.trim()) {
      throw new AiClientError("MISSING_API_KEY", "请输入 API 密钥。");
    }
    if (!await ensureOriginPermission(profile.baseUrl, this.permissions)) {
      throw new AiClientError("PERMISSION_DENIED", "未获得该模型服务地址的访问权限。");
    }

    const controller = new AbortController();
    let cancelledByCaller = false;
    let timedOut = false;
    const cancel = () => {
      cancelledByCaller = true;
      controller.abort();
    };
    if (options.signal?.aborted) cancel();
    options.signal?.addEventListener("abort", cancel, { once: true });
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, options.timeoutMs ?? 60_000);

    try {
      if (cancelledByCaller) {
        throw new AiClientError("CANCELLED", "AI 请求已取消。");
      }
      const response = await this.fetch(createCompletionUrl(profile.baseUrl), {
        method: "POST",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: profile.model,
          messages,
          stream: false,
          temperature: options.temperature ?? 0.2,
          max_tokens: options.maxTokens ?? 2_500,
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw mapStatusError(response.status);

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new AiClientError("INVALID_RESPONSE", "模型返回了无法解析的响应。");
      }
      const content = readCompletionContent(payload);
      if (!content) {
        throw new AiClientError("INVALID_RESPONSE", "模型响应中缺少文本内容。");
      }
      return content;
    } catch (error) {
      if (error instanceof AiClientError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        if (cancelledByCaller) {
          throw new AiClientError("CANCELLED", "AI 请求已取消。");
        }
        if (timedOut) {
          throw new AiClientError("TIMEOUT", "模型服务响应超时。");
        }
      }
      throw new AiClientError("NETWORK_ERROR", "无法连接模型服务，请检查地址和网络。");
    } finally {
      window.clearTimeout(timeout);
      options.signal?.removeEventListener("abort", cancel);
    }
  }
}

export function createCompletionUrl(baseUrl: string): string {
  return `${normalizeBaseUrl(baseUrl)}/chat/completions`;
}

function mapStatusError(status: number): AiClientError {
  if (status === 401 || status === 403) {
    return new AiClientError("AUTH_ERROR", "模型服务拒绝了 API 密钥。");
  }
  if (status === 404) {
    return new AiClientError("MODEL_NOT_FOUND", "模型或接口地址不存在。");
  }
  if (status === 429) {
    return new AiClientError("RATE_LIMIT", "模型服务请求过于频繁或额度不足。");
  }
  if (status >= 500) {
    return new AiClientError("SERVICE_ERROR", "模型服务暂时不可用。");
  }
  return new AiClientError("REQUEST_ERROR", `模型服务拒绝了请求（HTTP ${status}）。`);
}

function readCompletionContent(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return undefined;
  const first = choices[0];
  if (!first || typeof first !== "object") return undefined;
  const message = (first as { message?: unknown }).message;
  if (!message || typeof message !== "object") return undefined;
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" && content.trim() ? content : undefined;
}
