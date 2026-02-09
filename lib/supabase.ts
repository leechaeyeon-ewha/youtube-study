import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

// 빌드 시 타입 오류를 피하기 위해 any로 고정 캐스팅
// (실행 시에는 URL/KEY가 없으면 null일 수 있으므로, 사용하는 쪽에서 런타임 체크는 유지하는 것이 안전합니다.)
const supabaseInstance: SupabaseClient | null =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;

export const supabase = supabaseInstance as any;