"use client";

import { useState } from "react";
import GlassPanel from "@/components/GlassPanel";
import BackButton from "@/components/BackButton";
import { LifeBuoy, ChevronDown, Send, User, Bell, MessageSquare } from "lucide-react";

const FAQS = [
  {
    q: "How do I create my anonymous link?",
    a: "After registering, go to your Profile page and set a username. Your shareable link will be generated automatically in the format whisper.app/u/yourusername. Share it anywhere to start receiving anonymous messages.",
  },
  {
    q: "Can senders see who I am?",
    a: "No. When someone sends a message through your Whisper link, their identity is never shared with you. The same applies when you send messages to others — your identity remains private.",
  },
  {
    q: "Can I pin a message?",
    a: "Yes, inside a chat. Open the conversation, press and hold the message you want to pin, and choose Pin — you'll be asked how long it should stay pinned. Pinned messages appear in a bar at the top of that chat. Anonymous whispers on the Whispers tab can't be pinned or favorited.",
  },
  {
    q: "Can I attach images to messages?",
    a: "Yes. When sending a message through a Whisper link, you can optionally attach an image. Images are processed and displayed anonymously alongside the message text.",
  },
  {
    q: "Someone is harassing me. What can I do?",
    a: "Open Contact Support and choose Report Abuse. Include as much detail as you can — our moderation team reviews every report. You can also delete any whisper from the Whispers tab, which removes it and its image permanently. Sender hints show a whisper's approximate location, time and device, but never a name — Whisper has no feature that reveals who sent an anonymous message.",
  },
  {
    q: "What are Whisper Coins?",
    a: "Whisper Coins are virtual currency used to unlock premium features and profile enhancements. Visit the Coin Store to purchase coins or check your balance on the dashboard.",
  },
  {
    q: "How do I delete my account?",
    a: "Go to Settings and scroll to the bottom. Logging out signs you out of the current session. For full account deletion, please contact support through the Contact Support page.",
  },
  {
    q: "Is my data secure?",
    a: "Yes. All data in transit is encrypted with TLS. Passwords are hashed and never stored in plain text. See our Privacy Policy for full details on data handling and retention.",
  },
];

const GUIDES = [
  { icon: Send, title: "Sending Messages", desc: "Attach images and craft anonymous messages through any Whisper link." },
  { icon: User, title: "Setting Up Your Profile", desc: "Customize your username, display name, avatar, and bio." },
  { icon: Bell, title: "Managing Notifications", desc: "Control push notifications and sound alerts in Settings." },
  { icon: MessageSquare, title: "Direct Messages", desc: "Start conversations with other users in your Inbox." },
];

export default function HelpCenterPage() {
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  return (
    <main className="relative min-h-screen overflow-hidden theme-bg-gradient text-white px-4 py-16 pb-28">
      <div className="absolute -top-40 -left-40 h-96 w-96 rounded-full bg-purple-600/20 blur-[150px]" />
      <div className="absolute bottom-0 right-0 h-[500px] w-[500px] rounded-full bg-purple-600/20 blur-[180px]" />

      <div className="relative z-10 mx-auto max-w-3xl">
        <BackButton />

        <div className="text-center mb-10">
          <div className="relative inline-block mb-4">
            <div className="absolute inset-0 rounded-3xl bg-purple-500/20 blur-2xl" />
            <div className="relative flex h-16 w-16 items-center justify-center rounded-3xl premium-card border border-white/10 mx-auto">
              <LifeBuoy size={32} className="text-purple-300" />
            </div>
          </div>
          <h1 className="page-title mb-2">Help Center</h1>
          <p className="page-subtitle">Guides and answers to get the most out of Whisper.</p>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-8">
          {GUIDES.map((guide) => {
            const Icon = guide.icon;
            return (
              <GlassPanel key={guide.title} className="rounded-2xl p-4">
                <Icon size={20} className="text-purple-300 mb-2" />
                <h3 className="font-bold text-sm mb-1">{guide.title}</h3>
                <p className="text-xs text-gray-400 leading-snug">{guide.desc}</p>
              </GlassPanel>
            );
          })}
        </div>

        <h2 className="text-xl font-bold mb-4">Frequently Asked Questions</h2>
        <div className="space-y-3">
          {FAQS.map((faq, idx) => {
            const open = openIdx === idx;
            return (
              <GlassPanel key={faq.q} className="rounded-2xl overflow-hidden">
                <button
                  onClick={() => setOpenIdx(open ? null : idx)}
                  className="w-full flex items-center justify-between gap-4 p-4 text-left"
                >
                  <span className="font-semibold text-sm">{faq.q}</span>
                  <ChevronDown
                    size={18}
                    className={`shrink-0 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
                  />
                </button>
                {open && (
                  <p className="px-4 pb-4 text-sm text-gray-300 leading-relaxed">{faq.a}</p>
                )}
              </GlassPanel>
            );
          })}
        </div>
      </div>
    </main>
  );
}