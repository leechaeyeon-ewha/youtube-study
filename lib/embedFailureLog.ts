import { getAccessTokenSync } from "@/lib/auth/accessTokenStore";
import { getIsInAppBrowser, getIsStandalone } from "@/components/KakaoBrowserBanner";

export type EmbedEventKind = "error" | "ready_timeout" | "user_report";

const MAX_BODY_BYTES = 2048;

export function postEmbedFailureLog(
  params: {
    assignmentId: string;
    videoId: string;
    eventKind: EmbedEventKind;
    errorCode?: number | null;
  },
  options?: { keepalive?: boolean }
): void {
  try {
    const token = getAccessTokenSync();
    if (!token?.trim()) return;

    const payload = {
      assignment_id: params.assignmentId,
      video_id: params.videoId,
      event_kind: params.eventKind,
      error_code:
        params.errorCode != null && Number.isFinite(Number(params.errorCode))
          ? Number(params.errorCode)
          : null,
      user_agent:
        typeof navigator !== "undefined"
          ? String(navigator.userAgent).slice(0, 300)
          : "",
      is_standalone: getIsStandalone(),
      is_in_app_browser: getIsInAppBrowser(),
      is_online: typeof navigator !== "undefined" ? navigator.onLine : null,
      client_at: new Date().toISOString(),
    };

    const body = JSON.stringify(payload);
    if (body.length > MAX_BODY_BYTES) return;

    void fetch("/api/watch-embed-log", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body,
      keepalive: options?.keepalive ?? true,
    }).catch(() => {});
  } catch {
    // ignore
  }
}
