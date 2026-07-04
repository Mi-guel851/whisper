"use client";

export default function ShareCard() {
  const link = "https://whisper.app/u/yourname";

  function copy() {
    navigator.clipboard.writeText(link);
    alert("Copied!");
  }

  return (
    <div className="rounded-3xl bg-white/10 border border-white/10 p-6 backdrop-blur-xl">

      <h2 className="text-white font-bold text-xl mb-4">
        Your Anonymous Link
      </h2>

      <div className="bg-black/40 p-3 rounded-xl text-cyan-300 text-sm">
        {link}
      </div>

      <button
        onClick={copy}
        className="mt-4 w-full bg-gradient-to-r from-purple-600 to-cyan-500 text-white font-bold p-3 rounded-xl"
      >
        Copy Link
      </button>

    </div>
  );
}