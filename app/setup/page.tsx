"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { useToast } from "@/components/ToastProvider";
import AuthShell, { AuthBrand } from "@/components/auth/AuthShell";
import AuthField from "@/components/auth/AuthField";
import { AtSign, Loader2 } from "lucide-react";

export default function SetupPage() {
  const router = useRouter();
  const { showToast } = useToast();

  const [username, setUsername] = useState("");
  const [userId, setUserId] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function loadUser() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.push("/login");
        return;
      }

      setUserId(session.user.id);

      const { data } = await supabase
        .from("profiles")
        .select("username")
        .eq("id", session.user.id)
        .single();

      if (data?.username) {
        router.push("/dashboard");
      }
    }

    loadUser();
  }, [router]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();

    setLoading(true);

    const { error } = await supabase.from("profiles").upsert({
      id: userId,
      username,
      display_name: username,
    });

    setLoading(false);

    if (error) {
      showToast(error.message);
      return;
    }

    router.push("/dashboard");
  }

  return (
    <AuthShell>
      <AuthBrand />

      <h1 className="auth-title">Choose Username</h1>
      <p className="auth-subtitle">This becomes your Whisper profile link.</p>

      <form onSubmit={saveProfile} className="mt-7 space-y-4">
        <AuthField
          label="Username"
          icon={AtSign}
          value={username}
          onChange={setUsername}
          placeholder="yourname"
          autoComplete="username"
          required
        />

        <button type="submit" disabled={loading} className="auth-submit">
          {loading ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 size={18} className="animate-spin" />
              Saving...
            </span>
          ) : (
            "Continue"
          )}
        </button>
      </form>
    </AuthShell>
  );
}
