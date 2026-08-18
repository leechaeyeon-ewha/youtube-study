import { createClient, type User } from "@supabase/supabase-js";

function getBearerToken(req: Request): string | null {
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "").trim();
  return token || null;
}

async function getUserFromRequest(req: Request): Promise<User | null> {
  const token = getBearerToken(req);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!token || !supabaseUrl || !supabaseAnonKey) return null;

  const anon = createClient(supabaseUrl, supabaseAnonKey);
  const { data: { user } } = await anon.auth.getUser(token);
  return user ?? null;
}

async function getProfileRole(userId: string): Promise<string | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return null;

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();
  return profile?.role ?? null;
}

/** Authorization Bearer JWT 검증 후 profiles.role = admin 인 경우 User 반환 */
export async function requireAdmin(req: Request): Promise<User | null> {
  const user = await getUserFromRequest(req);
  if (!user) return null;
  const role = await getProfileRole(user.id);
  return role === "admin" ? user : null;
}

/** Authorization Bearer JWT 검증 후 profiles.role = teacher 인 경우 User 반환 */
export async function requireTeacher(req: Request): Promise<User | null> {
  const user = await getUserFromRequest(req);
  if (!user) return null;
  const role = await getProfileRole(user.id);
  return role === "teacher" ? user : null;
}
