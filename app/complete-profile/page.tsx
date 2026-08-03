"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { useToast } from "@/components/ToastProvider";
import AuthShell, { AuthBrand } from "@/components/auth/AuthShell";
import AuthField from "@/components/auth/AuthField";
import CountryPhoneInput, { type CountryPhoneValue } from "@/components/CountryPhoneInput";
import { COUNTRIES } from "@/lib/countries";
import { AtSign, Lock, ShieldCheck, Loader2 } from "lucide-react";

function countryCodeFromProfile(countryName: string | null | undefined, fallbackCode: string | null | undefined) {
  if (fallbackCode) return fallbackCode;
  if (!countryName) return "NG";

  return COUNTRIES.find((country) => country.name === countryName)?.code || "NG";
}

function countryNameFromCode(countryCode: string) {
  return COUNTRIES.find((country) => country.code === countryCode)?.name || "Nigeria";
}

export default function CompleteProfilePage() {
  const router = useRouter();
  const { showToast } = useToast();

  const [checking, setChecking] = useState(true);
  const [userId, setUserId] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [countryPhone, setCountryPhone] = useState<CountryPhoneValue>({
    countryCode: "NG",
    dialCode: "+234",
    phoneNumber: "",
  });
  const [loading, setLoading] = useState(false);

  // Recovery phrase step
  const [step, setStep] = useState<"form" | "recovery">("form");
  const [recoveryPhrase, setRecoveryPhrase] = useState("");
  const [confirmedSaved, setConfirmedSaved] = useState(false);
  const [savingPhrase, setSavingPhrase] = useState(false);

  useEffect(() => {
    async function init() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.push("/login");
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("username, profile_completed, country, country_code, dial_code, phone_number")
        .eq("id", session.user.id)
        .single();

      if (profile?.profile_completed) {
        router.push("/dashboard");
        return;
      }

      setUserId(session.user.id);
      setUsername(profile?.username || "");
      setCountryPhone({
        countryCode: countryCodeFromProfile(profile?.country, profile?.country_code),
        dialCode: profile?.dial_code || "+234",
        phoneNumber: profile?.phone_number || "",
      });
      setChecking(false);
    }

    init();
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const cleanUsername = username.trim().toLowerCase();

    if (!/^[a-z0-9_]{3,20}$/.test(cleanUsername)) {
      showToast("Username must be 3-20 characters: letters, numbers, underscores only.");
      return;
    }

    if (password.length < 6) {
      showToast("Password must be at least 6 characters.");
      return;
    }

    if (password !== confirmPassword) {
      showToast("Passwords don't match.");
      return;
    }

    if (!countryPhone.countryCode) {
      showToast("Please select your country.");
      return;
    }

    if (countryPhone.phoneNumber.trim().length < 4) {
      showToast("Please enter a valid phone number.");
      return;
    }

    setLoading(true);

    const { data: existing } = await supabase
      .from("profiles")
      .select("id")
      .eq("username", cleanUsername)
      .neq("id", userId)
      .maybeSingle();

    if (existing) {
      setLoading(false);
      showToast("That username is already taken.");
      return;
    }

    const { error: passError } = await supabase.auth.updateUser({ password });

    if (passError) {
      setLoading(false);
      showToast(passError.message);
      return;
    }

    const { error: profileError } = await supabase
      .from("profiles")
      .update({
        username: cleanUsername,
        country: countryNameFromCode(countryPhone.countryCode),
        country_code: countryPhone.countryCode,
        dial_code: countryPhone.dialCode,
        phone_number: countryPhone.phoneNumber,
      })
      .eq("id", userId);

    setLoading(false);

    if (profileError) {
      showToast(profileError.message);
      return;
    }

    // Move to the mandatory recovery phrase step instead of finishing yet
    setStep("recovery");
  }

  async function handleSaveRecoveryPhrase() {
    if (recoveryPhrase.trim().length < 6) {
      showToast("Recovery phrase must be at least 6 characters.");
      return;
    }

    if (!confirmedSaved) {
      showToast("Please confirm you've saved your recovery phrase somewhere safe.");
      return;
    }

    setSavingPhrase(true);

    const res = await fetch("/api/set-recovery-phrase", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, phrase: recoveryPhrase.trim() }),
    });

    const data = await res.json();

    if (!res.ok) {
      setSavingPhrase(false);
      showToast(data.error || "Something went wrong saving your recovery phrase.");
      return;
    }

    const { error: profileError } = await supabase
      .from("profiles")
      .update({ profile_completed: true })
      .eq("id", userId);

    setSavingPhrase(false);

    if (profileError) {
      showToast(profileError.message);
      return;
    }

    showToast("You're all set! 🎉");
    router.push("/dashboard");
  }

  if (checking) {
    return (
      <AuthShell>
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-white/70">
          <Loader2 size={18} className="animate-spin" />
          Loading...
        </div>
      </AuthShell>
    );
  }

  if (step === "recovery") {
    return (
      <AuthShell>
        <div className="auth-badge">
          <ShieldCheck size={24} />
        </div>

        <h1 className="auth-title mt-4">Set a recovery phrase</h1>
        <p className="auth-subtitle">
          Whisper doesn&apos;t use email to reset passwords, so this phrase is the only way back
          into your account. Store it somewhere safe.
        </p>

        <div className="mt-7 space-y-4">
          <AuthField
            label="Recovery phrase"
            value={recoveryPhrase}
            onChange={setRecoveryPhrase}
            placeholder="e.g. purple-ghost-echoes-42"
            required
          />

          <p className="auth-note">
            If you lose this phrase, no one — including us — can recover your account.
          </p>

          <label className="auth-check">
            <input
              type="checkbox"
              checked={confirmedSaved}
              onChange={(e) => setConfirmedSaved(e.target.checked)}
            />
            I&apos;ve saved this recovery phrase somewhere secure. I understand it cannot be
            recovered if I lose it.
          </label>

          <button
            onClick={handleSaveRecoveryPhrase}
            disabled={savingPhrase}
            className="auth-submit"
          >
            {savingPhrase ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 size={18} className="animate-spin" />
                Saving...
              </span>
            ) : (
              "Finish Setup"
            )}
          </button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <AuthBrand />

      <h1 className="auth-title">One last step</h1>
      <p className="auth-subtitle">
        Pick a username, set a password, and tell us where you&apos;re based so payments land in
        the right currency.
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
          label="Password"
          type="password"
          icon={Lock}
          value={password}
          onChange={setPassword}
          placeholder="At least 6 characters"
          autoComplete="new-password"
          required
        />

        <AuthField
          label="Confirm password"
          type="password"
          icon={Lock}
          value={confirmPassword}
          onChange={setConfirmPassword}
          placeholder="Repeat your password"
          autoComplete="new-password"
          required
        />

        <div>
          <span className="auth-label">Country &amp; phone</span>
          <div className="auth-phone rounded-2xl border border-white/10 bg-white/5 p-4">
            <CountryPhoneInput value={countryPhone} onChange={setCountryPhone} />
          </div>
        </div>

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
