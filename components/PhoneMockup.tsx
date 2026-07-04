"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Send } from "lucide-react";
import Image from "next/image";

const SCRIPT = [
  "you don't know it but... you inspire me every day 💫",
  "your laugh is my favorite sound",
  "ngl you're better looking than you think 👀",
];

export default function PhoneMockup() {
  const [visible, setVisible] = useState<string[]>([]);
  const [typing, setTyping] = useState(false);
  const timeouts = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    function schedule(fn: () => void, delay: number) {
      const id = setTimeout(fn, delay);
      timeouts.current.push(id);
    }

    function runLoop() {
      let index = 0;

      function showNext() {
        if (index >= SCRIPT.length) {
          schedule(() => {
            setVisible([]);
            index = 0;
            showNext();
          }, 3200);
          return;
        }

        setTyping(true);
        schedule(() => {
          setTyping(false);
          setVisible((prev) => [...prev, SCRIPT[index]]);
          index += 1;
          schedule(showNext, 1600);
        }, 1300);
      }

      showNext();
    }

    runLoop();

    return () => {
      timeouts.current.forEach(clearTimeout);
    };
  }, []);

  return (
    <div className="relative" style={{ perspective: "1200px" }}>

      <div className="absolute -inset-12 rounded-full bg-cyan-500/20 blur-[120px]" />

      <div
  className="relative w-[340px] rounded-[36px] overflow-hidden animate-[phoneTilt_7s_ease-in-out_infinite]"
  style={{
    transformStyle: "preserve-3d",
    background: "rgba(11,0,22,0.5)",
    backdropFilter: "blur(40px) saturate(180%)",
    WebkitBackdropFilter: "blur(40px) saturate(180%)",
    boxShadow: "0 0 80px rgba(0,255,255,.12)",
  }}
>

        <div className="flex items-center gap-3 border-b border-white/10 bg-white/5 px-5 py-4">
          <Image
            src="/ghost.png"
            alt="Whisper"
            width={36}
            height={36}
            className="drop-shadow-[0_0_10px_rgba(34,211,238,.7)]"
          />
          <div>
            <p className="font-bold text-white leading-tight">anonymous</p>
            <p className="flex items-center gap-1 text-xs text-cyan-300">
              <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
              whispering to @you
            </p>
          </div>
        </div>

        <div className="flex min-h-[280px] flex-col justify-end gap-3 px-5 py-6">
          {visible.map((msg, i) => (
            <div
              key={i}
              className="max-w-[85%] animate-[bubbleIn_0.3s_ease-out] self-start rounded-2xl rounded-tl-sm bg-white/10 px-4 py-3 text-sm text-white"
            >
              {msg}
            </div>
          ))}

          {typing && (
            <div className="flex w-fit items-center gap-1 self-start rounded-2xl rounded-tl-sm bg-white/10 px-4 py-3">
              <span className="h-2 w-2 animate-bounce rounded-full bg-cyan-300 [animation-delay:-0.2s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-cyan-300 [animation-delay:-0.1s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-cyan-300" />
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-white/10 bg-white/5 px-4 py-3">
          <div className="flex-1 rounded-full bg-black/30 px-4 py-2.5 text-sm text-gray-400">
            send a whisper...
          </div>
          <Mic size={18} className="text-gray-400" />
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-r from-cyan-400 to-purple-500">
            <Send size={16} className="text-black" />
          </div>
        </div>

      </div>

      <style jsx global>{`
        @keyframes phoneTilt {
          0%   { transform: rotateY(-6deg) rotateX(2deg) translateZ(0px); }
          50%  { transform: rotateY(6deg) rotateX(-2deg) translateZ(10px); }
          100% { transform: rotateY(-6deg) rotateX(2deg) translateZ(0px); }
        }
        @keyframes bubbleIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

    </div>
  );
}