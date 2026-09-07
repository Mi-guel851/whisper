"use client";

import { FileText, ChevronRight } from "lucide-react";
import GlassPanel from "@/components/GlassPanel";

export default function TermsPage() {
  return (
    <main className="relative min-h-screen overflow-hidden theme-bg-gradient text-white px-4 py-16">
      {/* Ambient gradient glows — the signature Whisper backdrop. */}
      <div className="pointer-events-none absolute -top-40 -left-40 h-96 w-96 rounded-full bg-purple-600/25 blur-[150px]" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-[500px] w-[500px] rounded-full bg-purple-600/20 blur-[180px]" />
      <div className="pointer-events-none absolute top-1/3 right-[-80px] h-72 w-72 rounded-full bg-cyan-500/10 blur-[130px]" />

      <div className="relative z-10 mx-auto max-w-2xl">
        <GlassPanel strong className="rounded-3xl p-8 text-center md:p-12">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-purple-500/30 to-purple-600/10 ring-1 ring-purple-400/30">
            <FileText size={30} className="text-purple-300" />
          </div>
          <h1 className="page-title">Terms of Service</h1>
          <p className="page-subtitle mt-3 text-gray-400">Last updated: September 2026</p>
        </GlassPanel>

        <div className="mt-6 space-y-5">
          <Section
            title="Acceptance of These Terms"
            body={
              <>
                By creating an account or using Whisper, you agree to these Terms, our Community
                Guidelines, and our Privacy Policy. If you do not agree with any part of them,
                please do not use the service.
              </>
            }
          />

          <Section
            title="Eligibility"
            body={
              <>
                You must be at least 13 years old, or the minimum age required in your country,
                to use Whisper. Users under 18 should use the service with the permission of a
                parent or guardian. When you create an account, you agree to provide accurate and
                up-to-date information.
              </>
            }
          />

          <Section
            title="The Service"
            body={
              <>
                Whisper provides a personal link where others can send you anonymous messages.
                The service is offered &ldquo;as is&rdquo; and &ldquo;as available&rdquo;. We may
                add, change, or remove features over time, and we do not guarantee that the
                service will be uninterrupted or error-free.
              </>
            }
          />

          <Section
            title="Your Account"
            body={
              <>
                You are responsible for safeguarding your login credentials and for everything
                that happens through your account. Please contact us immediately if you believe
                your account has been compromised or is being used without your permission.
              </>
            }
          />

          <Section
            title="Anonymous Messages & Safety"
            body={
              <>
                Messages sent through Whisper are intended to be anonymous to the recipient.
                To keep everyone safe, we may access message content or associated technical
                information when required by law, to protect the safety of our users, to prevent
                abuse or fraud, or to enforce these Terms. Attempting to identify, confront, or
                retaliate against an anonymous sender is a violation of our Community Guidelines.
              </>
            }
          />

          <Section
            title="Acceptable Use"
            body={
              <>
                You agree to follow our Community Guidelines and not to use Whisper to harass,
                threaten, bully, or abuse others; to send hateful, explicit, illegal, or
                dangerous content; to impersonate people or entities; to spam, phish, or solicit;
                or to interfere with or disrupt the service. We may remove content and suspend or
                terminate accounts that violate these rules.
              </>
            }
          />

          <Section
            title="Content & License"
            body={
              <>
                You keep the rights to the content you send. By using Whisper, you grant us a
                limited, non-exclusive license to store, process, and display that content solely
                to operate and improve the service. We do not claim ownership of your content.
              </>
            }
          />

          <Section
            title="Paid Features"
            body={
              <>
                Optional features such as coins and hints may be paid. Purchases are processed by
                the relevant app store, whose terms and refund policies apply, and are final
                except as required by law. Prices, features, and availability may change with
                notice.
              </>
            }
          />

          <Section
            title="Termination"
            body={
              <>
                You may stop using Whisper and delete your account at any time. We may suspend or
                terminate your access if you violate these Terms or our Community Guidelines, or
                if we reasonably believe your use of the service poses a risk to others.
              </>
            }
          />

          <Section
            title="Disclaimer & Limitation of Liability"
            body={
              <>
                Whisper is provided without warranties of any kind, whether express or implied.
                To the maximum extent permitted by law, we are not liable for indirect,
                incidental, or consequential damages arising from your use of the service,
                including content submitted by other users or the actions of third-party services.
              </>
            }
          />

          <Section
            title="Changes to These Terms"
            body={
              <>
                We may update these Terms from time to time to reflect changes in our practices
                or for legal, technical, or operational reasons. Material changes will be
                communicated through the app and, where required, by notice. Your continued use
                of Whisper after changes take effect constitutes acceptance of the updated Terms.
              </>
            }
          />

          <Section
            title="Contact Us"
            body={
              <>
                Questions about these Terms? We are happy to help. Reach us at{" "}
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
          These Terms of Service are provided for informational purposes and do not constitute
          legal advice. For terms tailored to your jurisdiction, consult a qualified professional.
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
