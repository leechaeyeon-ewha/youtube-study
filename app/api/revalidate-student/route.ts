import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

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

/** 관리자가 배정 정보를 수정한 뒤 호출. 학생/관리자/시청 페이지 캐시를 무효화해 최신 데이터가 보이도록 합니다. */
export async function POST(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "관리자만 호출할 수 있습니다." }, { status: 401 });
  }

  let assignmentIds: string[] = [];
  try {
    const body = await req.json().catch(() => ({}));
    if (Array.isArray(body?.assignmentIds)) {
      assignmentIds = body.assignmentIds.filter((id: unknown) => typeof id === "string" && id.length > 0);
    }
  } catch {
    // body 없음 허용
  }

  revalidatePath("/student");
  revalidatePath("/student/playlist/[id]");
  revalidatePath("/admin");
  revalidatePath("/admin/assign");
  revalidatePath("/admin/dashboard");
  for (const id of assignmentIds) {
    revalidatePath(`/watch/${encodeURIComponent(id)}`);
  }

  return NextResponse.json({ ok: true });
}
