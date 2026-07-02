import Background from "../components/Background";
import Hero from "../components/Hero";
import Navbar from "../components/Navbar";

export default function Home() {
  return (
    <main className="min-h-screen relative overflow-hidden">
      <Background />
      <Navbar />
      <Hero />
    </main>
  );
}