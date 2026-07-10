import GlassPanel from "@/components/GlassPanel";

export const metadata = {
  title: "Privacy Policy | Whisper",
};

export default function PrivacyPage() {
  return (
    <main className="relative min-h-screen overflow-hidden theme-bg-gradient text-white px-4 py-16">
      <div className="absolute -top-40 -left-40 h-96 w-96 rounded-full bg-cyan-500/20 blur-[150px]" />
      <div className="absolute bottom-0 right-0 h-[500px] w-[500px] rounded-full bg-purple-600/20 blur-[180px]" />

      <GlassPanel strong className="relative z-10 mx-auto max-w-3xl rounded-3xl p-8 md:p-12">
        <h1 className="text-4xl font-black mb-2">Privacy Policy</h1>
        <p className="text-gray-400 mb-8">Last updated: July 8, 2026</p>

        <div className="space-y-8 text-gray-200 leading-relaxed">
          <section>
            <p>
              Whisper ("we," "our," or "us") lets users create a personal link to receive
              anonymous messages from others. This policy explains what information we collect,
              how we use it, and the choices you have.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-2">1. Information We Collect</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <span className="font-semibold text-white">Account information:</span> when you
                sign up, we collect your email address and, if you use Google Sign-In, your name
                and profile photo as provided by Google.
              </li>
              <li>
                <span className="font-semibold text-white">Messages:</span> content sent to your
                Whisper link is stored so you can view it. Senders of anonymous messages are not
                required to create an account, and we do not knowingly collect identifying
                information from anonymous senders beyond standard technical data (see below).
              </li>
              <li>
                <span className="font-semibold text-white">Technical data:</span> IP address,
                browser type, device information, and usage logs, collected automatically for
                security and abuse-prevention purposes.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-2">2. How We Use Information</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>To create and maintain your account</li>
              <li>To deliver messages sent to your Whisper link</li>
              <li>To detect, prevent, and respond to abuse, spam, or harmful content</li>
              <li>To improve and maintain the reliability of the service</li>
              <li>To communicate with you about your account, when necessary</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-2">3. Third-Party Services</h2>
            <p>
              We use trusted third-party providers to operate Whisper, including:
            </p>
            <ul className="list-disc pl-6 space-y-2 mt-2">
              <li><span className="font-semibold text-white">Supabase</span> — authentication and database hosting</li>
              <li><span className="font-semibold text-white">Google</span> — optional sign-in (OAuth)</li>
              <li><span className="font-semibold text-white">Vercel</span> — application hosting</li>
            </ul>
            <p className="mt-2">
              These providers may process your data on our behalf under their own privacy and
              security practices.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-2">4. Data Retention</h2>
            <p>
              We retain account and message data for as long as your account is active. You may
              request deletion of your account and associated data at any time by contacting us
              (see Section 7).
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-2">5. Data Sharing</h2>
            <p>
              We do not sell your personal information. We may share information if required by
              law, to protect the rights and safety of Whisper or its users, or with service
              providers strictly to operate the app as described above.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-2">6. Your Rights</h2>
            <p>
              Depending on your location, you may have the right to access, correct, or delete
              your personal data, or to object to certain processing. To exercise these rights,
              contact us using the details below.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-2">7. Contact Us</h2>
            <p>
              Questions about this policy or your data? Reach out at {"whisper.anonymous.app@gmail.com "}
              <a href="mailto:@whisper.anonymous.app@gmail.com" className="text-cyan-300 hover:text-cyan-200">
                
              </a>{" "}
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-2">8. Changes to This Policy</h2>
            <p>
              We may update this policy from time to time. Continued use of Whisper after changes
              take effect constitutes acceptance of the updated policy.
            </p>
          </section>
        </div>
      </GlassPanel>
    </main>
  );
}