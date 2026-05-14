/**
 * Feishu (Lark) Open API client — server-only.
 *
 * Auth: Custom App app_id + app_secret → tenant_access_token (cached, ~110 min TTL).
 *
 * Env:
 *   FEISHU_APP_ID
 *   FEISHU_APP_SECRET
 *   FEISHU_BASE_URL   (optional; default https://open.feishu.cn — use https://open.larksuite.com for non-CN tenants)
 */

interface TokenCache {
  token: string;
  expiresAt: number;
}

let cache: TokenCache | null = null;

export function getFeishuBaseUrl(): string {
  return process.env.FEISHU_BASE_URL || "https://open.feishu.cn";
}

export async function getTenantAccessToken(): Promise<string> {
  const now = Date.now();
  if (cache && cache.expiresAt > now + 60_000) return cache.token;

  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error("FEISHU_APP_ID / FEISHU_APP_SECRET not set");
  }

  const url = `${getFeishuBaseUrl()}/open-apis/auth/v3/tenant_access_token/internal`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  if (!res.ok) {
    throw new Error(`Feishu token HTTP ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as {
    code: number;
    msg: string;
    tenant_access_token?: string;
    expire?: number;
  };
  if (data.code !== 0 || !data.tenant_access_token) {
    throw new Error(`Feishu token error code=${data.code} msg=${data.msg}`);
  }
  const expireSec = data.expire ?? 7200;
  cache = {
    token: data.tenant_access_token,
    expiresAt: now + expireSec * 1000,
  };
  return cache.token;
}

export async function feishuFetch<T = unknown>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const token = await getTenantAccessToken();
  const url = `${getFeishuBaseUrl()}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let json: { code?: number; msg?: string; _raw?: string } & Record<string, unknown>;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { _raw: text };
  }
  if (!res.ok) throw new Error(`Feishu HTTP ${res.status}: ${text}`);
  if (typeof json.code === "number" && json.code !== 0) {
    throw new Error(`Feishu API error code=${json.code} msg=${json.msg ?? "unknown"}`);
  }
  return json as T;
}
