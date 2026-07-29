"use client";

import { useState } from "react";
import GlassPanel from "@/components/GlassPanel";
import BackButton from "@/components/BackButton";
import { Lightbulb, Star, CheckCircle2 } from "lucide-react";

const FEEDBACK_EMAIL = "whisper.anonymous.app@gmail.com";

export default function FeedbackPage() {
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [message, setMessage] = useState("");
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim()) return;

    const body = `Rating: ${rating || "Not rated"} / 5\n\n${message.trim()}`;
    window.location.href = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(
      "Whisper App Feedback"
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
              <Lightbulb size={32} className="text-purple-300" />
            </div>
          </div>
          <h1 className="text-4xl font-black mb-2">Feedback</h1>
          <p className="text-gray-400">Tell us what&apos;s working and what could be better.</p>
        </div>

        <GlassPanel strong className="rounded-3xl p-6 md:p-8">
          {submitted ? (
            <div className="text-center py-8">
              <CheckCircle2 size={48} className="mx-auto mb-4 text-green-400" />
              <h2 className="text-xl font-bold mb-2">Thanks for the feedback!</h2>
              <p className="text-gray-400 text-sm">
                Your email app should have opened with your message ready to send.
              </p>
              <button
                onClick={() => {
                  setSubmitted(false);
                  setRating(0);
                  setMessage("");
                }}
                className="mt-6 text-sm font-semibold text-purple-300 hover:text-purple-200"
              >
                Share more feedback
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-3 text-center">
                  How would you rate your experience?
                </label>
                <div className="flex justify-center gap-2">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      type="button"
                      key={star}
                      onClick={() => setRating(star)}
                      onMouseEnter={() => setHoverRating(star)}
                      onMouseLeave={() => setHoverRating(0)}
                      className="transition-transform hover:scale-110"
                    >
                      <Star
                        size={32}
                        className={
                          star <= (hoverRating || rating)
                            ? "fill-yellow-400 text-yellow-400"
                            : "text-gray-600"
                        }
                      />
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-300 mb-2">
                  What&apos;s on your mind?
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Suggestions, feature requests, things you love or hate..."
                  rows={6}
                  className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-sm outline-none focus:border-purple-400/50 resize-none"
                  required
                />
              </div>

              <button
                type="submit"
                className="w-full rounded-2xl bg-gradient-to-r from-purple-500 to-fuchsia-500 py-4 font-bold text-white transition hover:opacity-90"
              >
                Submit Feedback
              </button>
            </form>
          )}
        </GlassPanel>
      </div>
    </main>
  );
}