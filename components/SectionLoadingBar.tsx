export default function SectionLoadingBar({ loading }: { loading: boolean }) {
  if (!loading) return null;

  return (
    <div className="relative mb-4 h-1 w-full overflow-hidden rounded-full bg-white/5">
      {/* Animates `translate`, not `left`. The previous version ran an infinite
          keyframe on `left`, which forces layout on every frame — cheap-looking
          and expensive at the same time. */}
      <div className="absolute inset-y-0 left-0 w-1/3 animate-[loadingSlide_1.2s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-purple-500 to-fuchsia-500" />
      <style jsx>{`
        @keyframes loadingSlide {
          0% {
            translate: -100% 0;
          }
          100% {
            translate: 300% 0;
          }
        }
      `}</style>
    </div>
  );
}
