import { describe, expect, it, vi } from "vitest";
import { AiClient, AiClientError } from "../src/ai/aiClient";
import type { ModelProfile } from "../src/ai/types";

const profile: ModelProfile = {
  id: "profile-1",
  name: "测试模型",
  provider: "custom",
  baseUrl: "https://models.example.com/v1",
  model: "example-chat",
  rememberApiKey: false,
};

function createPermissions(granted = true) {
  return {
    contains: vi.fn().mockResolvedValue(granted),
    request: vi.fn().mockResolvedValue(granted),
    remove: vi.fn().mockResolvedValue(true),
  };
}

describe("AiClient", () => {
  it("discovers models from /v1, deduplicates them, and reuses the resolved base URL", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [
          { id: "qwen-plus" },
          { id: "deepseek-chat" },
          { id: "qwen-plus" },
          { id: "" },
        ],
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "OK" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const client = new AiClient({ fetch, permissions: createPermissions(), now: () => 1_250 });
    const rootProfile = { ...profile, baseUrl: "https://models.example.com", model: "qwen-plus" };

    const available = await client.listModels(rootProfile, "sk-private");
    expect(available).toEqual({
      baseUrl: "https://models.example.com/v1",
      models: ["deepseek-chat", "qwen-plus"],
    });
    expect(fetch.mock.calls[0]?.[0]).toBe("https://models.example.com/v1/models");

    await client.testConnection({ ...rootProfile, baseUrl: available.baseUrl }, "sk-private");
    expect(fetch.mock.calls[1]?.[0]).toBe("https://models.example.com/v1/chat/completions");
  });

  it("falls back to a root-level model endpoint when /v1 is unavailable", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "root-chat" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    const client = new AiClient({ fetch, permissions: createPermissions() });

    await expect(client.listModels({ ...profile, baseUrl: "https://models.example.com" }, "sk-private"))
      .resolves.toEqual({ baseUrl: "https://models.example.com", models: ["root-chat"] });
    expect(fetch.mock.calls.map((call) => call[0])).toEqual([
      "https://models.example.com/v1/models",
      "https://models.example.com/models",
    ]);
  });

  it("tests a profile with a minimal OpenAI-compatible request", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      model: "example-chat",
      choices: [{ message: { content: "OK" } }],
    }), { status: 200 }));
    const client = new AiClient({ fetch, permissions: createPermissions(), now: () => 1_250 });

    const resultPromise = client.testConnection(profile, "sk-private");
    await Promise.resolve();
    const result = await resultPromise;

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://models.example.com/v1/chat/completions");
    expect(init.redirect).toBe("error");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer sk-private",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: "example-chat",
      stream: false,
      max_tokens: 8,
      messages: [{ role: "user", content: "只回复 OK" }],
    });
    expect(result).toMatchObject({ model: "example-chat", origin: "https://models.example.com" });
  });

  it("maps authorization errors without reading or exposing the response body", async () => {
    const text = vi.fn().mockResolvedValue("server leaked token sk-do-not-show");
    const fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, text });
    const client = new AiClient({ fetch, permissions: createPermissions() });

    await expect(client.complete(profile, "sk-private", [
      { role: "user", content: "hello" },
    ])).rejects.toMatchObject({ code: "AUTH_ERROR", message: "模型服务拒绝了 API 密钥。" });
    expect(text).not.toHaveBeenCalled();
  });

  it("rejects denied origin permission before sending a request", async () => {
    const fetch = vi.fn();
    const client = new AiClient({ fetch, permissions: createPermissions(false) });

    await expect(client.complete(profile, "sk-private", [
      { role: "user", content: "hello" },
    ])).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("distinguishes caller cancellation from request timeout", async () => {
    const fetch = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("Aborted", "AbortError"));
      });
    }));
    const client = new AiClient({ fetch, permissions: createPermissions() });
    const caller = new AbortController();
    const cancelled = client.complete(profile, "sk-private", [{ role: "user", content: "hello" }], {
      signal: caller.signal,
      timeoutMs: 1_000,
    });
    caller.abort();
    await expect(cancelled).rejects.toMatchObject({ code: "CANCELLED" });

    vi.useFakeTimers();
    const timedOut = client.complete(profile, "sk-private", [{ role: "user", content: "hello" }], {
      timeoutMs: 10,
    });
    const timeoutExpectation = expect(timedOut).rejects.toMatchObject({ code: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(11);
    await timeoutExpectation;
    vi.useRealTimers();
  });

  it("rejects malformed success responses", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [] }), { status: 200 }));
    const client = new AiClient({ fetch, permissions: createPermissions() });

    await expect(client.complete(profile, "sk-private", [
      { role: "user", content: "hello" },
    ])).rejects.toBeInstanceOf(AiClientError);
    await expect(client.complete(profile, "sk-private", [
      { role: "user", content: "hello" },
    ])).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("explains that an HTML success response usually means /v1 is missing", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("<!doctype html><title>Console</title>", {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    }));
    const client = new AiClient({ fetch, permissions: createPermissions() });

    await expect(client.complete(profile, "sk-private", [
      { role: "user", content: "hello" },
    ])).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      message: "模型接口返回了网页内容，请检查 API 地址是否缺少 /v1。",
    });
  });

  it("rejects oversized success responses before parsing model output", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("x".repeat(256 * 1024 + 1), { status: 200 }));
    const client = new AiClient({ fetch, permissions: createPermissions() });

    await expect(client.complete(profile, "sk-private", [
      { role: "user", content: "hello" },
    ])).rejects.toMatchObject({ code: "INVALID_RESPONSE", message: "模型响应超过 256 KiB 限制。" });
  });
});
