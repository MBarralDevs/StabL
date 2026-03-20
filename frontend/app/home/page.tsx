'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

// ─── Leaf SVG Component ──────────────────────────────────────────────────────

function Leaf({ style, className }: { style: React.CSSProperties; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 32"
      fill="currentColor"
      className={className}
      style={style}
    >
      <path d="M12 0C12 0 4 8 4 18C4 25 7.5 28 12 32C16.5 28 20 25 20 18C20 8 12 0 12 0ZM12 28C9 25.5 7 22 7 18C7 11.5 10.5 5.5 12 3.5C13.5 5.5 17 11.5 17 18C17 22 15 25.5 12 28Z" />
    </svg>
  );
}

// ─── Floating Leaves ─────────────────────────────────────────────────────────

function FloatingLeaves() {
  const leaves = [
    { size: 18, left: '8%', delay: '0s', duration: '18s', opacity: 0.12, rotate: 45 },
    { size: 14, left: '15%', delay: '3s', duration: '22s', opacity: 0.08, rotate: -30 },
    { size: 22, left: '25%', delay: '7s', duration: '20s', opacity: 0.15, rotate: 60 },
    { size: 12, left: '35%', delay: '1s', duration: '24s', opacity: 0.06, rotate: -45 },
    { size: 16, left: '50%', delay: '5s', duration: '19s', opacity: 0.1, rotate: 30 },
    { size: 20, left: '62%', delay: '9s', duration: '21s', opacity: 0.13, rotate: -60 },
    { size: 13, left: '72%', delay: '2s', duration: '23s', opacity: 0.07, rotate: 15 },
    { size: 17, left: '82%', delay: '6s', duration: '17s', opacity: 0.11, rotate: -20 },
    { size: 15, left: '90%', delay: '4s', duration: '25s', opacity: 0.09, rotate: 50 },
    { size: 11, left: '45%', delay: '8s', duration: '20s', opacity: 0.05, rotate: -35 },
    { size: 19, left: '55%', delay: '11s', duration: '22s', opacity: 0.14, rotate: 40 },
    { size: 14, left: '5%', delay: '10s', duration: '19s', opacity: 0.08, rotate: -50 },
  ];

  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none">
      {leaves.map((leaf, i) => (
        <Leaf
          key={i}
          className="text-accent absolute leaf-float"
          style={{
            width: leaf.size,
            height: leaf.size * 1.3,
            left: leaf.left,
            opacity: leaf.opacity,
            transform: `rotate(${leaf.rotate}deg)`,
            animationDelay: leaf.delay,
            animationDuration: leaf.duration,
          }}
        />
      ))}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function HomePage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Trigger entrance animations
    requestAnimationFrame(() => setMounted(true));
  }, []);

  return (
    <div className="min-h-screen bg-surface flex flex-col items-center justify-center relative overflow-hidden">
      {/* Ambient glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-accent/5 blur-[120px] animate-pulse-slow pointer-events-none" />
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] rounded-full bg-accent/8 blur-[80px] animate-pulse-slow pointer-events-none" style={{ animationDelay: '2s' }} />

      {/* Floating leaves */}
      <FloatingLeaves />

      {/* Content */}
      <div className="relative z-10 text-center px-6">
        {/* Logo */}
        <div
          className={`transition-all duration-1000 ease-out ${
            mounted ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-4 scale-90'
          }`}
        >
          <div className="relative inline-block">
            <img
              src="/logo.png"
              alt="StabL"
              className="w-28 h-28 mx-auto drop-shadow-[0_0_30px_rgba(74,124,89,0.3)]"
            />
          </div>
        </div>

        {/* Title */}
        <h1
          className={`mt-8 text-5xl sm:text-6xl font-bold tracking-tight transition-all duration-1000 ease-out delay-300 ${
            mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'
          }`}
        >
          <span className="text-text-primary">Stab</span>
          <span className="text-accent">L</span>
        </h1>

        {/* Tagline */}
        <p
          className={`mt-4 text-lg sm:text-xl text-text-secondary max-w-md mx-auto leading-relaxed transition-all duration-1000 ease-out delay-500 ${
            mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'
          }`}
        >
          The payment gateway built for stablecoins.
          <span className="block text-sm text-text-muted mt-2">
            Accept payments from any chain. Settle smarter.
          </span>
        </p>

        {/* Buttons */}
        <div
          className={`mt-12 flex flex-col sm:flex-row items-center justify-center gap-4 transition-all duration-1000 ease-out delay-700 ${
            mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
          }`}
        >
          <button
            onClick={() => router.push('/')}
            className="group relative px-8 py-4 rounded-xl bg-accent text-white text-sm font-semibold hover:bg-accent-hover transition-all duration-300 hover:shadow-[0_0_30px_rgba(74,124,89,0.3)] min-w-[200px]"
          >
            <span className="flex items-center justify-center gap-2">
              Dashboard
              <svg className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
            </span>
          </button>

          <button
            onClick={() => router.push('/pay')}
            className="group px-8 py-4 rounded-xl border border-accent/30 text-accent text-sm font-semibold hover:bg-accent/5 hover:border-accent/50 transition-all duration-300 min-w-[200px]"
          >
            <span className="flex items-center justify-center gap-2">
              Send Payment
              <svg className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
            </span>
          </button>

          <button
            onClick={() => router.push('/about')}
            className="group px-8 py-4 rounded-xl border border-border text-text-secondary text-sm font-semibold hover:bg-surface-overlay hover:border-border-light transition-all duration-300 min-w-[200px]"
          >
            <span className="flex items-center justify-center gap-2">
              Learn More
              <svg className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
            </span>
          </button>
        </div>

        {/* Subtle footer */}
        <p
          className={`mt-16 text-[10px] text-text-muted tracking-wider uppercase transition-all duration-1000 ease-out delay-1000 ${
            mounted ? 'opacity-100' : 'opacity-0'
          }`}
        >
          Powered by Arc Network • CCTP V2 • Uniswap V4
        </p>
      </div>
    </div>
  );
}