import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const youtubeApiKey = (process.env.YOUTUBE_API_KEY ?? "").trim();

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

const YOUTUBE_VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos";
const BATCH_SIZE = 50;

/** 관리자: 등록된 모든 영상의 제목을 YouTube 현재 제목으로 일괄 업데이트 */
export async function POST(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "관리자만 접근할 수 있습니다." }, { status: 401 });
  }
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "서버 설정이 없습니다." }, { status: 500 });
  }
  if (!youtubeApiKey) {
    return NextResponse.json(
      { error: "YOUTUBE_API_KEY가 설정되지 않았습니다. Vercel 환경 변수에 YOUTUBE_API_KEY를 추가한 뒤 재배포해 주세요." },
      { status: 500 }
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data: videos, error: fetchErr } = await supabase
    .from("videos")
    .select("id, video_id, title");

  if (fetchErr || !videos?.length) {
    return NextResponse.json(
      { updated: 0, total: 0, message: videos?.length === 0 ? "등록된 영상이 없습니다." : fetchErr?.message ?? "영상 목록 조회 실패" }
    );
  }

  let updated = 0;
  const videoIdToDbId = new Map<string, { id: string; currentTitle: string }>();
  for (const v of videos) {
    if (v.video_id) videoIdToDbId.set(v.video_id, { id: v.id, currentTitle: v.title ?? "" });
  }
  const allVideoIds = Array.from(videoIdToDbId.keys());

  for (let i = 0; i < allVideoIds.length; i += BATCH_SIZE) {
    const batch = allVideoIds.slice(i, i + BATCH_SIZE);
    const url = `${YOUTUBE_VIDEOS_URL}?part=snippet&id=${batch.map((id) => encodeURIComponent(id)).join(",")}&key=${youtubeApiKey}`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.error) {
      return NextResponse.json(
        { error: data.error.message ?? "YouTube API 오류", updated, total: videos.length },
        { status: 400 }
      );
    }

    for (const item of data.items ?? []) {
      const videoId = item.id;
      const newTitle = item.snippet?.title?.trim();
      const row = videoIdToDbId.get(videoId);
      if (!row || !newTitle || newTitle === row.currentTitle) continue;

      const { error: updateErr } = await supabase.from("videos").update({ title: newTitle }).eq("id", row.id);
      if (!updateErr) {
        updated += 1;
        row.currentTitle = newTitle;
      }
    }
  }

  return NextResponse.json({
    updated,
    total: videos.length,
    message: `${videos.length}개 영상 중 ${updated}개 제목을 YouTube 기준으로 업데이트했습니다.`,
  });
}
