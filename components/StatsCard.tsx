interface StatsCardProps {
  title: string;
  value: number;
  color?: string;
}

export default function StatsCard({
  title,
  value,
  color = "from-cyan-500 to-purple-600",
}: StatsCardProps) {
  return (
    <div
      className={`rounded-3xl bg-gradient-to-r ${color} p-[1px]`}
    >
      <div className="rounded-3xl bg-[#120021] p-6 text-center">

        <h2 className="text-3xl font-black text-white">
          {value}
        </h2>

        <p className="mt-2 text-gray-400">
          {title}
        </p>

      </div>
    </div>
  );
}