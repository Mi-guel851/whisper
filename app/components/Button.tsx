type ButtonProps = {
  children: React.ReactNode;
  variant?: "primary" | "secondary";
};

export default function Button({
  children,
  variant = "primary",
}: ButtonProps) {
  const styles =
    variant === "primary"
      ? "bg-gradient-to-r from-purple-600 to-cyan-500 text-white"
      : "bg-white/10 border border-white/20 text-white";

  return (
    <button
      className={`rounded-xl px-6 py-3 font-semibold transition duration-300 hover:scale-105 ${styles}`}
    >
      {children}
    </button>
  );
}