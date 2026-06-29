export default function Hero() {
  return (
    <section className="mx-auto flex min-h-[80vh] max-w-6xl flex-col items-center justify-center px-6 text-center text-white">
      <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-1 text-sm text-cyan-300">
        Anonymous Messaging • Images • Privacy
      </span>

      <h1 className="mt-8 text-6xl font-black leading-tight md:text-8xl">
        Whisper
      </h1>

      <p className="mt-6 max-w-2xl text-lg leading-8 text-gray-300">
        Create your anonymous profile, receive honest messages and anonymous
        pictures, and discover what people really think.
      </p>

      <div className="mt-10 flex flex-col gap-4 sm:flex-row">
        <button className="rounded-xl bg-cyan-400 px-8 py-4 font-bold text-slate-900 transition hover:scale-105">
          Create Your Link
        </button>

        <button className="rounded-xl border border-white/20 bg-white/10 px-8 py-4 font-bold backdrop-blur-lg transition hover:bg-white/20">
          Learn More
        </button>
      </div>
    </section>
  );
}