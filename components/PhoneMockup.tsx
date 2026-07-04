"use client";

import { MessageCircle, ImageIcon, Heart, Shield } from "lucide-react";

export default function PhoneMockup() {
  return (
    <div className="relative">

      <div className="absolute -inset-12 rounded-full bg-cyan-500/20 blur-[120px]" />

      <div className="relative w-[360px] rounded-[42px] border border-white/10 bg-gradient-to-br from-[#140024] to-[#060011] p-6 shadow-[0_0_80px_rgba(0,255,255,.12)]">

        <div className="mb-8 text-center">

          <div className="text-2xl font-bold text-white">
            👻 Whisper
          </div>

          <div className="text-cyan-300">
            Anonymous Inbox
          </div>

        </div>

        <div className="space-y-4">

          <div className="rounded-2xl bg-white/10 p-4">
            <div className="mb-2 flex items-center gap-2 font-bold text-white">
              <MessageCircle size={18} />
              New Message
            </div>

            <p className="text-gray-300">
              "I've always admired your confidence."
            </p>
          </div>

          <div className="rounded-2xl bg-cyan-500/10 p-4">

            <div className="mb-2 flex items-center gap-2 font-bold text-cyan-300">
              <ImageIcon size={18} />
              Anonymous Image
            </div>

            <div className="h-28 rounded-xl bg-gradient-to-r from-cyan-500 to-purple-500" />

          </div>

          <div className="grid grid-cols-2 gap-4">

            <div className="rounded-2xl bg-white/10 p-4 text-center">

              <Heart className="mx-auto mb-2 text-pink-400" />

              <div className="text-3xl font-black text-white">
                248
              </div>

              <div className="text-gray-400">
                Likes
              </div>

            </div>

            <div className="rounded-2xl bg-white/10 p-4 text-center">

              <Shield className="mx-auto mb-2 text-cyan-400" />

              <div className="text-3xl font-black text-white">
                100%
              </div>

              <div className="text-gray-400">
                Anonymous
              </div>

            </div>

          </div>

        </div>

      </div>

    </div>
  );
}