"use client";

import { ShieldCheck, ChevronRight } from "lucide-react";
import GlassPanel from "@/components/GlassPanel";

export default function PrivacyPage() {
  return (
    <main className="relative min-h-screen overflow-hidden theme-bg-gradient text-white px-4 py-16">
      {/* Ambient gradient glows — the signature Whisper backdrop. */}
      <div className="pointer-events-none absolute -top-40 -left-40 h-96 w-96 rounded-full bg-purple-600/25 blur-[150px]" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-[500px] w-[500px] rounded-full bg-purple-600/20 blur-[180px]" />
      <div className="pointer-events-none absolute top-1/3 right-[-80px] h-72 w-72 rounded-full bg-cyan-500/10 blur-[130px]" />

      <div className="relative z-10 mx-auto max-w-2xl">
        <GlassPanel strong className="rounded-3xl p-8 text-center md:p-12">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-purple-500/30 to-purple-600/10 ring-1 ring-purple-400/30">
            <ShieldCheck size={30} className="text-purple-300" />
          </div>
          <h1 className="page-title">Privacy Policy</h1>
          <p className="page-subtitle mt-3 text-gray-400">Last updated: July 2026</p>
        </GlassPanel>

        <div className="mt-6 space-y-5">
          <Section
            title="Information We Collect"
            body={
              <>
                We collect the minimum information necessary to provide our anonymous messaging
                service. This includes your email address for account authentication and the
                content of the messages you send or receive. We do not collect names, phone
                numbers, or location data unless you voluntarily provide them. Where you sign in
                with Google, we may receive your name and profile photo as shared by Google under
                their own consent flow.
              </>
            }
          />

          <Section
            title="Anonymous Messaging"
            body={
              <>
                When you send a message through a Whisper link, your identity is not shared with the
                recipient. We do not store IP addresses in connection with individual messages.
                However, we may access message content or associated technical information if
                required by law enforcement, to protect the safety of our users, to prevent abuse
                or fraud, or to enforce our Terms of Service.
              </>
            }
          />

          <Section
            title="How We Use Your Information"
            body={
              <>
                We use the information we collect solely to operate and improve Whisper: to create
                and maintain your account, to deliver messages sent to your link, to detect and
                respond to abuse, spam, or harmful content, to keep the service reliable, and to
                communicate with you about your account when necessary. We do not sell your personal
                information, and we do not use it for third-party advertising without your consent.
              </>
            }
          />

          <Section
            title="Cookies & Technical Data"
            body={
              <>
                We use essential cookies and similar technologies to keep you signed in and to
                remember your preferences. We also collect standard technical data such as device
                type, browser type, and usage logs automatically for security, abuse-prevention,
                and performance-monitoring purposes. Where required by law, we will ask for consent
                before using non-essential analytics.
              </>
            }
          />

          <Section
            title="Storage & Security"
            body={
              <>
                Your messages and account data are stored on encrypted, access-controlled servers.
                We apply industry-standard safeguards — including encryption in transit and at rest,
                least-privilege access, and regular monitoring — to protect your information. No
                method of transmission or storage is completely secure, but we work continuously to
                keep your data safe.
              </>
            }
          />

          <Section
            title="Data Retention"
            body={
              <>
                We retain account and message data for as long as your account is active and as long
                as reasonably necessary to operate the service and comply with legal obligations. You
                may request the deletion of your account and associated data at any time using the
                contact details below, and we will honour valid requests within the timeframes
                required by applicable law.
              </>
            }
          />

          <Section
            title="Data Sharing"
            body={
              <>
                We do not sell, trade, or rent your personal information. We may share it only with
                trusted service providers who help us operate Whisper (such as cloud hosting and
                authentication providers), strictly to the extent necessary to run the service and
                under confidentiality obligations. We may also disclose information if required by
                law, to protect the rights and safety of Whisper or its users, or in connection with
                a merger, acquisition, or asset transfer.
              </>
            }
          />

          <Section
            title="Third-Party Services"
            body={
              <>
                Whisper relies on a small number of trusted third-party providers, including our
                database and authentication host, optional Google Sign-In, and payment processing
                for optional features. These providers may process your data on our behalf under
                their own privacy and security practices. We recommend reviewing their policies;
                we are not responsible for their independent handling of data.
              </>
            }
          />

          <Section
            title="Children's Privacy"
            body={
              <>
                Whisper is not directed to children under 13 years of age (or the minimum age
                required in your jurisdiction). We do not knowingly collect personal information
                from children. If you believe a child has provided us with personal information,
                please contact us and we will take steps to delete it.
              </>
            }
          />

          <Section
            title="Your Rights"
            body={
              <>
                Depending on where you live, you may have the right to access, correct, or delete
                your personal data, to object to or restrict certain processing, to withdraw consent,
                and to data portability. To exercise any of these rights, contact us using the
                details below. We will respond within the timeframes required by applicable law.
              </>
            }
          />

          <Section
            title="Changes to This Policy"
            body={
              <>
                We may update this Privacy Policy from time to time to reflect changes in our
                practices or for legal, technical, or operational reasons. Material changes will be
                communicated through the app and, where required, by notice. Your continued use of
                Whisper after changes take effect constitutes acceptance of the updated policy.
              </>
            }
          />

          <Section
            title="Contact Us"
            body={
              <>
                Questions about this policy or your data? We are happy to help. Reach us at{" "}
                <a
                  href="mailto:whisper.anonymous.app@gmail.com"
                  className="font-semibold text-purple-300 underline decoration-purple-400/40 underline-offset-2 hover:text-purple-200"
                >
                  whisper.anonymous.app@gmail.com
                </a>
                .
              </>
            }
          />
        </div>

        <p className="mt-8 text-center text-xs text-gray-500">
          This Privacy Policy is provided for informational purposes and does not constitute legal
          advice. For a policy tailored to your jurisdiction, consult a qualified professional.
        </p>
      </div>
    </main>
  );
}

/**
 * A single policy card. Borrows the app's glass treatment so the whole page
 * reads as one polished surface, and keeps every section's heading/body rhythm
 * consistent.
 */
function Section({ title, body }: { title: string; body: React.ReactNode }) {
  return (
    <GlassPanel strong className="rounded-3xl p-6 md:p-7">
      <h2 className="mb-3 flex items-center gap-2 text-lg font-black text-white">
        <ChevronRight size={16} className="shrink-0 text-purple-400" />
        {title}
      </h2>
      <p className="leading-relaxed text-gray-200">{body}</p>
    </GlassPanel>
  );
}
