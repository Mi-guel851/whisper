import GlassPanel from "@/components/GlassPanel";

export const metadata = {
  title: "Terms of Service | Whisper",
};

export default function TermsPage() {
  return (
    <main className="relative min-h-screen overflow-hidden theme-bg-gradient text-white px-4 py-16">
      <div className="absolute -top-40 -left-40 h-96 w-96 rounded-full bg-cyan-500/20 blur-[150px]" />
      <div className="absolute bottom-0 right-0 h-[500px] w-[500px] rounded-full bg-purple-600/20 blur-[180px]" />

      <GlassPanel strong className="relative z-10 mx-auto max-w-3xl rounded-3xl p-8 md:p-12">
        <h1 className="text-4xl font-black mb-2">Terms of Service</h1>
        <p className="text-gray-400 mb-8">Last updated: July 8, 2026</p>

        <div className="space-y-8 text-gray-200 leading-relaxed">
          <section>
            <p>
              Welcome to Whisper. By creating an account or using our service, you agree to these
              Terms of Service. If you do not agree, please do not use Whisper.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-2">1. The Service</h2>
            <p>
              Whisper allows users to create a personal link where others can send anonymous
              messages. We provide the service on an "as is" and "as available" basis.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-2">2. Account Registration</h2>
            <p>
              You must provide accurate information when creating an account and are responsible
              for maintaining the security of your login credentials. You must be at least 13
              years old (or the minimum age required in your country) to use Whisper.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-2">3. Acceptable Use</h2>
            <p>You agree not to use Whisper to:</p>
            <ul className="list-disc pl-6 space-y-2 mt-2">
              <li>Harass, threaten, bully, or abuse another person</li>
              <li>Send hate speech, explicit, or illegal content</li>
              <li>Impersonate another person or entity</li>
              <li>Attempt to identify anonymous senders without their consent</li>
              <li>Interfere with or disrupt the operation of the service</li>
              <li>Use automated means (bots, scrapers) to access the service without permission</li>
            </ul>
            <p className="mt-2">
              We reserve the right to remove content and suspend or terminate accounts that
              violate these terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-2">4. Anonymous Messages</h2>
            <p>
              Messages sent through Whisper are intended to be anonymous to the recipient.
              However, we may retain technical data (such as IP address) for safety, abuse
              prevention, and legal compliance purposes, and may disclose this information if
              required by law or to protect the safety of our users.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-2">5. Content Ownership</h2>
            <p>
              You retain ownership of any content you submit through Whisper. By using the
              service, you grant us a limited license to store and display that content as
              necessary to operate Whisper.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-2">6. Termination</h2>
            <p>
              You may stop using Whisper and delete your account at any time. We may suspend or
              terminate your access if you violate these terms or misuse the service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-2">7. Disclaimer & Limitation of Liability</h2>
            <p>
              Whisper is provided without warranties of any kind. To the maximum extent permitted
              by law, we are not liable for any indirect, incidental, or consequential damages
              arising from your use of the service, including content submitted by other users.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-2">8. Changes to These Terms</h2>
            <p>
              We may revise these terms from time to time. Continued use of Whisper after changes
              take effect constitutes acceptance of the revised terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-white mb-2">9. Contact</h2>
            <p>
              Questions about these terms? Contact us at{" "}
              <a href="mailto: whisper.anonymous.app@gmail.com" className="text-cyan-300 hover:text-cyan-200">
                support@whisper.anonymous.app@gmail.com

              </a>{" "}
            </p>
          </section>
        </div>
      </GlassPanel>
    </main>
  );
}