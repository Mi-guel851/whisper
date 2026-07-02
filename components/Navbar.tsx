export default function Navbar() {
  return (
    <header className="sticky top-0 z-50">
      <nav className="mx-auto mt-6 flex max-w-7xl items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-6 py-4 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-purple-600 to-cyan-500 font-black text-white shadow-lg shadow-cyan-500/20">
            W
          </div>

          <div>
            <h1 className="text-xl font-black tracking-wide text-white">
              Whisper
            </h1>
            <p className="text-xs text-gray-400">
              Anonymous Messaging
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button className="rounded-xl px-5 py-2 text-gray-300 transition hover:text-white">
            Login
          </button>

          <button className="rounded-xl bg-gradient-to-r from-purple-600 to-cyan-500 px-5 py-2 font-semibold text-white transition hover:scale-105">
            Create Link
          </button>
        </div>
      </nav>
    </header>
  );
}