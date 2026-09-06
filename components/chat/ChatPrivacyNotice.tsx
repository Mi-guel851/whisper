"use client";

/**
 * The small privacy chip at the top of a conversation — the same reassurance
 * WhatsApp's encryption notice provides, worded truthfully for Whisper's
 * actual architecture.
 *
 * WHY THIS TEXT AND NOT "END-TO-END ENCRYPTED"
 * Whisper messages are written to Supabase over TLS and stored server-side;
 * there is no client-held key pair and no on-device encryption of message
 * content, so the content is not end-to-end encrypted and this notice must
 * not claim it is. What *is* true: transport encryption everywhere (TLS to
 * Supabase and Cloudinary), access control at the database (RLS scopes every
 * message row to the two conversation participants), and Whisper's identity
 * model keeps chats anonymous. "Securely encrypted in transit and protected
 * by access controls" states exactly that. If real E2EE ships later, this is
 * the one component to update.
 */

import { ShieldCheck } from "lucide-react";

export default function ChatPrivacyNotice() {
  return (
    <div className="mb-4 mt-1 flex justify-center px-4">
      <p
        className="chat-day-chip max-w-[340px] rounded-2xl px-3.5 py-2 text-center text-[11px] leading-4 backdrop-blur-md"
        role="note"
      >
        <ShieldCheck
          size={12}
          className="mr-1 inline-block align-[-2px]"
          style={{ color: "var(--theme-accent-purple)" }}
          aria-hidden
        />
        Your messages are private — securely encrypted in transit and visible
        only to the two of you.
      </p>
    </div>
  );
}
