"use client";

import { useState } from "react";

const themes = [
  { name: "Purple", color: "bg-purple-600" },
  { name: "Blue", color: "bg-cyan-500" },
  { name: "Pink", color: "bg-pink-500" },
  { name: "Green", color: "bg-green-500" },
  { name: "Orange", color: "bg-orange-500" },
];

export default function ThemeSelector() {
  const [selected, setSelected] = useState("Purple");

  return (
    <div className="rounded-3xl border border-white/10 bg-white/10 backdrop-blur-xl p-6">

      <h2 className="text-2xl font-bold text-white mb-5">
        Theme
      </h2>

      <div className="flex gap-4 flex-wrap">

        {themes.map((theme) => (
          <button
            key={theme.name}
            onClick={() => setSelected(theme.name)}
            className={`h-14 w-14 rounded-full ${theme.color} border-4 ${
              selected === theme.name
                ? "border-white"
                : "border-transparent"
            }`}
          />
        ))}

      </div>

      <p className="mt-5 text-gray-400">
        Selected: <span className="text-white">{selected}</span>
      </p>

    </div>
  );
}