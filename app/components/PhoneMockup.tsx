export default function PhoneMockup() {
  return (
    <div className="relative mx-auto mt-16 w-[320px]">
      <div className="rounded-[40px] border border-white/10 bg-black/40 p-4 backdrop-blur-xl shadow-2xl">
        <div className="rounded-[30px] bg-[#120022] p-5 text-white">

          <div className="mb-6 text-center">
            <h3 className="font-bold text-lg">📩 New Anonymous Message</h3>
          </div>

          <div className="rounded-2xl bg-white/10 p-4">
            "I've always admired your confidence."
          </div>

          <div className="mt-5 rounded-2xl border border-cyan-400/20 bg-cyan-500/10 p-4">
            📷 Anonymous Image
          </div>

          <div className="mt-6 text-center text-cyan-300 font-semibold">
            12 New Messages
          </div>

        </div>
      </div>
    </div>
  );
}