import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://localhost:54321";
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "missing-anon-key";

export const hasSupabaseBrowserConfig = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export const supabase = createClient(url, key);
