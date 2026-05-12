import { BRIDGE_BASE, requireBridgeToken } from "./config";

const REQUEST_TIMEOUT_MS = 8000;

export class BridgeError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string, message: string) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export async function bridgeFetch<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${BRIDGE_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${requireBridgeToken()}`,
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new BridgeError(
        res.status,
        text,
        `bridge ${path} failed: ${res.status} ${text.slice(0, 200)}`
      );
    }
    return text ? (JSON.parse(text) as T) : (undefined as T);
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error(`bridge ${path} timed out after ${REQUEST_TIMEOUT_MS}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
