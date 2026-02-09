import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (!url) {
      return NextResponse.json(
        { error: "유효한 YouTube URL을 보내 주세요." },
        { status: 400 }
      );
    }

    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(
      url
    )}&format=json`;

    const res = await fetch(oembedUrl);
    if (!res.ok) {
      return NextResponse.json(
        { error: "유튜브에서 제목 정보를 가져오지 못했습니다." },
        { status: 400 }
      );
    }

    const data = await res.json();
    return NextResponse.json({ title: data.title ?? null });
  } catch {
    return NextResponse.json(
      { error: "제목 정보를 가져오는 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

