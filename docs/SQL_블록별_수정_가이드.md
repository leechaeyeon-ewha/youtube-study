# SQL 블록별 수정 가이드

아래 순서와 수정 내용대로 적용하세요.

---

## ① 재생성용 스키마 (맨 처음 한 번만 실행할 때)

### 수정할 점

1. **profiles 테이블**: `display_name` 대신 **`full_name`** 사용 (앱이 학생 로그인 시 full_name 사용)
2. **assignments 테이블**: **`last_position`**, **`last_watched_at`** 컬럼 추가 (관리자 모니터링용)
3. **profiles RLS**: `profiles_select_admin` 정책이 다시 profiles를 읽어서 **무한 재귀** 발생 → 이 정책은 만들지 말거나, 아래 ③에서 profiles RLS를 끄는 방식 사용
4. **트리거**: 회원가입 시 `full_name`도 넣기 (관리자가 학생 생성 시 user_metadata.full_name 사용)

### 수정된 [3] profiles

```sql
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'student' check (role in ('admin', 'student')),
  full_name text,
  email text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

### 수정된 [5] assignments

```sql
create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  video_id uuid not null references public.videos(id) on delete cascade,
  is_completed boolean not null default false,
  progress_percent numeric(5,2) not null default 0 check (progress_percent >= 0 and progress_percent <= 100),
  last_position numeric(10,2) not null default 0,
  last_watched_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, video_id)
);
```

### 수정된 [9] profiles RLS (무한 재귀 방지)

**옵션 A – profiles는 RLS 유지하고 admin 정책만 제거 (권장)**  
`profiles_select_admin` 정책을 **만들지 말고**, 아래 ③에서 **profiles RLS를 끄는 방식**을 쓰면 됨.

**옵션 B – get_my_profile_role() 사용**  
이미 프로젝트 `supabase/schema.sql`에 있는 것처럼, `get_my_profile_role()` 함수를 만들고 admin 정책에서 그 함수만 쓰면 재귀 없음.

### 수정된 [12] 트리거 (full_name 반영)

```sql
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, role, email, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'role', 'student'),
    new.email,
    new.raw_user_meta_data->>'full_name'
  );
  return new;
end;
$$ language plpgsql security definer;
```

---

## ② 정책 재설정 (기존 DB에 정책만 바꿀 때)

### 수정할 점

1. **videos 정책 "Admins can manage videos"**  
   지금은 `auth.users`의 `raw_user_meta_data->>'role'`을 보고 있는데, **role은 `public.profiles`에 있음.**  
   → `public.profiles`에서 `id = auth.uid()`이고 `role = 'admin'`인지 확인하도록 바꿔야 함.
2. **이메일 하드코딩** (`email = '내이메일@example.com'`) 제거하고, **profiles.role만** 사용하는 게 좋음.

### 수정된 videos 정책 예시

```sql
drop policy if exists "Admins can do everything on videos" on public.videos;
drop policy if exists "Admins can manage videos" on public.videos;

create policy "Videos select authenticated"
on public.videos for select to authenticated using (true);

create policy "Videos insert admin"
on public.videos for insert with check (
  exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
);
create policy "Videos update admin"
on public.videos for update using (
  exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
);
create policy "Videos delete admin"
on public.videos for delete using (
  exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
);
```

- **주의**: `profiles`에 RLS가 켜져 있고, 그 안에서 다시 profiles를 읽는 정책이 있으면 무한 재귀가 납니다.  
  → 그래서 **profiles는 아래 ③처럼 RLS를 끄거나**, **get_my_profile_role()** 같은 함수로만 조회하는 방식이 안전합니다.

---

## ③ profiles 무한 재귀 제거 (지금 쓰는 방식)

### 수정할 점

- **없음.** 그대로 두면 됨.
- `profiles_select_admin` 제거 후 **profiles RLS 끄기**로 무한 재귀를 없애는 방식이 맞음.

### 실행 순서

- ②에서 “Profiles are viewable by authenticated users” 같은 정책을 만들었다면,  
  **그 다음에** ③을 실행하면 **profiles RLS가 꺼지면서** 그 정책들은 의미 없어짐.
- **정리**: ②와 ③을 같이 쓰지 말고,  
  - **무한 재귀만 없애고 싶다** → ③만 실행 (profiles RLS 끄기).  
  - **profiles RLS를 유지하고 싶다** → ②의 profiles 정책만 쓰고, **profiles_select_admin 같은 “profiles를 다시 읽는” 정책은 만들지 말 것.**

---

## ④ 관리자 지정

### 수정할 점

- **없음.** 이메일만 본인 계정으로 바꿔서 실행하면 됨.

```sql
update public.profiles
set role = 'admin'
where email = 'lee_chaeyeon@ewha.ac.kr';
```

---

## ⑤ full_name / role 컬럼 추가 (이미 테이블이 있을 때)

### 수정할 점

- **없음.** 그대로 실행해도 됨.
- `profiles`에 이미 `role`이 있고 check 제약이 있으면, `profiles_role_check` 추가 시 에러 날 수 있으니 `do $$ ... if not exists ...` 블록이 있는 현재 형태가 맞음.

---

## 실행 순서 요약

1. **처음부터 DB 다시 만들 때**  
   → ① 수정본 전체 실행 (profiles는 full_name, assignments는 last_position/last_watched_at, 트리거 full_name 포함, profiles_select_admin은 만들지 말거나 get_my_profile_role 사용).  
   그 다음 ④로 관리자 지정.

2. **이미 테이블이 있고, 무한 재귀만 없애고 싶을 때**  
   → ③만 실행 (profiles RLS 끄기).  
   필요하면 ④로 관리자 다시 지정.

3. **이미 테이블이 있는데 full_name/role 컬럼이 없을 때**  
   → ⑤ 실행 후, ③·④ 필요 시 실행.

4. **정책만 바꿀 때 (videos 등)**  
   → ② 수정본 실행 (videos는 **public.profiles** 기준으로 admin 체크).

이렇게 적용하면 현재 앱(학원 학습관)과 스키마/정책이 맞고, 무한 재귀와 400 에러도 피할 수 있습니다.
