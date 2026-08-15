/** AuthProvider가 갱신 — hooks 없이 warm-up·YoutubePlayer 등에서 동기 접근 */
let currentAccessToken: string | null = null;
let currentUserId: string | null = null;

export function getAccessTokenSync(): string | null {
  return currentAccessToken;
}

export function getUserIdSync(): string | null {
  return currentUserId;
}

export function setAuthSync(accessToken: string | null, userId: string | null): void {
  currentAccessToken = accessToken;
  currentUserId = userId;
}

export function authHeadersFromToken(accessToken: string | null): Record<string, string> {
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}
