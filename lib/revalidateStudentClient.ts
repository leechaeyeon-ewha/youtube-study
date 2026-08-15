const DEFAULT_MAX_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 500;

/**
 * 관리자 배정 변경 후 학생/관리자/시청 페이지 Next.js 캐시 무효화.
 * fire-and-forget 대신 최대 3회 지수 백오프 재시도.
 */
export async function revalidateStudentPaths(
  accessToken: string,
  assignmentIds: string[] = [],
  options?: { maxAttempts?: number }
): Promise<boolean> {
  const maxAttempts = options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetch("/api/revalidate-student", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ assignmentIds }),
        cache: "no-store",
      });
      if (res.ok) return true;
    } catch {
      // retry
    }

    if (attempt < maxAttempts - 1) {
      await new Promise((resolve) =>
        setTimeout(resolve, BASE_RETRY_DELAY_MS * Math.pow(2, attempt))
      );
    }
  }

  return false;
}

/** fire-and-forget 래퍼 — UI 블로킹 없이 백그라운드 재시도 */
export function revalidateStudentPathsInBackground(
  accessToken: string,
  assignmentIds: string[] = []
): void {
  void revalidateStudentPaths(accessToken, assignmentIds);
}
