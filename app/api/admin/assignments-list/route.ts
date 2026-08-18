import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { fetchAllAssignmentsAdmin } from "@/lib/adminAssignmentsList";
import { requireAdmin } from "@/lib/auth/requireRole";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;


/** 관리자: 전체 배정 목록 조회 (Supabase 1000행 제한을 넘어도 전부 반환) */
export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "관리자만 접근할 수 있습니다." }, { status: 401 });
  }
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "서버 설정이 없습니다." }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data, error } = await fetchAllAssignmentsAdmin(supabase);

  if (error) {
    return NextResponse.json({ error }, { status: 500 });
  }

  return NextResponse.json(data);
}
