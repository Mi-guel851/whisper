export default function Background() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden bg-[#090014]">

      {/* Top Left */}
      <div className="absolute -left-40 -top-40 h-[500px] w-[500px] rounded-full bg-purple-700/30 blur-[120px]" />

      {/* Bottom Right */}
      <div className="absolute -right-32 bottom-0 h-[450px] w-[450px] rounded-full bg-cyan-500/20 blur-[120px]" />

      {/* Center */}
      <div className="absolute left-1/2 top-1/2 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-fuchsia-600/10 blur-[150px]" />

    </div>
  );
}