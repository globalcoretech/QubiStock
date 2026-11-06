import React, { useEffect, useState } from "react";
import qubiLogo from "../assets/qubistock_logo.png";

interface SplashScreenProps {
  onFinish?: () => void;
  minDurationMs?: number;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({
  onFinish,
  minDurationMs = 1800,
}) => {
  const [fading, setFading] = useState(false);
  const [progress, setProgress] = useState(15);

  useEffect(() => {
    // Smooth progress simulation
    const p1 = setTimeout(() => setProgress(45), 300);
    const p2 = setTimeout(() => setProgress(80), 800);
    const p3 = setTimeout(() => setProgress(100), minDurationMs - 300);

    const fadeTimer = setTimeout(() => {
      setFading(true);
    }, minDurationMs);

    const finishTimer = setTimeout(() => {
      if (onFinish) onFinish();
    }, minDurationMs + 400);

    return () => {
      clearTimeout(p1);
      clearTimeout(p2);
      clearTimeout(p3);
      clearTimeout(fadeTimer);
      clearTimeout(finishTimer);
    };
  }, [minDurationMs, onFinish]);

  return (
    <div
      data-testid="qubistock-splash-screen"
      className={`fixed inset-0 z-9999 flex flex-col items-center justify-between p-8 bg-gradient-to-b from-[#091823] via-[#0b2436] to-[#06141e] text-white transition-opacity duration-400 ease-out select-none ${
        fading ? "opacity-0 pointer-events-none" : "opacity-100"
      }`}
    >
      <div className="w-full" />

      {/* Center Logo & Branding */}
      <div className="flex flex-col items-center max-w-md w-full px-4 text-center">
        {/* Logo with Soft Glow */}
        <div className="relative mb-6 flex items-center justify-center p-6 bg-white/95 rounded-3xl shadow-[0_12px_40px_rgba(0,141,145,0.25)] border border-teal-500/30">
          <img
            src={qubiLogo}
            alt="QubiStock Logo"
            className="w-72 sm:w-80 h-auto object-contain drop-shadow-sm"
          />
        </div>

        <p className="text-sm font-semibold tracking-wide text-teal-200/90 mt-1">
          Smart Inventory & Billing Management
        </p>
        <p className="text-xs text-slate-400 mt-0.5">
          स्मार्ट व्यापार एवं डिजिटल बही-खाता
        </p>

        {/* Sleek Animated Progress Bar */}
        <div className="w-64 h-1.5 bg-slate-800/80 rounded-full mt-8 overflow-hidden p-0.5 border border-teal-500/20">
          <div
            className="h-full bg-gradient-to-r from-teal-400 via-emerald-400 to-teal-300 rounded-full transition-all duration-300 ease-out shadow-[0_0_8px_rgba(45,212,191,0.6)]"
            style={{ width: `${progress}%` }}
          />
        </div>

        <span className="text-[11px] font-medium text-slate-400 mt-2.5 tracking-wider animate-pulse">
          सिस्टम शुरू हो रहा है... / Initializing...
        </span>
      </div>

      {/* Footer Info */}
      <div className="flex items-center justify-between w-full max-w-md text-[11px] text-slate-500 px-2 font-mono">
        <span>QubiStock v0.3.0</span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping inline-block" />
          सुरक्षित ऑफलाइन डेटाबेस
        </span>
      </div>
    </div>
  );
};

