"use client";

import { useState } from "react";
import GlassPanel from "@/components/GlassPanel";
import BackButton from "@/components/BackButton";
import { LifeBuoy, Send, CheckCircle2 } from "lucide-react";

const CATEGORIES = [
  { key: "general", label: "General" },
  { key: "bug", label: "Bug Report" },
  { key: "account", label: "Account Issue" },
  { key: "abuse", label: "Report Abuse" },
  { key: "billing", label: "Billing" },
];

const SUPPORT_EMAIL = "whisper.anonymous.app@gmail.com";

export default function ContactSupportPage() {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState("general");
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!subject.trim() || !message.trim()) return;

    const categoryLabel = CATEGORIES.find((c) => c.key === category)?.label || "General";
    const body = `Category: ${categoryLabel}\n\n${message.trim()}`;
    window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
      subject.trim()
    )}&body=${encodeURIComponent(body)}`;

    setSubmitted(true);
  }

  return (
    <main className="relative min-h-screen overflow-hidden theme-bg-gradient text-white px-4 py-16 pb-28">
      <div className="absolute -top-40 -left-40 h-96 w-96 rounded-full bg-purple-600/20 blur-[150px]" />
      <div className="absolute bottom-0 right-0 h-[500px] w-[500px] rounded-full bg-purple-600/20 blur-[180px]" />

      <div className="relative z-10 mx-auto max-w-xl">
        <BackButton />

        <div className="text-center mb-8">
          <div className="relative inline-block mb-4">
            <div className="absolute inset-0 rounded-3xl bg-purple-500/20 blur-2xl" />
            <div className="relative flex h-16 w-16 items-center justify-center rounded-3xl premium-card border border-white/10 mx-auto">
              <LifeBuoy size={32} className="text-purple-300" />
            </div>
          </div>
          <h1 className="page-title mb-2">Contact Support</h1>
          <p className="page-subtitle">We usually reply within 24-48 hours.</p>
        </div>

        <GlassPanel strong className="rounded-3xl p-6 md:p-8">
          {submitted ? (
            <div className="text-center py-8">
              <CheckCircle2 size={48} className="mx-auto mb-4 text-green-400" />
              <h2 className="text-xl font-bold mb-2">Thanks for reaching out</h2>
              <p className="text-gray-400 text-sm">
                Your email app should have opened with your message ready to send. If it
                didn&apos;t, email us directly at{" "}
                <a href={`mailto:${SUPPORT_EMAIL}`} className="text-purple-400 hover:text-purple-300">
                  {SUPPORT_EMAIL}
                </a>
                .
              </p>
              <button
                onClick={() => setSubmitted(false)}
                className="mt-6 text-sm font-semibold text-purple-300 hover:text-purple-200"
              >
                Send another message
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-2">Category</label>
                <div className="flex flex-wrap gap-2">
                  {CATEGORIES.map((c) => (
                    <button
                      type="button"
                      key={c.key}
                      onClick={() => setCategory(c.key)}
                      className={`rounded-full px-4 py-2 text-xs font-bold transition ${
                        category === c.key
                          ? "bg-purple-500 text-white"
                          : "bg-white/5 text-gray-300 hover:bg-white/10"
                      }`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-2">Subject</label>
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="What's this about?"
                  className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-sm outline-none focus:border-purple-400/50"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-2">Message</label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Tell us what's going on..."
                  rows={6}
                  className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-sm outline-none focus:border-purple-400/50 resize-none"
                  required
                />
              </div>

              <button
                type="submit"
                className="w-full flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-purple-500 to-fuchsia-500 py-4 font-bold text-white transition hover:opacity-90"
              >
                <Send size={18} />
                Send Message
              </button>
            </form>
          )}
        </GlassPanel>
      </div>
    </main>
  );
}