export default function SectionLoadingBar({ loading }: { loading: boolean }) {
  if (!loading) return null;

  return (
    <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/5 mb-4">
      <div className="absolute inset-y-0 w-1/3 rounded-full bg-gradient-to-r from-cyan-400 to-purple-500 animate-[loadingSlide_1.2s_ease-in-out_infinite]" />
      <style jsx>{`
        @keyframes loadingSlide {
          0% { left: -33%; }
          100% { left: 100%; }
        }
      `}</style>
    </div>
  );
}