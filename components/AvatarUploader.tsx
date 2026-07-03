"use client";

import { useRef, useState } from "react";

export default function AvatarUploader() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);

  function handleSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];

    if (!file) return;

    setPreview(URL.createObjectURL(file));
  }

  return (
    <div className="rounded-3xl border border-white/10 bg-white/10 p-6 backdrop-blur-xl">

      <h2 className="mb-5 text-2xl font-bold text-white">
        Profile Picture
      </h2>

      <div className="flex flex-col items-center">

        <div
          onClick={() => inputRef.current?.click()}
          className="flex h-36 w-36 cursor-pointer items-center justify-center overflow-hidden rounded-full border-4 border-cyan-400 bg-gradient-to-br from-purple-600 to-cyan-500"
        >
          {preview ? (
            <img
              src={preview}
              alt="Avatar"
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="text-5xl">👤</span>
          )}
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={handleSelect}
        />

        <button
          onClick={() => inputRef.current?.click()}
          className="mt-6 rounded-2xl bg-cyan-400 px-6 py-3 font-bold text-black"
        >
          Change Photo
        </button>

      </div>

    </div>
  );
}