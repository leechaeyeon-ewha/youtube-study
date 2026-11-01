const DEFAULT_ATTEMPTS = 3;
const BASE_DELAY_MS = 400;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 5xx·408·네트워크 오류만 짧은 backoff로 재시도 */
export async function fetchProgressWithRetry(
  url: string,
  init: RequestInit,
  options?: { maxAttempts?: number }
): Promise<Response> {
  const maxAttempts = options?.maxAttempts ?? DEFAULT_ATTEMPTS;
  let lastResponse: Response | null = null;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetch(url, init);
      lastResponse = res;
      if (res.ok) return res;
      const retryable = res.status >= 500 || res.status === 408;
      if (!retryable || attempt === maxAttempts - 1) return res;
    } catch (err) {
      lastError = err;
      if (attempt === maxAttempts - 1) throw err;
    }
    await sleep(BASE_DELAY_MS * (attempt + 1));
  }

  if (lastResponse) return lastResponse;
  throw lastError instanceof Error ? lastError : new Error("progress request failed");
}

export function warnProgressFailure(message: string, detail?: unknown): void {
  if (process.env.NODE_ENV === "development") {
    console.warn(message, detail ?? "");
  }
}
