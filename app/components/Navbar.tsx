export default function Navbar() {
  return (
    <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-6">
      <h1 className="text-2xl font-black tracking-wide text-white">
        Whisper
      </h1>

      <button className="rounded-xl border border-cyan-400/40 bg-cyan-400/10 px-5 py-2 text-cyan-300 transition hover:bg-cyan-400/20">
        Sign In
      </button>
    </nav>
  );
}