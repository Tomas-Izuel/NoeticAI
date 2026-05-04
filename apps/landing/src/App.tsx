import { useState } from "react";
import "./landing.css";
import { Nav } from "./components/Nav";
import { Hero } from "./components/Hero";
import { Trust } from "./components/Trust";
import { HowItWorks } from "./components/HowItWorks";
import { CoverageStates } from "./components/CoverageStates";
import { Features } from "./components/Features";
import { Audiences } from "./components/Audiences";
import { QuoteBlock } from "./components/QuoteBlock";
import { Pricing } from "./components/Pricing";
import { FAQ } from "./components/FAQ";
import { FinalCTA } from "./components/FinalCTA";
import { Footer } from "./components/Footer";
import { WaitlistModal } from "./components/WaitlistModal";

export function App() {
  const [modalOpen, setModalOpen] = useState(false);

  const openWaitlist = () => setModalOpen(true);
  const closeWaitlist = () => setModalOpen(false);

  return (
    <>
      <div className="landing">
        <Nav onWaitlist={openWaitlist} />
        <main>
          <Hero onWaitlist={openWaitlist} />
          <Trust />
          <HowItWorks />
          <CoverageStates />
          <Features />
          <Audiences />
          <QuoteBlock />
          <Pricing onWaitlist={openWaitlist} />
          <FAQ />
          <FinalCTA onWaitlist={openWaitlist} />
        </main>
        <Footer />
      </div>
      <WaitlistModal isOpen={modalOpen} onClose={closeWaitlist} />
    </>
  );
}
