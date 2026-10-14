// The one place a request leaves the process. Returns the status and the
// body as text; never throws on an HTTP status, only on a transport
// failure (no network, DNS, timeout).

import { CliError } from './errors.ts';

export interface HttpRequest {
  method: 'GET' | 'POST';
  url: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface HttpResponse {
  status: number;
  body: string;
}

export type HttpClient = (request: HttpRequest) => Promise<HttpResponse>;

export function createHttpClient(timeoutMs: number): HttpClient {
  return async ({ method, url, headers, body }) => {
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: method === 'POST' ? (body ?? '') : undefined,
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'follow',
      });
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      throw new CliError(`request to ${url} failed: ${reason}`);
    }
    return { status: response.status, body: await response.text() };
  };
}

export function isSuccess(status: number): boolean {
  return status >= 200 && status < 300;
}

/** Parses a JSON object body; anything else (markdown, empty, an array) is undefined. */
export function parseJsonObject(body: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(body);
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    // not JSON
  }
  return undefined;
}

export function stringField(object: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = object?.[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}
