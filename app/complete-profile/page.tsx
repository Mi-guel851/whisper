"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { useToast } from "@/components/ToastProvider";
import GlassPanel from "@/components/GlassPanel";
import CountryPhoneInput, { type CountryPhoneValue } from "@/components/CountryPhoneInput";
import { COUNTRIES } from "@/lib/countries";
import { Eye, EyeOff, ShieldCheck } from "lucide-react";

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
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
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
      <main className="min-h-screen flex items-center justify-center theme-bg-gradient text-white">
        <p className="text-gray-400">Loading...</p>
      </main>
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden theme-bg-gradient flex items-center justify-center text-white px-4">

      <div className="absolute -top-40 -left-40 h-96 w-96 rounded-full bg-cyan-500/20 blur-[150px]" />
      <div className="absolute bottom-0 right-0 h-[500px] w-[500px] rounded-full bg-purple-600/20 blur-[180px]" />

      {step === "form" ? (
        <GlassPanel strong className="relative z-10 w-full max-w-md rounded-3xl p-8">
          <h1 className="text-center text-3xl font-black">One last step</h1>
          <p className="mt-2 mb-8 text-center text-gray-300">
            Pick a username, set a password, and tell us where you&apos;re based so we can
            get your premium payments in the right currency.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username"
              required
              className="w-full rounded-2xl border border-white/10 bg-black/30 p-4 outline-none focus:border-cyan-400"
            />

            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Create a password"
                required
                className="w-full rounded-2xl border border-white/10 bg-black/30 p-4 pr-12 outline-none focus:border-cyan-400"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>

            <div className="relative">
              <input
                type={showConfirmPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm password"
                required
                className="w-full rounded-2xl border border-white/10 bg-black/30 p-4 pr-12 outline-none focus:border-cyan-400"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword((v) => !v)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                tabIndex={-1}
              >
                {showConfirmPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <CountryPhoneInput value={countryPhone} onChange={setCountryPhone} />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-2xl bg-gradient-to-r from-purple-600 to-cyan-400 p-4 font-bold text-black disabled:opacity-60"
            >
              {loading ? "Saving..." : "Continue"}
            </button>
          </form>
        </GlassPanel>
      ) : (
        <GlassPanel strong className="relative z-10 w-full max-w-md rounded-3xl p-8">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-purple-500/15">
            <ShieldCheck size={26} className="text-purple-300" />
          </div>

          <h1 className="mt-4 text-center text-3xl font-black">Set a recovery phrase</h1>
          <p className="mt-2 mb-6 text-center text-gray-300">
            Since Whisper doesn&apos;t use email to reset your password, this phrase is the{" "}
            <span className="font-semibold text-white">only way</span> to get back into your
            account if you forget your password. Store it somewhere safe — a notes app, a
            password manager, written down. If you lose it, no one (including us) can recover
            your account.
          </p>

          <div className="space-y-4">
            <input
              value={recoveryPhrase}
              onChange={(e) => setRecoveryPhrase(e.target.value)}
              placeholder="e.g. purple-ghost-echoes-42"
              className="w-full rounded-2xl border border-white/10 bg-black/30 p-4 outline-none focus:border-cyan-400"
            />

            <label className="flex items-start gap-3 text-sm text-gray-300">
              <input
                type="checkbox"
                checked={confirmedSaved}
                onChange={(e) => setConfirmedSaved(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-white/20 bg-black/30"
              />
              I&apos;ve saved this recovery phrase somewhere secure. I understand it cannot be
              recovered if I lose it.
            </label>

            <button
              onClick={handleSaveRecoveryPhrase}
              disabled={savingPhrase}
              className="w-full rounded-2xl bg-gradient-to-r from-purple-600 to-cyan-400 p-4 font-bold text-black disabled:opacity-60"
            >
              {savingPhrase ? "Saving..." : "Finish Setup"}
            </button>
          </div>
        </GlassPanel>
      )}
    </main>
  );
}