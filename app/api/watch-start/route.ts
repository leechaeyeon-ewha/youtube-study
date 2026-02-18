import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const LOG_PREFIX = "[watch-start API]";

/** 진도 1% 이상이 된 시점에 한 번만 assignments.started_at 기록 (이미 있으면 덮어쓰지 않음). 동시에 watch_starts 테이블에 학습 시작 시각 1건 INSERT (관리자 시청 상세에서 목록 표시용). */
export async function POST(req: Request) {
  console.log(LOG_PREFIX, "1. 요청 수신");

  const authHeader = req.headers.get("authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "");
  if (!token || !supabaseUrl || !supabaseAnonKey) {
    console.error(LOG_PREFIX, "2. 인증 실패: token 또는 env 없음");
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }
  console.log(LOG_PREFIX, "2. token 존재함");

  // 학생의 토큰을 Supabase 클라이언트에 붙여서 RLS가 정상 동작하도록 설정
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    console.error(LOG_PREFIX, "3. getUser 실패: 로그인 만료 또는 유효하지 않은 token");
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  console.log(LOG_PREFIX, "3. user 확인됨:", user.id);

  let body: { assignmentId?: string };
  try {
    body = await req.json();
  } catch {
    console.error(LOG_PREFIX, "4. body 파싱 실패");
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }
  const assignmentId = body?.assignmentId;
  if (!assignmentId || typeof assignmentId !== "string") {
    console.error(LOG_PREFIX, "4. assignmentId 없음 또는 비문자열:", body);
    return NextResponse.json({ error: "assignmentId가 필요합니다." }, { status: 400 });
  }
  console.log(LOG_PREFIX, "4. assignmentId:", assignmentId);

  const { data: assignment, error: fetchErr } = await supabase
    .from("assignments")
    .select("id, user_id, started_at")
    .eq("id", assignmentId)
    .eq("user_id", user.id)
    .single();

  if (fetchErr || !assignment) {
    console.error(LOG_PREFIX, "5. assignments 행 조회 실패:", fetchErr?.message ?? "no data", "code:", fetchErr?.code);
    return NextResponse.json({ error: "해당 과제를 찾을 수 없습니다." }, { status: 403 });
  }
  console.log(LOG_PREFIX, "5. assignment 행 존재함, started_at 현재값:", assignment.started_at ?? "null");

  const now = new Date().toISOString();
  const isFirstTime = assignment.started_at == null || assignment.started_at === "";

  if (isFirstTime) {
    console.log(LOG_PREFIX, "6. assignments.started_at 업데이트 시도:", now);
    const { error: updateErr } = await supabase
      .from("assignments")
      .update({ started_at: now })
      .eq("id", assignmentId as string)
      .eq("user_id", user.id)
      .is("started_at", null);

    if (updateErr) {
      const msg = updateErr.message ?? "";
      const noColumn = msg.includes("started_at") || updateErr.code === "42703";
      console.error(LOG_PREFIX, "7. assignments 업데이트 실패:", updateErr.code, msg);
      return NextResponse.json(
        {
          error: noColumn
            ? "started_at 컬럼이 없습니다. Supabase에서 supabase/migration_assignments_started_at.sql 을 실행해 주세요."
            : "기록에 실패했습니다.",
        },
        { status: noColumn ? 503 : 500 }
      );
    }
    console.log(LOG_PREFIX, "7. assignments.started_at 업데이트 성공");
  } else {
    console.log(LOG_PREFIX, "6. 이미 최초 시청 기록됨, watch_starts만 누적");
  }

  // 매 시청 시작마다 watch_starts에 1건씩 누적 (4시, 6시 들어올 때마다 목록에 추가)
  if (supabaseServiceKey) {
    const serviceSupabase = createClient(supabaseUrl, supabaseServiceKey);
    const { error: insertErr } = await serviceSupabase
      .from("watch_starts")
      .insert({ assignment_id: assignmentId, started_at: now });
    if (insertErr) {
      console.error(LOG_PREFIX, "8. watch_starts INSERT 실패 (관리자 목록용):", insertErr.message);
    } else {
      console.log(LOG_PREFIX, "8. watch_starts INSERT 성공");
    }
  } else {
    console.warn(LOG_PREFIX, "8. SUPABASE_SERVICE_ROLE_KEY 없음, watch_starts 미기록");
  }

  return NextResponse.json({ ok: true, alreadyRecorded: !isFirstTime });
}
