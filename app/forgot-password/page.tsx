"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useToast } from "@/components/ToastProvider";
import AuthShell from "@/components/auth/AuthShell";
import AuthField from "@/components/auth/AuthField";
import { ChevronLeft, KeyRound, Lock, AtSign, Loader2 } from "lucide-react";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const { showToast } = useToast();

  const [username, setUsername] = useState("");
  const [phrase, setPhrase] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (newPassword.length < 6) {
      showToast("Password must be at least 6 characters.");
      return;
    }

    if (newPassword !== confirmPassword) {
      showToast("Passwords don't match.");
      return;
    }

    setLoading(true);

    const res = await fetch("/api/reset-with-phrase", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, phrase, newPassword }),
    });

    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      showToast(data.error || "Something went wrong.");
      return;
    }

    showToast("Password updated! You can now log in. 🔒");
    router.push("/login");
  }

  return (
    <AuthShell>
      <Link href="/login" className="auth-back mb-6">
        <ChevronLeft size={16} />
        Back to login
      </Link>

      <div className="auth-badge">
        <KeyRound size={24} />
      </div>

      <h1 className="auth-title mt-4">Reset password</h1>
      <p className="auth-subtitle">
        Enter your username and the recovery phrase you set when you signed up.
      </p>

      <form onSubmit={handleSubmit} className="mt-7 space-y-4">
        <AuthField
          label="Username"
          icon={AtSign}
          value={username}
          onChange={setUsername}
          placeholder="yourname"
          autoComplete="username"
          required
        />

        <AuthField
          label="Recovery phrase"
          icon={KeyRound}
          type="password"
          value={phrase}
          onChange={setPhrase}
          placeholder="e.g. purple-ghost-echoes-42"
          required
        />

        <AuthField
          label="New password"
          type="password"
          icon={Lock}
          value={newPassword}
          onChange={setNewPassword}
          placeholder="At least 6 characters"
          autoComplete="new-password"
          required
        />

        <AuthField
          label="Confirm new password"
          type="password"
          icon={Lock}
          value={confirmPassword}
          onChange={setConfirmPassword}
          placeholder="Repeat your new password"
          autoComplete="new-password"
          required
        />

        <button type="submit" disabled={loading} className="auth-submit">
          {loading ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 size={18} className="animate-spin" />
              Resetting...
            </span>
          ) : (
            "Reset password"
          )}
        </button>
      </form>
    </AuthShell>
  );
}
