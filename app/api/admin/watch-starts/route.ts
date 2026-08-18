import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/requireRole";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;


/** 관리자: 특정 배정(assignment)에 대한 학습 시작 시각 목록 조회 */
export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "관리자만 접근할 수 있습니다." }, { status: 401 });
  }
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "서버 설정이 없습니다." }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const assignmentId = searchParams.get("assignmentId");
  if (!assignmentId) {
    return NextResponse.json({ error: "assignmentId가 필요합니다." }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data, error } = await supabase
    .from("watch_starts")
    .select("id, started_at")
    .eq("assignment_id", assignmentId as string)
    .order("started_at", { ascending: false });

  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("could not find the table") || msg.includes("watch_starts") || msg.includes("does not exist")) {
      return NextResponse.json([]);
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data ?? []);
}
