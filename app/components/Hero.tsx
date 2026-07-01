import Button from "./Button";
import PhoneMockup from "./PhoneMockup";

export default function Hero() {
  return (
    <section className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-16 px-6 py-24 lg:flex-row">

      <div className="max-w-xl">

        <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-cyan-300">
          Anonymous Messages • Images
        </span>

        <h1 className="mt-8 text-6xl font-black leading-tight text-white">
          Honest conversations start with
          <span className="block bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
            Whisper
          </span>
        </h1>

        <p className="mt-6 text-lg text-gray-300">
          Create your anonymous link, receive messages and anonymous pictures,
          and discover what people really think.
        </p>

        <div className="mt-10 flex gap-4">
          <Button>Create Link</Button>
          <Button variant="secondary">Learn More</Button>
        </div>

      </div>

      <PhoneMockup />

    </section>
  );
}