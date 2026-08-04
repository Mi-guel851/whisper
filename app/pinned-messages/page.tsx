"use client";

import BackButton from "@/components/BackButton";

export default function PinnedMessagesPage() {
  return (
    <main className="relative min-h-screen overflow-hidden theme-bg-gradient text-white px-4 py-16">
      <div className="absolute -top-40 -left-40 h-96 w-96 rounded-full bg-purple-600/20 blur-[150px]" />
      <div className="relative z-10 mx-auto max-w-xl">
        <BackButton />
        <div className="flex flex-col items-center justify-center text-center py-24">
          <h1 className="page-title mb-2">Pinned Messages</h1>
          <p className="page-subtitle">This feature is coming soon.</p>
        </div>
      </div>
    </main>
  );
}