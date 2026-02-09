# Supabase 인증 설정 (회원가입 · 이메일)

## 확인 이메일이 안 올 때 (회원가입 직후 로그인만 필요할 때)

Supabase는 기본적으로 **이메일 확인(Confirm email)** 이 켜져 있어서, 회원가입 시 확인 메일을 보냅니다.  
개발/학원 내부용으로 **이메일 없이 바로 로그인**하게 하려면 아래처럼 설정합니다.

1. **Supabase 대시보드** 접속
2. **Authentication** → **Providers** → **Email** 이동
3. **Confirm email** 옵션을 **끄기** (OFF)
4. **Save** 클릭

이후에는 회원가입 시 이메일 발송 없이 바로 로그인됩니다.

---

## 확인 이메일을 실제로 보내고 싶을 때

1. **Authentication** → **Providers** → **Email** 에서 **Confirm email** 은 **켜두기** (ON)
2. **Authentication** → **Email Templates** 에서 내용 수정 가능
3. **Project Settings** → **Auth** → **SMTP Settings** 에서 자체 SMTP(네이버, Gmail 등)를 설정하면 확인 메일이 해당 SMTP로 발송됩니다.  
   (Supabase 기본 발송은 제한이 있을 수 있어, 실제 서비스에서는 SMTP 설정을 권장합니다.)
