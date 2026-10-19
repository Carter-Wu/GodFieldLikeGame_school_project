import { createClient } from "@supabase/supabase-js";

// Server-only: the service-role key bypasses row-level security, so it lives
// in Railway's environment variables, never in .env or anything under src/.
export const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
