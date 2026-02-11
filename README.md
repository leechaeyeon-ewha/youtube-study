This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

**로고:** 상단바·로그인·학생 페이지에 학원 로고가 표시됩니다. 로고가 안 보이면 학원 로고 이미지 파일을 `public/logo.png` 로 저장해 주세요.

**강좌(courses) 테이블:** 기존 DB를 쓰는 경우 Supabase SQL Editor에서 `supabase/migration_courses.sql` 내용을 실행해 주세요. 재생목록 한 번에 등록 기능을 쓰려면 `.env.local`에 `YOUTUBE_API_KEY`(YouTube Data API v3 키)를 추가해야 합니다.

**학부모 리포트:** 리포트 공유 기능을 쓰려면 `supabase/migration_report_token.sql`을 실행해 `profiles`에 `report_token`, `is_report_enabled`, `parent_phone` 컬럼을 추가해 주세요.

**반(Class) 관리·영상 노출/주간과제:** 반 관리 및 영상 일괄 노출/주간과제 기능을 쓰려면 `supabase/migration_classes_and_video_flags.sql`을 실행해 `classes` 테이블, `profiles.class_id`, `videos.is_visible`/`is_weekly_assignment`를 추가해 주세요.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
