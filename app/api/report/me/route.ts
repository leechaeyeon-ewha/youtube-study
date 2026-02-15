import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

/** 로그인한 학생 본인 리포트 (학생·학부모 동일 계정 시 학부모 보기용) */
export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "");
  if (!token || !supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ allowed: false }, { status: 401 });
  }

  const supabaseAnon = createClient(supabaseUrl, supabaseAnonKey);
  const userResult = await supabaseAnon.auth.getUser(token);
  const user = userResult?.data?.user ?? null;
  if (userResult?.error || !user) {
    return NextResponse.json({ allowed: false }, { status: 401 });
  }

  const supabase = serviceRoleKey
    ? createClient(supabaseUrl, serviceRoleKey)
    : supabaseAnon;

  const profileResult = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .eq("id", user.id)
    .single();
  const profile = profileResult?.data ?? null;
  if (profileResult?.error || !profile || profile.role !== "student") {
    return NextResponse.json({ allowed: false }, { status: 403 });
  }

  const now = new Date();
  const nowTs = now.getTime();
  if (!Number.isFinite(nowTs)) {
    return NextResponse.json({ allowed: false }, { status: 500 });
  }
  const weekAgo = new Date(nowTs - 7 * 24 * 60 * 60 * 1000);
  const monthAgo = new Date(nowTs - 30 * 24 * 60 * 60 * 1000);
  const weekIso = weekAgo.toISOString();
  const monthIso = monthAgo.toISOString();
  if (weekAgo.getTime() > nowTs || monthAgo.getTime() > nowTs) {
    return NextResponse.json({
      allowed: true,
      studentName: profile.full_name ?? "학생",
      weeklyCompletion: 0,
      monthlyCompletion: 0,
      recentVideos: [],
      comment: "최근 학습 이력이 없습니다. 꾸준한 시청을 권장합니다.",
    });
  }

  const { data: assignments } = await supabase
    .from("assignments")
    .select("id, is_completed, progress_percent, last_watched_at, videos(id, title)")
    .eq("user_id", profile.id);

  const list = (assignments ?? []) as {
    id: string;
    is_completed: boolean;
    progress_percent: number;
    last_watched_at: string | null;
    videos: { id: string; title: string }[] | null;
  }[];

  const inWeek = list.filter((a) => a.last_watched_at && a.last_watched_at >= weekIso);
  const inMonth = list.filter((a) => a.last_watched_at && a.last_watched_at >= monthIso);

  const weeklyCompletion =
    inWeek.length === 0 ? 0 : Math.round((inWeek.filter((a) => a.is_completed).length / inWeek.length) * 100);
  const monthlyCompletion =
    inMonth.length === 0 ? 0 : Math.round((inMonth.filter((a) => a.is_completed).length / inMonth.length) * 100);

  const safePercent = (p: unknown): number => {
    let n = 0;
    if (typeof p === "number" && Number.isFinite(p)) {
      n = p;
    } else if (typeof p === "string") {
      const parsed = parseFloat(p);
      n = Number.isFinite(parsed) ? parsed : 0;
    }
    return n >= 0 && n <= 100 ? n : 0;
  };

  const hasProgress = (a: { progress_percent?: unknown; last_watched_at: string | null }) =>
    safePercent(a.progress_percent) > 0 || (a.last_watched_at != null && a.last_watched_at !== "");

  const recentVideos = list
    .filter(hasProgress)
    .map((a) => {
      const v = Array.isArray(a.videos) ? a.videos[0] : a.videos;
      return {
        title: (v as { title?: string } | null)?.title ?? "영상",
        is_completed: Boolean(a.is_completed),
        progress_percent: safePercent(a.progress_percent),
        last_watched_at: a.last_watched_at,
      };
    })
    .sort((x, y) => (y.last_watched_at ?? "").localeCompare(x.last_watched_at ?? ""))
    .slice(0, 50);

  const rateForComment = inWeek.length > 0 ? weeklyCompletion : monthlyCompletion;
  const comment =
    rateForComment >= 80
      ? "성실하게 학습 중입니다."
      : rateForComment > 0
        ? "독려가 필요합니다."
        : "최근 학습 이력이 없습니다. 꾸준한 시청을 권장합니다.";

  return NextResponse.json({
    allowed: true,
    studentName: profile.full_name ?? "학생",
    weeklyCompletion,
    monthlyCompletion,
    recentVideos,
    comment,
  });
}
