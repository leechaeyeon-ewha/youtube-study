import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { extractYoutubePlaylistId } from "@/lib/youtube";

function getEnv() {
  return {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    youtubeApiKey: (process.env.YOUTUBE_API_KEY ?? "").trim(),
  };
}

async function requireAdmin(req: Request, env: ReturnType<typeof getEnv>) {
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "");
  if (!token || !env.supabaseUrl || !env.supabaseAnonKey) return null;
  const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey);
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return null;
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  return profile?.role === "admin" ? user : null;
}

interface PlaylistItem {
  videoId: string;
  title: string;
}

async function fetchPlaylistItems(playlistId: string, youtubeApiKey: string): Promise<{ title: string; items: PlaylistItem[] }> {
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
  try {
    const env = getEnv();

    const admin = await requireAdmin(req, env);
    if (!admin) {
      return NextResponse.json({ error: "관리자만 접근할 수 있습니다." }, { status: 401 });
    }
    if (!env.supabaseUrl || !env.serviceRoleKey) {
      return NextResponse.json(
        { error: "서버 설정이 없습니다. Vercel 환경 변수에 NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY를 추가해 주세요." },
        { status: 500 }
      );
    }
    if (!env.youtubeApiKey) {
      return NextResponse.json(
        { error: "YOUTUBE_API_KEY가 설정되지 않았습니다. Vercel 환경 변수에 YOUTUBE_API_KEY를 추가한 뒤 재배포해 주세요." },
        { status: 500 }
      );
    }

    let body: { playlist_url?: string; course_title?: string };
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    const playlistUrl = typeof body.playlist_url === "string" ? body.playlist_url.trim() : "";
    const courseTitleInput = typeof body.course_title === "string" ? body.course_title.trim() : "";

    if (!playlistUrl) {
      return NextResponse.json({ error: "재생목록 URL을 입력해 주세요." }, { status: 400 });
    }

    let playlistId: string | null = null;
    try {
      playlistId = extractYoutubePlaylistId(playlistUrl);
    } catch {
      // extract 실패 시 null
    }
    if (!playlistId) {
      return NextResponse.json(
        { error: "유효한 YouTube 재생목록 URL을 입력해 주세요. (list= 재생목록 ID 포함)" },
        { status: 400 }
      );
    }

    let playlistTitle: string;
    let items: PlaylistItem[];

    try {
      const result = await fetchPlaylistItems(playlistId, env.youtubeApiKey);
      playlistTitle = result.title;
      items = result.items;
    } catch (err) {
      const message = err instanceof Error ? err.message : "재생목록을 가져오지 못했습니다.";
      return NextResponse.json(
        { error: message },
        { status: message.includes("YOUTUBE_API_KEY") ? 500 : 400 }
      );
    }

    if (items.length === 0) {
      return NextResponse.json({ error: "재생목록에 영상이 없습니다." }, { status: 400 });
    }

    const supabase = createClient(env.supabaseUrl, env.serviceRoleKey);
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
      const msg = courseError?.message ?? "강좌 생성에 실패했습니다.";
      const friendly =
        msg.includes("relation") || msg.includes("does not exist")
          ? "courses 테이블이 없습니다. Supabase SQL Editor에서 schema_full_final.sql 또는 migration_courses.sql을 실행해 주세요."
          : msg;
      return NextResponse.json({ error: friendly }, { status: 500 });
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
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `재생목록 등록 중 오류가 발생했습니다. ${message}` },
      { status: 500 }
    );
  }
}
