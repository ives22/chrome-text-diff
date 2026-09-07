export interface PermissionAdapter {
  contains(permissions: { origins: string[] }): Promise<boolean>;
  request(permissions: { origins: string[] }): Promise<boolean>;
  remove(permissions: { origins: string[] }): Promise<boolean>;
}

export function normalizeBaseUrl(raw: string): string {
  const value = raw.trim();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("请输入有效的模型服务地址。");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("仅支持 HTTP 或 HTTPS 地址。");
  }
  if (url.username || url.password) {
    throw new Error("地址中不能包含用户名或密码。");
  }
  if (url.hash) {
    throw new Error("地址中不能包含片段。");
  }
  if (url.search) {
    throw new Error("地址中不能包含查询参数。");
  }

  return url.toString().replace(/\/+$/u, "");
}

export function getOriginPattern(baseUrl: string): string {
  return `${new URL(normalizeBaseUrl(baseUrl)).origin}/*`;
}

export function isInsecureBaseUrl(baseUrl: string): boolean {
  return new URL(normalizeBaseUrl(baseUrl)).protocol === "http:";
}

export async function ensureOriginPermission(
  baseUrl: string,
  permissions: PermissionAdapter,
): Promise<boolean> {
  const request = { origins: [getOriginPattern(baseUrl)] };
  if (await permissions.contains(request)) return true;
  return permissions.request(request);
}

export function createChromePermissionAdapter(): PermissionAdapter {
  if (typeof chrome !== "undefined" && chrome.permissions) {
    return {
      contains: (permissions) => chrome.permissions.contains(permissions),
      request: (permissions) => chrome.permissions.request(permissions),
      remove: (permissions) => chrome.permissions.remove(permissions),
    };
  }

  return {
    async contains() { return true; },
    async request() { return true; },
    async remove() { return true; },
  };
}
