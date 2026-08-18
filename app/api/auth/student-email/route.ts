import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/** 로그인 전 이름→이메일 조회 남용 방지 (IP당 분당 최대 횟수) */
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 15;
const rateLimitByIp = new Map<string, { count: number; resetAt: number }>();

function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip") ?? "unknown";
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitByIp.get(ip);
  if (!entry || now >= entry.resetAt) {
    rateLimitByIp.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  if (entry.count >= RATE_LIMIT_MAX) {
    return true;
  }
  entry.count += 1;
  return false;
}

export async function POST(req: Request) {
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "서버 설정이 없습니다." },
      { status: 500 }
    );
  }

  const clientIp = getClientIp(req);
  if (isRateLimited(clientIp)) {
    return NextResponse.json(
      { error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." },
      { status: 429 }
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
    .eq("role", "student")
    .eq("full_name", fullName)
    .limit(1)
    .maybeSingle();

  if (error || !data?.email) {
    return NextResponse.json(
      { error: "등록된 학생이 없거나 이름이 일치하지 않습니다." },
      { status: 404 }
    );
  }

  return NextResponse.json({ email: data.email });
}
