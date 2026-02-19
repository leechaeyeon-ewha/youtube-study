import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// 강사 이름으로 이메일 조회 (강사 로그인용)
export async function POST(req: Request) {
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "서버 설정이 없습니다." },
      { status: 500 }
    );
  }
  const body = await req.json();
  const fullName = typeof body.full_name === "string" ? body.full_name.trim() : "";
  if (!fullName) {
    return NextResponse.json({ error: "이름을 입력해 주세요." }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data, error } = await supabase
    .from("profiles")
    .select("email")
    .eq("role", "teacher")
    .ilike("full_name", fullName)
    .limit(1)
    .maybeSingle();

  if (error || !data?.email) {
    return NextResponse.json(
      { error: "등록된 강사가 없거나 이름이 일치하지 않습니다." },
      { status: 404 }
    );
  }

  return NextResponse.json({ email: data.email });
}

