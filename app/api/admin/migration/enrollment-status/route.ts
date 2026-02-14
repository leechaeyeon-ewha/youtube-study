import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { Pool } from "pg";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function requireAdmin(req: Request) {
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "");
  if (!token || !supabaseUrl || !supabaseAnonKey) return null;
  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const userResult = await supabase.auth.getUser(token);
  const user = userResult?.data?.user ?? null;
  if (!user) return null;
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  return profile?.role === "admin" ? user : null;
}

/** 관리자 전용: enrollment_status 컬럼 추가 마이그레이션 실행 (DATABASE_URL 필요) */
export async function POST(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "관리자만 실행할 수 있습니다." }, { status: 401 });
  }

  const databaseUrl = process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL;
  if (!databaseUrl) {
    return NextResponse.json(
      {
        error: "DATABASE_URL이 설정되지 않았습니다. Supabase 대시보드 → Project Settings → Database → Connection string (URI) 을 복사해 Vercel 환경 변수 DATABASE_URL에 추가한 뒤 다시 시도하세요. 또는 아래 SQL을 Supabase SQL Editor에서 직접 실행하세요.",
        sql: `alter table public.profiles
  add column if not exists enrollment_status text not null default 'enrolled'
  check (enrollment_status in ('enrolled', 'withdrawn'));

comment on column public.profiles.enrollment_status is 'enrolled: 재원생, withdrawn: 퇴원생';`,
      },
      { status: 400 }
    );
  }

  const sql = `
alter table public.profiles
  add column if not exists enrollment_status text not null default 'enrolled'
  check (enrollment_status in ('enrolled', 'withdrawn'));

comment on column public.profiles.enrollment_status is 'enrolled: 재원생, withdrawn: 퇴원생';
`.trim();

  try {
    const pool = new Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
    await pool.query(sql);
    await pool.end();
    return NextResponse.json({ success: true, message: "enrollment_status 컬럼이 추가되었습니다." });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `마이그레이션 실행 실패: ${message}` },
      { status: 500 }
    );
  }
}
