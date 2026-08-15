import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { Pool } from "pg";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const CLASS_PROGRESS_SQL = `
SELECT p.class_id AS class_id,
       ROUND(AVG(a.progress_percent)::numeric, 1) AS avg_progress
FROM public.assignments a
INNER JOIN public.profiles p ON p.id = a.user_id
WHERE p.class_id IS NOT NULL
GROUP BY p.class_id
`;

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

function rowsToClassProgress(
  rows: { class_id: string; avg_progress: number | string }[]
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    out[row.class_id] = Number(row.avg_progress);
  }
  return out;
}

/** DATABASE_URL이 있으면 SQL GROUP BY로 집계 (권장) */
async function aggregateWithPg(): Promise<Record<string, number> | null> {
  const databaseUrl = process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL;
  if (!databaseUrl) return null;

  const pool = new Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
  try {
    const result = await pool.query<{ class_id: string; avg_progress: string }>(CLASS_PROGRESS_SQL);
    return rowsToClassProgress(result.rows);
  } finally {
    await pool.end();
  }
}

/** DATABASE_URL 없을 때 서비스 롤 + 최소 컬럼 paginate 후 서버에서 집계 */
async function aggregateWithSupabase(supabase: SupabaseClient): Promise<Record<string, number>> {
  const totals = new Map<string, { sum: number; count: number }>();
  const PAGE_SIZE = 1000;
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from("assignments")
      .select("progress_percent, profiles!inner(class_id)")
      .not("profiles.class_id", "is", null)
      .order("id")
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) break;

    const list = data ?? [];
    for (const row of list) {
      const profile = row.profiles as { class_id?: string | null } | { class_id?: string | null }[] | null;
      const classId = Array.isArray(profile) ? profile[0]?.class_id : profile?.class_id;
      if (!classId) continue;
      const pct = Number(row.progress_percent ?? 0);
      const entry = totals.get(classId) ?? { sum: 0, count: 0 };
      entry.sum += pct;
      entry.count += 1;
      totals.set(classId, entry);
    }

    if (list.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  const out: Record<string, number> = {};
  totals.forEach(({ sum, count }, classId) => {
    out[classId] = count === 0 ? 0 : Math.round((sum / count) * 10) / 10;
  });
  return out;
}

/** 관리자 전용: 반(class_id)별 assignments.progress_percent 평균 */
export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "관리자만 접근할 수 있습니다." }, { status: 401 });
  }

  try {
    let classProgress = await aggregateWithPg();
    if (classProgress === null) {
      if (!supabaseUrl || !serviceRoleKey) {
        return NextResponse.json({ error: "서버 설정이 없습니다." }, { status: 500 });
      }
      const supabase = createClient(supabaseUrl, serviceRoleKey);
      classProgress = await aggregateWithSupabase(supabase);
    }
    return NextResponse.json({ classProgress });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
