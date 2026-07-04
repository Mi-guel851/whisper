import Background from "../components/Background";
import Hero from "../components/Hero";
import Navbar from "../components/Navbar";
import Features from "../components/Features";
import HowItWorks from "../components/HowItWorks";
import ClosingCTA from "../components/ClosingCTA";
import Footer from "../components/Footer";

export default function Home() {
  return (
    <main className="min-h-screen relative overflow-hidden">
      <Background />
      <Navbar />
      <Hero />
      <Features />
      <HowItWorks />
      <ClosingCTA />
      <Footer />
    </main>
  );
}