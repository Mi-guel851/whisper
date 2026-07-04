"use client";

export default function Background() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden bg-[#070012]">

      <div className="absolute -left-40 -top-40 h-[500px] w-[500px] rounded-full bg-cyan-500/20 blur-[180px] animate-pulse" />

      <div className="absolute right-[-120px] top-[80px] h-[420px] w-[420px] rounded-full bg-purple-600/20 blur-[180px] animate-pulse" />

      <div className="absolute bottom-[-180px] left-1/2 h-[550px] w-[550px] -translate-x-1/2 rounded-full bg-fuchsia-500/10 blur-[220px]" />

      <div
        className="absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,.25) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.25) 1px, transparent 1px)",
          backgroundSize: "50px 50px",
        }}
      />

    </div>
  );
}