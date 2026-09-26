// @nexus-office/api-client — typed client for the Nexus Office web API.
// Zero Next.js dependencies: the exact same functions serve browser sessions
// (apps/web, relative URLs + cookie auth) and the CLI (apps/cli, absolute
// base URL + Bearer token auth).

import type { PipelineRun, PipelineStep, Project } from "@nexus/pipeline-types";

export interface NexusClientConfig {
  /** Base URL of the Nexus Office web app. Default: same-origin. */
  baseUrl?: string;
  /** Supabase access token for non-browser callers (the CLI). */
  token?: string;
  /** Extra headers merged into every request. */
  headers?: Record<string, string>;
  fetchFn?: typeof fetch;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public body?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class NexusClient {
  readonly baseUrl: string;
  readonly token?: string;
  private headers: Record<string, string>;
  private fetchFn: typeof fetch;

  constructor(config: NexusClientConfig = {}) {
    this.baseUrl = (config.baseUrl ?? "").replace(/\/$/, "");
    this.token = config.token;
    this.headers = config.headers ?? {};
    this.fetchFn = config.fetchFn ?? ((...args) => fetch(...args));
  }

  async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<{ status: number; data: T | null; raw: Response }> {
    const raw = await this.requestRaw(method, path, body);
    const data = raw.headers.get("content-type")?.includes("application/json")
      ? await raw.json().catch(() => null)
      : null;
    return { status: raw.status, data: data as T | null, raw };
  }

  /** Raw fetch without JSON parsing (used by the SSE pipeline client). */
  async requestRaw(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {}
  ): Promise<Response> {
    return this.fetchFn(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...this.headers,
        ...extraHeaders,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  }

  async expect<T>(method: string, path: string, body?: unknown): Promise<T> {
    const { status, data } = await this.request<T>(method, path, body);
    if (status >= 400) {
      const payload = (data ?? {}) as { error?: string; code?: string };
      throw new ApiError(status, payload.error ?? `Request failed (${status})`, payload.code, data);
    }
    return data as T;
  }
}

// Re-exported for consumer convenience.
export type { PipelineRun, PipelineStep, Project } from "@nexus/pipeline-types";
