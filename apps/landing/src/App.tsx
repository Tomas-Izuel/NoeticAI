import { useState, lazy, Suspense, startTransition, useEffect } from "react";
import "./landing.css";
import { Nav } from "./components/Nav";
import { Hero } from "./components/Hero";
import { InPlainWords } from "./components/InPlainWords";
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
import { SpeedInsights } from "@vercel/speed-insights/react";

const WaitlistModal = lazy(() =>
  import("./components/WaitlistModal").then((m) => ({ default: m.WaitlistModal }))
);

export function App() {
  const [modalOpen, setModalOpen] = useState(false);

  const openWaitlist = () => startTransition(() => setModalOpen(true));
  const closeWaitlist = () => setModalOpen(false);

  useEffect(() => {
    const w = window as unknown as {
      requestIdleCallback?: (cb: () => void) => number;
      cancelIdleCallback?: (h: number) => void;
    };
    const idle = w.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1000) as unknown as number);
    const cancel = w.cancelIdleCallback ?? ((h: number) => window.clearTimeout(h));
    const handle = idle(() => { void import("./components/WaitlistModal"); });
    return () => cancel(handle);
  }, []);

  return (
    <>
      <div className="landing">
        <Nav onWaitlist={openWaitlist} />
        <main>
          <Hero onWaitlist={openWaitlist} />
          <div className="cv-section cv-section--in-plain-words">
            <InPlainWords />
          </div>
          <div className="cv-section cv-section--trust">
            <Trust />
          </div>
          <div className="cv-section cv-section--how-it-works">
            <HowItWorks />
          </div>
          <div className="cv-section cv-section--coverage-states">
            <CoverageStates />
          </div>
          <div className="cv-section cv-section--features">
            <Features />
          </div>
          <div className="cv-section cv-section--audiences">
            <Audiences />
          </div>
          <div className="cv-section cv-section--quote-block">
            <QuoteBlock />
          </div>
          <div className="cv-section cv-section--pricing">
            <Pricing onWaitlist={openWaitlist} />
          </div>
          <div className="cv-section cv-section--faq">
            <FAQ />
          </div>
          <div className="cv-section cv-section--final-cta">
            <FinalCTA onWaitlist={openWaitlist} />
          </div>
        </main>
        <div className="cv-section cv-section--footer">
          <Footer />
        </div>
      </div>
      {modalOpen && (
        <Suspense fallback={null}>
          <WaitlistModal isOpen={modalOpen} onClose={closeWaitlist} />
        </Suspense>
      )}
      <SpeedInsights />
    </>
  );
}
