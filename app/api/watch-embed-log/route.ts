import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const MAX_BODY_BYTES = 2048;
const MAX_USER_AGENT_LEN = 300;
const DEDUP_MS = 5 * 60 * 1000;
const HOURLY_LIMIT = 20;

const EVENT_KINDS = new Set(["error", "ready_timeout", "user_report"]);

type BodyIn = {
  assignment_id?: unknown;
  video_id?: unknown;
  event_kind?: unknown;
  error_code?: unknown;
  user_agent?: unknown;
  is_standalone?: unknown;
  is_in_app_browser?: unknown;
  is_online?: unknown;
  client_at?: unknown;
};

export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "");
  if (!token || !supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "요청 크기가 너무 큽니다." }, { status: 413 });
  }

  let parsed: BodyIn;
  try {
    parsed = JSON.parse(raw) as BodyIn;
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const assignmentId =
    typeof parsed.assignment_id === "string" ? parsed.assignment_id.trim() : "";
  const videoId = typeof parsed.video_id === "string" ? parsed.video_id.trim() : "";
  const eventKind =
    typeof parsed.event_kind === "string" ? parsed.event_kind.trim() : "";

  if (!assignmentId || !videoId) {
    return NextResponse.json({ error: "assignment_id, video_id가 필요합니다." }, { status: 400 });
  }
  if (!EVENT_KINDS.has(eventKind)) {
    return NextResponse.json({ error: "event_kind가 올바르지 않습니다." }, { status: 400 });
  }

  let errorCode: number | null = null;
  if (parsed.error_code != null && parsed.error_code !== "") {
    const n = Number(parsed.error_code);
    if (!Number.isFinite(n)) {
      return NextResponse.json({ error: "error_code가 올바르지 않습니다." }, { status: 400 });
    }
    errorCode = n;
  }

  const userAgent =
    typeof parsed.user_agent === "string"
      ? parsed.user_agent.slice(0, MAX_USER_AGENT_LEN)
      : "";
  const isStandalone = parsed.is_standalone === true;
  const isInAppBrowser = parsed.is_in_app_browser === true;
  const isOnline =
    parsed.is_online === true ? true : parsed.is_online === false ? false : null;

  let clientAt: string | null = null;
  if (typeof parsed.client_at === "string" && parsed.client_at.trim()) {
    const t = Date.parse(parsed.client_at);
    if (Number.isFinite(t)) clientAt = new Date(t).toISOString();
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { data: assignment, error: assignErr } = await supabase
    .from("assignments")
    .select("id")
    .eq("id", assignmentId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (assignErr || !assignment) {
    return NextResponse.json({ error: "해당 과제를 찾을 수 없습니다." }, { status: 404 });
  }

  const sinceHour = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count: hourCount, error: hourErr } = await supabase
    .from("watch_embed_failures")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", sinceHour);

  if (!hourErr && hourCount != null && hourCount >= HOURLY_LIMIT) {
    return NextResponse.json({ ok: true, skipped: true, reason: "hourly_limit" });
  }

  const sinceDedup = new Date(Date.now() - DEDUP_MS).toISOString();
  const { data: recent, error: dedupErr } = await supabase
    .from("watch_embed_failures")
    .select("id")
    .eq("user_id", user.id)
    .eq("assignment_id", assignmentId)
    .eq("event_kind", eventKind)
    .gte("created_at", sinceDedup)
    .limit(1);

  if (!dedupErr && recent && recent.length > 0) {
    return NextResponse.json({ ok: true, skipped: true, reason: "dedup" });
  }

  const { error: insertErr } = await supabase.from("watch_embed_failures").insert({
    user_id: user.id,
    assignment_id: assignmentId,
    video_id: videoId,
    event_kind: eventKind,
    error_code: errorCode,
    user_agent: userAgent,
    is_standalone: isStandalone,
    is_in_app_browser: isInAppBrowser,
    is_online: isOnline,
    client_at: clientAt,
  });

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
