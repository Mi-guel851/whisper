"use client";

/**
 * Dev-only harness for the media picker. Lets the picker, sticker rendering
 * and privacy notice be exercised without a signed-in Supabase session.
 * Renders 404 in production builds.
 */

import { notFound } from "next/navigation";
import { useState } from "react";
import MediaPicker, { type MediaTab } from "@/components/chat/MediaPicker";
import MediaMessage from "@/components/chat/MediaMessage";
import ChatPrivacyNotice from "@/components/chat/ChatPrivacyNotice";

export default function PickerTest() {
  const [tab, setTab] = useState<MediaTab>("emoji");
  const [open, setOpen] = useState(true);
  const [picked, setPicked] = useState<string[]>([]);

  if (process.env.NODE_ENV === "production") notFound();

  return (
    <main className="chat-canvas flex min-h-screen flex-col justify-end">
      <ChatPrivacyNotice />
      <div className="p-4 text-xs" data-testid="picked">
        {picked.join(" | ")}
      </div>
      <MediaMessage url="/stickers/whisp/joy.webp" kind="sticker" width={512} height={512} />
      <button onClick={() => setOpen((o) => !o)} className="p-2 text-sm">
        toggle
      </button>
      <MediaPicker
        open={open}
        tab={tab}
        onTabChange={setTab}
        userId="00000000-0000-0000-0000-000000000000"
        onPickEmoji={(e) => setPicked((p) => [...p, `emoji:${e}`])}
        onPickGif={(g) => setPicked((p) => [...p, `gif:${g.id}`])}
        onPickSticker={(s) => setPicked((p) => [...p, `sticker:${s.id}`])}
        sendingMedia={null}
        showToast={(m) => setPicked((p) => [...p, `toast:${m}`])}
        isDesktop={false}
      />
    </main>
  );
}
