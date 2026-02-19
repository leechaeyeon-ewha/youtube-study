import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function requireTeacher(req: Request) {
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "");
  if (!token || !supabaseUrl || !supabaseAnonKey) return null;
  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return null;
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  return profile?.role === "teacher" ? user : null;
}

/** 강사: 영상 목록 조회 (배정용). 삭제 불가. */
export async function GET(req: Request) {
  const teacher = await requireTeacher(req);
  if (!teacher) {
    return NextResponse.json({ error: "강사만 접근할 수 있습니다." }, { status: 401 });
  }
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "서버 설정이 없습니다." }, { status: 500 });
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data, error } = await supabase
    .from("videos")
    .select("id, title, video_id, course_id, courses(id, title)")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

/** 강사: 새 영상 등록만 가능. 삭제 API 없음. */
export async function POST(req: Request) {
  const teacher = await requireTeacher(req);
  if (!teacher) {
    return NextResponse.json({ error: "강사만 접근할 수 있습니다." }, { status: 401 });
  }
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "서버 설정이 없습니다." }, { status: 500 });
  }
  const body = await req.json().catch(() => ({}));
  const url = typeof body.url === "string" ? body.url.trim() : "";
  const videoIdFromBody = typeof body.video_id === "string" ? body.video_id.trim() : "";
  let videoId = videoIdFromBody;
  if (!videoId && url) {
    const { extractYoutubeVideoId } = await import("@/lib/youtube");
    videoId = extractYoutubeVideoId(url) ?? "";
  }
  if (!videoId || videoId.length !== 11) {
    return NextResponse.json({ error: "유효한 YouTube 영상 ID 또는 URL을 입력해 주세요." }, { status: 400 });
  }
  const title = typeof body.title === "string" && body.title.trim()
    ? body.title.trim()
    : `영상 ${videoId}`;

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data: inserted, error } = await supabase
    .from("videos")
    .insert({ title, video_id: videoId })
    .select("id, title, video_id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "이미 등록된 영상입니다." }, { status: 400 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(inserted);
}
