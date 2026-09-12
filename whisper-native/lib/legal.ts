/**
 * The legal pages' content — Terms of Service, Privacy Policy, Community
 * Guidelines — extracted verbatim from the web app's pages of the same names.
 * The words users agree to should not differ between the site and the phone:
 * consent is given to one document, not one per client. Screens render these
 * sections natively.
 */

export type LegalSection = { title: string; body: string };

export type LegalPage = { slug: string; title: string; eyebrow: string; sections: LegalSection[] };


export const TERMS_SECTIONS: LegalSection[] = [
  {
    title: "Acceptance of These Terms",
    body: `By creating an account or using Whisper, you agree to these Terms, our Community Guidelines, and our Privacy Policy. If you do not agree with any part of them, please do not use the service.`,
  },
  {
    title: "Eligibility",
    body: `You must be at least 13 years old, or the minimum age required in your country, to use Whisper. Users under 18 should use the service with the permission of a parent or guardian. When you create an account, you agree to provide accurate and up-to-date information.`,
  },
  {
    title: "The Service",
    body: `Whisper provides a personal link where others can send you anonymous messages. The service is offered &ldquo;as is&rdquo; and &ldquo;as available&rdquo;. We may add, change, or remove features over time, and we do not guarantee that the service will be uninterrupted or error-free.`,
  },
  {
    title: "Your Account",
    body: `You are responsible for safeguarding your login credentials and for everything that happens through your account. Please contact us immediately if you believe your account has been compromised or is being used without your permission.`,
  },
  {
    title: "Anonymous Messages & Safety",
    body: `Messages sent through Whisper are intended to be anonymous to the recipient. To keep everyone safe, we may access message content or associated technical information when required by law, to protect the safety of our users, to prevent abuse or fraud, or to enforce these Terms. Attempting to identify, confront, or retaliate against an anonymous sender is a violation of our Community Guidelines.`,
  },
  {
    title: "Acceptable Use",
    body: `You agree to follow our Community Guidelines and not to use Whisper to harass, threaten, bully, or abuse others; to send hateful, explicit, illegal, or dangerous content; to impersonate people or entities; to spam, phish, or solicit; or to interfere with or disrupt the service. We may remove content and suspend or terminate accounts that violate these rules.`,
  },
  {
    title: "Content & License",
    body: `You keep the rights to the content you send. By using Whisper, you grant us a limited, non-exclusive license to store, process, and display that content solely to operate and improve the service. We do not claim ownership of your content.`,
  },
  {
    title: "Paid Features",
    body: `Optional features such as coins and hints may be paid. Purchases are processed by the relevant app store, whose terms and refund policies apply, and are final except as required by law. Prices, features, and availability may change with notice.`,
  },
  {
    title: "Termination",
    body: `You may stop using Whisper and delete your account at any time. We may suspend or terminate your access if you violate these Terms or our Community Guidelines, or if we reasonably believe your use of the service poses a risk to others.`,
  },
  {
    title: "Disclaimer & Limitation of Liability",
    body: `Whisper is provided without warranties of any kind, whether express or implied. To the maximum extent permitted by law, we are not liable for indirect, incidental, or consequential damages arising from your use of the service, including content submitted by other users or the actions of third-party services.`,
  },
  {
    title: "Changes to These Terms",
    body: `We may update these Terms from time to time to reflect changes in our practices or for legal, technical, or operational reasons. Material changes will be communicated through the app and, where required, by notice. Your continued use of Whisper after changes take effect constitutes acceptance of the updated Terms.`,
  },
  {
    title: "Contact Us",
    body: `Questions about these Terms? We are happy to help. Reach us at whisper.anonymous.app@gmail.com.`,
  },
];

export const PRIVACY_SECTIONS: LegalSection[] = [
  {
    title: "Information We Collect",
    body: `We collect the minimum information necessary to provide our anonymous messaging service. This includes your email address for account authentication and the content of the messages you send or receive. We do not collect names, phone numbers, or location data unless you voluntarily provide them. Where you sign in with Google, we may receive your name and profile photo as shared by Google under their own consent flow.`,
  },
  {
    title: "Anonymous Messaging",
    body: `When you send a message through a Whisper link, your identity is not shared with the recipient. We do not store IP addresses in connection with individual messages. However, we may access message content or associated technical information if required by law enforcement, to protect the safety of our users, to prevent abuse or fraud, or to enforce our Terms of Service.`,
  },
  {
    title: "How We Use Your Information",
    body: `We use the information we collect solely to operate and improve Whisper: to create and maintain your account, to deliver messages sent to your link, to detect and respond to abuse, spam, or harmful content, to keep the service reliable, and to communicate with you about your account when necessary. We do not sell your personal information, and we do not use it for third-party advertising without your consent.`,
  },
  {
    title: "Cookies & Technical Data",
    body: `We use essential cookies and similar technologies to keep you signed in and to remember your preferences. We also collect standard technical data such as device type, browser type, and usage logs automatically for security, abuse-prevention, and performance-monitoring purposes. Where required by law, we will ask for consent before using non-essential analytics.`,
  },
  {
    title: "Storage & Security",
    body: `Your messages and account data are stored on encrypted, access-controlled servers. We apply industry-standard safeguards — including encryption in transit and at rest, least-privilege access, and regular monitoring — to protect your information. No method of transmission or storage is completely secure, but we work continuously to keep your data safe.`,
  },
  {
    title: "Data Retention",
    body: `We retain account and message data for as long as your account is active and as long as reasonably necessary to operate the service and comply with legal obligations. You may request the deletion of your account and associated data at any time using the contact details below, and we will honour valid requests within the timeframes required by applicable law.`,
  },
  {
    title: "Data Sharing",
    body: `We do not sell, trade, or rent your personal information. We may share it only with trusted service providers who help us operate Whisper (such as cloud hosting and authentication providers), strictly to the extent necessary to run the service and under confidentiality obligations. We may also disclose information if required by law, to protect the rights and safety of Whisper or its users, or in connection with a merger, acquisition, or asset transfer.`,
  },
  {
    title: "Third-Party Services",
    body: `Whisper relies on a small number of trusted third-party providers, including our database and authentication host, optional Google Sign-In, and payment processing for optional features. These providers may process your data on our behalf under their own privacy and security practices. We recommend reviewing their policies; we are not responsible for their independent handling of data.`,
  },
  {
    title: "Children's Privacy",
    body: `Whisper is not directed to children under 13 years of age (or the minimum age required in your jurisdiction). We do not knowingly collect personal information from children. If you believe a child has provided us with personal information, please contact us and we will take steps to delete it.`,
  },
  {
    title: "Your Rights",
    body: `Depending on where you live, you may have the right to access, correct, or delete your personal data, to object to or restrict certain processing, to withdraw consent, and to data portability. To exercise any of these rights, contact us using the details below. We will respond within the timeframes required by applicable law.`,
  },
  {
    title: "Changes to This Policy",
    body: `We may update this Privacy Policy from time to time to reflect changes in our practices or for legal, technical, or operational reasons. Material changes will be communicated through the app and, where required, by notice. Your continued use of Whisper after changes take effect constitutes acceptance of the updated policy.`,
  },
  {
    title: "Contact Us",
    body: `Questions about this policy or your data? We are happy to help. Reach us at whisper.anonymous.app@gmail.com.`,
  },
];

export const GUIDELINES_SECTIONS: LegalSection[] = [
  {
    title: "Be Kind & Respectful",
    body: `Whisper is a space for honest, constructive communication. Treat every person with the same courtesy and respect you would expect for yourself. Harassment, bullying, threats, and targeted abuse are not tolerated and may result in account suspension.`,
  },
  {
    title: "No Hate Speech",
    body: `We do not allow content that promotes violence, discrimination, or hatred against any individual or group based on race, ethnicity, religion, national origin, gender, sexual orientation, disability, or any other protected characteristic.`,
  },
  {
    title: "Use Anonymity Responsibly",
    body: `Anonymity exists to encourage honesty, not to shield harm. Do not use Whisper to spread false information, impersonate others, or deceive or manipulate people — and never attempt to identify, reveal, or confront an anonymous sender. Send every whisper in good faith.`,
  },
  {
    title: "Protect Privacy",
    body: `Do not share anyone's personal information without their consent — including real names, addresses, phone numbers, or photos — and do not encourage others to do so. Respecting privacy is the foundation of our community.`,
  },
  {
    title: "No Spam, Scams, or Solicitation",
    body: `Keep whispers human. Do not use Whisper links to send unsolicited promotions, chain messages, phishing links, scams, or attempts to redirect people off the service. Accounts that spam others may lose messaging privileges.`,
  },
  {
    title: "Keep Content Appropriate",
    body: `Do not use Whisper to share illegal content, graphic sexual content, or content that promotes violence, self-harm, or the exploitation of minors. When in doubt, leave it out.`,
  },
  {
    title: "Age Requirements",
    body: `Whisper is intended for users aged 13 and older. Users under 18 should have the permission of a parent or guardian, and we do not knowingly allow children under 13 to use the platform.`,
  },
  {
    title: "Reporting & Enforcement",
    body: `If you receive a message that violates these guidelines, open Contact Support and choose Report Abuse — our moderation team reviews every report. Reporting others falsely to silence them is itself a violation. Depending on the severity, we may remove content, suspend accounts, or issue permanent bans. Serious violations may be reported to law enforcement.`,
  },
  {
    title: "Appeals",
    body: `If you believe action was taken against your account in error, you can appeal through the Help Center or by contacting us directly. We review appeals fairly and will correct mistakes when we find them.`,
  },
  {
    title: "Changes to These Guidelines",
    body: `We may update these Community Guidelines as Whisper grows. Material changes will be announced through the app, and the latest version will always be available on this page.`,
  },
  {
    title: "Contact Us",
    body: `Questions or concerns about our community? Reach us at whisper.anonymous.app@gmail.com.`,
  },
];

export const LEGAL_PAGES: LegalPage[] = [
  { slug: "privacy", title: "Privacy Policy", eyebrow: "Legal", sections: PRIVACY_SECTIONS },
  { slug: "terms", title: "Terms of Service", eyebrow: "Legal", sections: TERMS_SECTIONS },
  { slug: "guidelines", title: "Community Guidelines", eyebrow: "Safety", sections: GUIDELINES_SECTIONS },
];

export function legalPageBySlug(slug: string): LegalPage | undefined {
  return LEGAL_PAGES.find((page) => page.slug === slug);
}
