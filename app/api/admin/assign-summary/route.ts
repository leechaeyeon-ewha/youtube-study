import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { Pool } from "pg";
import { requireAdmin } from "@/lib/auth/requireRole";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const PAGE_SIZE = 1000;

const SUMMARY_SQL = `
SELECT user_id,
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE is_completed = true)::int AS completed,
       COUNT(*) FILTER (WHERE is_priority = true)::int AS priority
FROM public.assignments
GROUP BY user_id
`;

export interface AssignSummaryEntry {
  total: number;
  completed: number;
  priority: number;
}

function rowsToByUser(
  rows: { user_id: string; total: number; completed: number; priority: number }[]
): Record<string, AssignSummaryEntry> {
  const byUser: Record<string, AssignSummaryEntry> = {};
  for (const row of rows) {
    byUser[row.user_id] = {
      total: row.total,
      completed: row.completed,
      priority: row.priority,
    };
  }
  return byUser;
}

async function aggregateWithPg(): Promise<Record<string, AssignSummaryEntry> | null> {
  const databaseUrl = process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL;
  if (!databaseUrl) return null;

  const pool = new Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
  try {
    const result = await pool.query<{
      user_id: string;
      total: number;
      completed: number;
      priority: number;
    }>(SUMMARY_SQL);
    return rowsToByUser(result.rows);
  } finally {
    await pool.end();
  }
}

async function aggregateWithSupabase(
  supabase: SupabaseClient
): Promise<Record<string, AssignSummaryEntry>> {
  const totals = new Map<string, AssignSummaryEntry>();

  const { count, error: countError } = await supabase
    .from("assignments")
    .select("*", { count: "exact", head: true });

  if (countError || !count) {
    return {};
  }

  const pageCount = Math.ceil(count / PAGE_SIZE);
  const offsets = Array.from({ length: pageCount }, (_, i) => i * PAGE_SIZE);

  const pages = await Promise.all(
    offsets.map((offset) =>
      supabase
        .from("assignments")
        .select("user_id, is_completed, is_priority")
        .order("id")
        .range(offset, offset + PAGE_SIZE - 1)
    )
  );

  for (const page of pages) {
    if (page.error) break;
    for (const row of (page.data ?? []) as {
      user_id: string;
      is_completed: boolean | null;
      is_priority: boolean | null;
    }[]) {
      const uid = row.user_id;
      const entry = totals.get(uid) ?? { total: 0, completed: 0, priority: 0 };
      entry.total += 1;
      if (row.is_completed) entry.completed += 1;
      if (row.is_priority) entry.priority += 1;
      totals.set(uid, entry);
    }
  }

  return Object.fromEntries(totals);
}

/** 관리자: 학생별 배정 건수·완료·우선 학습 집계 */
export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "관리자만 접근할 수 있습니다." }, { status: 401 });
  }

  try {
    let byUser = await aggregateWithPg();
    if (byUser === null) {
      if (!supabaseUrl || !serviceRoleKey) {
        return NextResponse.json({ error: "서버 설정이 없습니다." }, { status: 500 });
      }
      const supabase = createClient(supabaseUrl, serviceRoleKey);
      byUser = await aggregateWithSupabase(supabase);
    }
    return NextResponse.json({ byUser });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
