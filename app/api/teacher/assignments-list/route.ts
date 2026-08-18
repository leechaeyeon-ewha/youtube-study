import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { ASSIGNMENT_SELECT_ADMIN } from "@/lib/assignments";
import { requireTeacher } from "@/lib/auth/requireRole";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;


/** 강사 전용: 본인 담당 학생들의 배정 목록만 조회 */
export async function GET(req: Request) {
  const teacher = await requireTeacher(req);
  if (!teacher) {
    return NextResponse.json({ error: "강사만 접근할 수 있습니다." }, { status: 401 });
  }
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "서버 설정이 없습니다." },
      { status: 500 }
    );
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: studentRows } = await supabase
    .from("profiles")
    .select("id")
    .eq("role", "student")
    .eq("teacher_id", teacher.id);

  const studentIds = (studentRows ?? []).map((r) => (r as { id: string }).id);
  if (studentIds.length === 0) {
    return NextResponse.json([]);
  }

  /** Supabase 기본 최대 행 수(1000)를 넘어도 배정 전부 반환하기 위해 1000개 단위 페이지 조회 후 합침 */
  const PAGE_SIZE = 1000;
  const all: unknown[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from("assignments")
      .select(ASSIGNMENT_SELECT_ADMIN)
      .in("user_id", studentIds)
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const list = data ?? [];
    all.push(...list);
    if (list.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return NextResponse.json(all);
}
