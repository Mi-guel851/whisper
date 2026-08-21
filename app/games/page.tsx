"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Check, Copy, Gamepad2, Share2 } from "lucide-react";

import BackButton from "@/components/BackButton";
import BottomNavigation from "@/components/BottomNavigation";
import GlassPanel from "@/components/GlassPanel";
import ShareMessageCard from "@/components/ShareMessageCard";
import { HAPTIC, vibrate } from "@/lib/haptics";
import {
  respectMotion,
  spring,
  staggerContainer,
  staggerItem,
} from "@/lib/motion";
import useSafeReducedMotion from "@/lib/useSafeReducedMotion";
import useWhisperShare from "@/lib/useWhisperShare";
import { gameActionSurface, gameGradient, WHISPER_GAMES, type WhisperGame } from "@/lib/whisperGames";

/**
 * Whisper Games.
 *
 * The screen exists to answer "what do I even ask people?" — so every card is one
 * tap from being sent, and Share is the primary action on each rather than a
 * detail view being the primary action. There is deliberately no per-game page:
 * an extra navigation step between "that one looks fun" and "sent" is exactly
 * where this kind of feature loses people.
 */
export default function GamesPage() {
  const reduced = useSafeReducedMotion();
  const { sharePrompt, copyPrompt, ready, link, username } = useWhisperShare();

  /* Which card just confirmed a copy. Held per-id rather than as a boolean so two
     quick copies on different cards don't tick the wrong one. */
  const [copiedId, setCopiedId] = useState<string | null>(null);

  /* The game whose share card is open. The whole game, not its id, because the
     card needs its question and its gradient — and a lookup by id would be a
     second source of truth for something already in hand. */
  const [shareGame, setShareGame] = useState<WhisperGame | null>(null);

  function handleShare(game: WhisperGame) {
    vibrate(HAPTIC.tap);
    /* No link, no card: a share card whose whole purpose is to carry a link
       would be a picture of nothing. `sharePrompt` already says what to do about
       it, so the button stays honest rather than opening an empty card. */
    if (!ready) {
      void sharePrompt(game.prompt);
      return;
    }
    setShareGame(game);
  }

  async function handleCopy(game: WhisperGame) {
    const ok = await copyPrompt(game.prompt);
    if (!ok) return;
    setCopiedId(game.id);
    /* No cleanup ref: this only ever schedules a state reset that is harmless
       after unmount, and a per-card timer map would be more machinery than the
       tick is worth. */
    window.setTimeout(() => {
      setCopiedId((current) => (current === game.id ? null : current));
    }, 1600);
  }

  return (
    <main className="relative min-h-screen overflow-hidden theme-bg-gradient text-white px-4 py-16 pb-28">
      <div className="absolute -top-40 -left-40 h-96 w-96 rounded-full bg-purple-600/20 blur-[150px]" />
      <div className="absolute bottom-0 right-0 h-[500px] w-[500px] rounded-full bg-cyan-500/10 blur-[180px]" />

      <div className="relative z-10 mx-auto max-w-2xl">
        <BackButton />

        <div className="eyebrow mt-6 flex items-center gap-2 text-purple-300">
          <Gamepad2 size={14} />
          <span>Whisper Games</span>
        </div>
        <h1 className="page-title mt-2">Pick one. Send it. See what happens.</h1>
        <p className="page-subtitle mt-2">
          Every game is a question people can answer anonymously. Share one and your
          Whisper link goes with it.
        </p>

        {!ready && (
          <GlassPanel className="mt-5 rounded-2xl p-4">
            <p className="text-sm theme-text-muted">
              Set a username on your profile first — that&apos;s what creates the link
              these games are shared with.
            </p>
          </GlassPanel>
        )}

        <motion.div
          className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2"
          variants={respectMotion(staggerContainer(0.045), reduced)}
          initial="hidden"
          animate="visible"
        >
          {WHISPER_GAMES.map((game) => (
            <motion.div key={game.id} variants={respectMotion(staggerItem, reduced)}>
              <GlassPanel strong className="h-full rounded-3xl p-4">
                <div className="flex items-start gap-3">
                  {/* The tile is what makes the grid scannable — eight identical
                      glass cards would all read the same at a glance. */}
                  <span
                    aria-hidden
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-[20px]"
                    style={{ background: gameGradient(game) }}
                  >
                    {game.emoji}
                  </span>

                  <div className="min-w-0 flex-1">
                    <h2 className="text-[15px] font-black leading-tight text-white">
                      {game.title}
                    </h2>
                    <p className="mt-0.5 text-[12px] leading-snug theme-text-subtle">
                      {game.tagline}
                    </p>
                  </div>
                </div>

                {/* The question itself, so it goes through a theme token rather
                    than `text-white/80`. Tailwind's opacity modifier compiles to
                    a literal white, and the compatibility bridge only rewrites
                    the bare `.text-white` — so an /80 stayed white against the
                    light theme's white card. */}
                <p className="mt-3 text-[13px] leading-snug theme-text-muted">
                  &ldquo;{game.prompt}&rdquo;
                </p>

                <div className="mt-3.5 flex items-center gap-2">
                  <motion.button
                    type="button"
                    onClick={() => handleShare(game)}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl py-2.5 text-[13px] font-black"
                    /* Colour inline rather than `text-white`: the bridge resolves
                       that class to the theme's foreground, which is near-black
                       in light theme — on a deep gradient the label would then
                       disappear on the other side of the toggle. */
                    style={{ background: gameActionSurface(game), color: "#ffffff" }}
                    whileTap={reduced ? undefined : { scale: 0.97 }}
                    transition={spring.snappy}
                  >
                    <Share2 size={14} />
                    Share
                  </motion.button>

                  <motion.button
                    type="button"
                    onClick={() => void handleCopy(game)}
                    aria-label={`Copy the ${game.title} prompt`}
                    className="glass-control flex h-10 w-10 items-center justify-center rounded-2xl theme-text-muted"
                    whileTap={reduced ? undefined : { scale: 0.92 }}
                    transition={spring.snappy}
                  >
                    {copiedId === game.id ? (
                      <motion.span
                        initial={reduced ? undefined : { scale: 0.5, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={spring.bouncy}
                        className="flex text-emerald-300"
                      >
                        <Check size={16} />
                      </motion.span>
                    ) : (
                      <Copy size={15} />
                    )}
                  </motion.button>
                </div>
              </GlassPanel>
            </motion.div>
          ))}
        </motion.div>
      </div>

      <BottomNavigation />

      {/* The question goes out as a story card tinted to the tile it was tapped
          on, rather than as a line of text. A pasted sentence is scrolled past; a
          card is posted. The handle sits in the glass half because that is the
          part a viewer has to read to answer. */}
      {shareGame && (
        <ShareMessageCard
          prompt={shareGame.prompt}
          accent={shareGame.gradient}
          message={username ? `@${username}` : ""}
          shareUrl={link}
          shareText={`${shareGame.prompt}\n\nTell me anonymously 👇`}
          onClose={() => setShareGame(null)}
        />
      )}
    </main>
  );
}
