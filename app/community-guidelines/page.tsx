"use client";

import { ScrollText, ChevronRight } from "lucide-react";
import GlassPanel from "@/components/GlassPanel";

export default function CommunityGuidelinesPage() {
  return (
    <main className="relative min-h-screen overflow-hidden theme-bg-gradient text-white px-4 py-16">
      {/* Ambient gradient glows — the signature Whisper backdrop. */}
      <div className="pointer-events-none absolute -top-40 -left-40 h-96 w-96 rounded-full bg-purple-600/25 blur-[150px]" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-[500px] w-[500px] rounded-full bg-purple-600/20 blur-[180px]" />
      <div className="pointer-events-none absolute top-1/3 right-[-80px] h-72 w-72 rounded-full bg-cyan-500/10 blur-[130px]" />

      <div className="relative z-10 mx-auto max-w-2xl">
        <GlassPanel strong className="rounded-3xl p-8 text-center md:p-12">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-purple-500/30 to-purple-600/10 ring-1 ring-purple-400/30">
            <ScrollText size={30} className="text-purple-300" />
          </div>
          <h1 className="page-title">Community Guidelines</h1>
          <p className="page-subtitle mt-3 text-gray-400">
            The rules that keep Whisper safe and welcoming for everyone.
          </p>
        </GlassPanel>

        <div className="mt-6 space-y-5">
          <Section
            title="Be Kind & Respectful"
            body={
              <>
                Whisper is a space for honest, constructive communication. Treat every person
                with the same courtesy and respect you would expect for yourself. Harassment,
                bullying, threats, and targeted abuse are not tolerated and may result in
                account suspension.
              </>
            }
          />

          <Section
            title="No Hate Speech"
            body={
              <>
                We do not allow content that promotes violence, discrimination, or hatred
                against any individual or group based on race, ethnicity, religion, national
                origin, gender, sexual orientation, disability, or any other protected
                characteristic.
              </>
            }
          />

          <Section
            title="Use Anonymity Responsibly"
            body={
              <>
                Anonymity exists to encourage honesty, not to shield harm. Do not use Whisper
                to spread false information, impersonate others, or deceive or manipulate
                people — and never attempt to identify, reveal, or confront an anonymous sender.
                Send every whisper in good faith.
              </>
            }
          />

          <Section
            title="Protect Privacy"
            body={
              <>
                Do not share anyone&apos;s personal information without their consent — including
                real names, addresses, phone numbers, or photos — and do not encourage others
                to do so. Respecting privacy is the foundation of our community.
              </>
            }
          />

          <Section
            title="No Spam, Scams, or Solicitation"
            body={
              <>
                Keep whispers human. Do not use Whisper links to send unsolicited promotions,
                chain messages, phishing links, scams, or attempts to redirect people off the
                service. Accounts that spam others may lose messaging privileges.
              </>
            }
          />

          <Section
            title="Keep Content Appropriate"
            body={
              <>
                Do not use Whisper to share illegal content, graphic sexual content, or content
                that promotes violence, self-harm, or the exploitation of minors. When in doubt,
                leave it out.
              </>
            }
          />

          <Section
            title="Age Requirements"
            body={
              <>
                Whisper is intended for users aged 13 and older. Users under 18 should have the
                permission of a parent or guardian, and we do not knowingly allow children under
                13 to use the platform.
              </>
            }
          />

          <Section
            title="Reporting & Enforcement"
            body={
              <>
                If you receive a message that violates these guidelines, open Contact Support
                and choose Report Abuse — our moderation team reviews every report. Reporting
                others falsely to silence them is itself a violation. Depending on the severity,
                we may remove content, suspend accounts, or issue permanent bans. Serious
                violations may be reported to law enforcement.
              </>
            }
          />

          <Section
            title="Appeals"
            body={
              <>
                If you believe action was taken against your account in error, you can appeal
                through the Help Center or by contacting us directly. We review appeals fairly
                and will correct mistakes when we find them.
              </>
            }
          />

          <Section
            title="Changes to These Guidelines"
            body={
              <>
                We may update these Community Guidelines as Whisper grows. Material changes will
                be announced through the app, and the latest version will always be available on
                this page.
              </>
            }
          />

          <Section
            title="Contact Us"
            body={
              <>
                Questions or concerns about our community? Reach us at{" "}
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
          These Community Guidelines are provided for informational purposes and do not
          constitute legal advice. For guidance tailored to your jurisdiction, consult a
          qualified professional.
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
