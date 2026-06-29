export default function Background() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden bg-[#090014]">
      {/* Purple Glow */}
      <div className="absolute left-[-150px] top-[-100px] h-96 w-96 rounded-full bg-purple-700/30 blur-3xl" />

      {/* Cyan Glow */}
      <div className="absolute bottom-[-120px] right-[-120px] h-96 w-96 rounded-full bg-cyan-500/20 blur-3xl" />

      {/* Center Glow */}
      <div className="absolute left-1/2 top-1/2 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-fuchsia-600/10 blur-3xl" />
    </div>
  );
}