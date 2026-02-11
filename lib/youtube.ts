/**
 * YouTube URL에서 비디오 ID 추출
 * 지원: watch?v=, youtu.be/, embed/
 */
export function extractYoutubeVideoId(url: string): string | null {
  const trimmed = url.trim();
  const watchMatch = trimmed.match(/(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/);
  if (watchMatch) return watchMatch[1];
  const shortMatch = trimmed.match(/(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (shortMatch) return shortMatch[1];
  const embedMatch = trimmed.match(/(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
  if (embedMatch) return embedMatch[1];
  return null;
}

/**
 * YouTube URL에서 재생목록(playlist) ID 추출
 * 지원: playlist?list=, watch?list=, youtu.be/...?list=
 */
export function extractYoutubePlaylistId(url: string): string | null {
  const trimmed = url.trim();
  const listMatch = trimmed.match(/[?&]list=([a-zA-Z0-9_-]+)/);
  return listMatch ? listMatch[1] : null;
}

export function getThumbnailUrl(videoId: string): string {
  return `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
}
