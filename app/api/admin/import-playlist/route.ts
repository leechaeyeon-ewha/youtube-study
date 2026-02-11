import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { extractYoutubePlaylistId } from "@/lib/youtube";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const youtubeApiKey = process.env.YOUTUBE_API_KEY;

async function requireAdmin(req: Request) {
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "");
  if (!token || !supabaseUrl || !supabaseAnonKey) return null;
  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return null;
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  return profile?.role === "admin" ? user : null;
}

interface PlaylistItem {
  videoId: string;
  title: string;
}

async function fetchPlaylistItems(playlistId: string): Promise<{ title: string; items: PlaylistItem[] }> {
  if (!youtubeApiKey) {
    throw new Error("YOUTUBE_API_KEY가 설정되지 않았습니다. .env.local에 추가해 주세요.");
  }

  const baseUrl = "https://www.googleapis.com/youtube/v3";

  const playlistRes = await fetch(
    `${baseUrl}/playlists?part=snippet&id=${encodeURIComponent(playlistId)}&key=${youtubeApiKey}`
  );
  const playlistData = await playlistRes.json();
  const playlistTitle =
    playlistData.items?.[0]?.snippet?.title ?? `재생목록 ${playlistId}`;

  const items: PlaylistItem[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(`${baseUrl}/playlistItems`);
    url.searchParams.set("part", "snippet");
    url.searchParams.set("playlistId", playlistId);
    url.searchParams.set("maxResults", "50");
    url.searchParams.set("key", youtubeApiKey);
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url.toString());
    const data = await res.json();

    if (data.error) {
      throw new Error(data.error.message ?? "YouTube API 오류");
    }

    for (const item of data.items ?? []) {
      const videoId = item.snippet?.resourceId?.videoId;
      const title = item.snippet?.title ?? `영상 ${videoId}`;
      if (videoId) items.push({ videoId, title });
    }

    pageToken = data.nextPageToken;
  } while (pageToken);

  return { title: playlistTitle, items };
}

export async function POST(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "관리자만 접근할 수 있습니다." }, { status: 401 });
  }
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "서버 설정이 없습니다. SUPABASE_SERVICE_ROLE_KEY를 설정해 주세요." },
      { status: 500 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const playlistUrl = typeof body.playlist_url === "string" ? body.playlist_url.trim() : "";
  const courseTitleInput = typeof body.course_title === "string" ? body.course_title.trim() : "";

  if (!playlistUrl) {
    return NextResponse.json({ error: "재생목록 URL을 입력해 주세요." }, { status: 400 });
  }

  const playlistId = extractYoutubePlaylistId(playlistUrl);
  if (!playlistId) {
    return NextResponse.json(
      { error: "유효한 YouTube 재생목록 URL을 입력해 주세요. (list= 재생목록 ID 포함)" },
      { status: 400 }
    );
  }

  let playlistTitle: string;
  let items: PlaylistItem[];

  try {
    const result = await fetchPlaylistItems(playlistId);
    playlistTitle = result.title;
    items = result.items;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "재생목록을 가져오지 못했습니다." },
      { status: 400 }
    );
  }

  if (items.length === 0) {
    return NextResponse.json({ error: "재생목록에 영상이 없습니다." }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const courseTitle = courseTitleInput || playlistTitle;

  const { data: course, error: courseError } = await supabase
    .from("courses")
    .insert({
      title: courseTitle,
      playlist_id: playlistId,
    })
    .select("id")
    .single();

  if (courseError || !course?.id) {
    return NextResponse.json(
      { error: courseError?.message ?? "강좌 생성에 실패했습니다." },
      { status: 500 }
    );
  }

  let added = 0;
  let skipped = 0;

  for (const { videoId, title } of items) {
    const { data: existing } = await supabase
      .from("videos")
      .select("id")
      .eq("video_id", videoId)
      .maybeSingle();

    if (existing) {
      await supabase.from("videos").update({ course_id: course.id }).eq("id", existing.id);
      skipped += 1;
    } else {
      const { error: insertErr } = await supabase.from("videos").insert({
        title,
        video_id: videoId,
        course_id: course.id,
      });
      if (!insertErr) added += 1;
    }
  }

  return NextResponse.json({
    courseId: course.id,
    courseTitle,
    added,
    skipped,
    total: items.length,
  });
}
