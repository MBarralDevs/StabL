'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Particles from '@tsparticles/react';
import { loadSlim } from '@tsparticles/slim';

// ─── Particle Config ─────────────────────────────────────────────────────────

const particleOptions: any = {
  fullScreen: false,
  background: { color: { value: 'transparent' } },
  fpsLimit: 60,
  particles: {
    number: {
      value: 35,
      density: { enable: true, width: 1920, height: 1080 },
    },
    color: { value: ['#4A7C59', '#3D6B4A', '#5A9A6B', '#2E5438'] },
    shape: {
      type: 'image',
      options: {
        image: [
          {
            src: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 32"><path fill="%234A7C59" d="M12 0C12 0 4 8 4 18C4 25 7.5 28 12 32C16.5 28 20 25 20 18C20 8 12 0 12 0Z"/></svg>'),
            width: 24,
            height: 32,
          },
          {
            src: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 20"><path fill="%233D6B4A" d="M15 0C6 0 0 6 0 12C0 18 6 20 15 20C24 20 30 18 30 12C30 6 24 0 15 0Z"/></svg>'),
            width: 30,
            height: 20,
          },
        ],
      },
    },
    opacity: {
      value: { min: 0.05, max: 0.2 },
      animation: {
        enable: true,
        speed: 0.3,
        startValue: 'random',
        sync: false,
      },
    },
    size: {
      value: { min: 8, max: 22 },
      animation: {
        enable: true,
        speed: 1,
        startValue: 'random',
        sync: false,
      },
    },
    move: {
      enable: true,
      speed: { min: 0.3, max: 1.2 },
      direction: 'bottom' as const,
      drift: { min: -0.5, max: 0.5 },
      outModes: { default: 'out' as const },
      straight: false,
    },
    rotate: {
      value: { min: 0, max: 360 },
      direction: 'random' as const,
      animation: {
        enable: true,
        speed: { min: 2, max: 8 },
        sync: false,
      },
    },
    wobble: {
      enable: true,
      distance: { min: 5, max: 15 },
      speed: { min: 2, max: 5 },
    },
    tilt: {
      enable: true,
      direction: 'random' as const,
      value: { min: 0, max: 360 },
      animation: {
        enable: true,
        speed: 5,
        sync: false,
      },
    },
  },
  detectRetina: true,
};

// ─── Page ────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [particlesReady, setParticlesReady] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setMounted(true));
  }, []);

  useEffect(() => {
    const initParticles = async () => {
      const { tsParticles } = await import('@tsparticles/engine');
      await loadSlim(tsParticles);
      setParticlesReady(true);
    };
    initParticles();
  }, []);

  return (
    <div className="min-h-screen bg-surface flex flex-col items-center justify-center relative overflow-hidden">
      {/* Ambient glow — smoother with longer duration */}
      <div
        className="absolute top-1/2 left-1/2 w-[700px] h-[700px] rounded-full pointer-events-none"
        style={{
          background: 'radial-gradient(circle, rgba(74,124,89,0.12) 0%, rgba(74,124,89,0.04) 50%, transparent 70%)',
          transform: 'translate(-50%, -50%)',
          animation: 'glowBreath 8s ease-in-out infinite',
        }}
      />
      <div
        className="absolute top-[40%] left-[48%] w-[400px] h-[400px] rounded-full pointer-events-none"
        style={{
          background: 'radial-gradient(circle, rgba(74,124,89,0.08) 0%, transparent 60%)',
          transform: 'translate(-50%, -50%)',
          animation: 'glowBreath 12s ease-in-out infinite',
          animationDelay: '3s',
        }}
      />

      {/* Particles (leaves) */}
      <div className="absolute inset-0">
        {particlesReady && (
          <Particles
            id="leaf-particles"
            options={particleOptions}
            className="w-full h-full"
          />
        )}
      </div>

      {/* Content */}
      <div className="relative z-10 text-center px-6">
        {/* Logo */}
        <div
          className={`transition-all duration-[1.5s] ease-out ${
            mounted ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-8 scale-85'
          }`}
        >
          <img
            src="/logo.png"
            alt="StabL"
            className="w-32 h-32 mx-auto"
            style={{
              filter: 'drop-shadow(0 0 40px rgba(74,124,89,0.35))',
            }}
          />
        </div>

        {/* Title */}
        <h1
          className={`mt-10 transition-all duration-[1.5s] ease-out ${
            mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'
          }`}
          style={{ transitionDelay: '0.4s' }}
        >
          <span className="text-6xl sm:text-7xl font-bold tracking-tight text-text-primary">
            Stab
          </span>
          <span className="text-6xl sm:text-7xl font-bold tracking-tight text-accent">
            L
          </span>
        </h1>

        {/* Tagline */}
        <div
          className={`mt-6 transition-all duration-[1.5s] ease-out ${
            mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'
          }`}
          style={{ transitionDelay: '0.7s' }}
        >
          <p className="text-xl sm:text-2xl text-text-secondary font-light max-w-lg mx-auto leading-relaxed">
            The payment gateway<br />built for stablecoins.
          </p>
          <p className="text-sm text-text-muted mt-3">
            Accept payments from any chain. Settle smarter.
          </p>
        </div>

        {/* Divider */}
        <div
          className={`mt-10 flex items-center justify-center gap-3 transition-all duration-[1.5s] ease-out ${
            mounted ? 'opacity-100' : 'opacity-0'
          }`}
          style={{ transitionDelay: '0.9s' }}
        >
          <div className="w-12 h-px bg-border" />
          <div className="w-1.5 h-1.5 rounded-full bg-accent/50" />
          <div className="w-12 h-px bg-border" />
        </div>

        {/* Buttons */}
        <div
          className={`mt-10 flex flex-col sm:flex-row items-center justify-center gap-4 transition-all duration-[1.5s] ease-out ${
            mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-12'
          }`}
          style={{ transitionDelay: '1.1s' }}
        >
          <button
            onClick={() => router.push('/overview')}
            className="group relative px-8 py-4 rounded-xl bg-accent text-white text-sm font-semibold transition-all duration-500 hover:shadow-[0_0_40px_rgba(74,124,89,0.4)] hover:scale-[1.02] min-w-[220px]"
          >
            <span className="flex items-center justify-center gap-2">
              Open Dashboard
              <svg className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
            </span>
          </button>

          <button
            onClick={() => router.push('/pay')}
            className="group px-8 py-4 rounded-xl border border-accent/30 text-accent text-sm font-semibold transition-all duration-500 hover:bg-accent/5 hover:border-accent/50 hover:shadow-[0_0_30px_rgba(74,124,89,0.15)] hover:scale-[1.02] min-w-[220px]"
          >
            <span className="flex items-center justify-center gap-2">
              Send Payment
              <svg className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
            </span>
          </button>

          <button
            onClick={() => router.push('/about')}
            className="group px-8 py-4 rounded-xl border border-border text-text-secondary text-sm font-semibold transition-all duration-500 hover:bg-surface-overlay hover:border-border-light hover:scale-[1.02] min-w-[220px]"
          >
            <span className="flex items-center justify-center gap-2">
              Learn More
              <svg className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
            </span>
          </button>
        </div>

        {/* Footer */}
        <p
          className={`mt-20 text-[10px] text-text-muted/50 tracking-[0.2em] uppercase transition-all duration-[2s] ease-out ${
            mounted ? 'opacity-100' : 'opacity-0'
          }`}
          style={{ transitionDelay: '1.5s' }}
        >
          Powered by Arc Network • CCTP V2 • Uniswap V4
        </p>
      </div>
    </div>
  );
}