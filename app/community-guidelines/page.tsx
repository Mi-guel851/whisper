import GlassPanel from "@/components/GlassPanel";
import BackButton from "@/components/BackButton";
import { Heart, Shield, MessageSquare, Ban, Users, ScrollText } from "lucide-react";

export const metadata = {
  title: "Community Guidelines | Whisper",
};

const SECTIONS = [
  {
    icon: Heart,
    title: "Be Kind & Respectful",
    body: "Whisper is a space for honest, constructive communication. Treat every user with respect. Harassment, bullying, threats, or targeted attacks are strictly prohibited and will result in immediate account suspension.",
  },
  {
    icon: Shield,
    title: "No Hate Speech",
    body: "We do not tolerate content that promotes violence, discrimination, or hatred against any individual or group based on race, ethnicity, religion, gender, sexual orientation, disability, or any other protected characteristic.",
  },
  {
    icon: MessageSquare,
    title: "Use Anonymity Responsibly",
    body: "Anonymity is a feature, not a shield for harm. Do not use Whisper to spread false information, impersonate others, or manipulate people. Messages should be authentic and sent in good faith.",
  },
  {
    icon: Ban,
    title: "No Spam or Solicitation",
    body: "Do not use Whisper links to send promotional content, chain messages, phishing links, or unsolicited advertisements. Spamming users will result in loss of messaging privileges.",
  },
  {
    icon: Users,
    title: "Protect Privacy",
    body: "Do not share someone's personal information (doxxing), including real names, addresses, phone numbers, or photos without consent. Respecting privacy is the foundation of our community.",
  },
  {
    icon: ScrollText,
    title: "Reporting",
    /* Was "use the report and block features" — there are no such buttons in the
       app. Contact Support's Report Abuse category is the real path, and pointing
       at a control that doesn't exist is worse than pointing at nothing. */
    body: "If you receive a message that violates these guidelines, open Contact Support and choose Report Abuse. Our moderation team reviews all reports and takes appropriate action. You can also delete any whisper from the Whispers tab. False reporting to silence others is also a violation.",
  },
  {
    icon: Shield,
    title: "Age Requirements",
    body: "Whisper is intended for users 13 years and older. Users under 18 must have parental consent. We do not knowingly allow minors under 13 to use the platform.",
  },
  {
    icon: MessageSquare,
    title: "Consequences",
    body: "Violations may result in content removal, temporary suspensions, or permanent bans depending on severity. Severe violations may be reported to law enforcement. Appeals can be submitted through the Help Center.",
  },
];

export default function CommunityGuidelinesPage() {
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
              <ScrollText size={32} className="text-purple-300" />
            </div>
          </div>
          <h1 className="page-title mb-2">Community Guidelines</h1>
          <p className="page-subtitle">The rules that keep Whisper safe and welcoming for everyone.</p>
        </div>

        <GlassPanel strong className="rounded-3xl p-6 md:p-8">
          <div className="space-y-6">
            {SECTIONS.map((section) => {
              const Icon = section.icon;
              return (
                <div key={section.title} className="flex gap-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-purple-500/15 border border-purple-400/20">
                    <Icon size={20} className="text-purple-300" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-white mb-1">{section.title}</h2>
                    <p className="text-gray-300 leading-relaxed text-sm">{section.body}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </GlassPanel>
      </div>
    </main>
  );
}