import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const token = (await params).token?.trim();
  if (!token || !supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ allowed: false }, { status: 404 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, full_name, is_report_enabled")
    .eq("report_token", token)
    .eq("role", "student")
    .single();

  if (profileError || !profile || !profile.is_report_enabled) {
    return NextResponse.json({ allowed: false }, { status: 403 });
  }

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const weekIso = weekAgo.toISOString();
  const monthIso = monthAgo.toISOString();

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

  const recentVideos = inWeek
    .map((a) => {
      const v = Array.isArray(a.videos) ? a.videos[0] : a.videos;
      return {
        title: (v as { title?: string } | null)?.title ?? "영상",
        is_completed: a.is_completed,
        last_watched_at: a.last_watched_at,
      };
    })
    .sort((x, y) => (y.last_watched_at ?? "").localeCompare(x.last_watched_at ?? ""))
    .slice(0, 20);

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
