'use client';

import { Zap, Shield, TrendingDown, Globe, Users, Layers, ArrowRight } from 'lucide-react';

export default function AboutPage() {
  return (
    <div className="p-8 max-w-4xl mx-auto">
      {/* Hero */}
      <div className="text-center mb-12">
        <div className="flex justify-center mb-6">
          <img src="/logo.png" alt="StabL" className="w-20 h-20" />
        </div>
        <h1 className="text-3xl font-bold text-text-primary mb-3">
          The Payment Gateway<br />Built for Stablecoins
        </h1>
        <p className="text-base text-text-secondary max-w-xl mx-auto leading-relaxed">
          StabL enables merchants to accept stablecoin payments from any blockchain while saving up to 95% on settlement costs through intelligent batching.
        </p>
      </div>

      {/* Problem / Solution */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-text-primary mb-3">The Problem</h2>
          <p className="text-sm text-text-muted leading-relaxed">
            Current stablecoin payment systems force merchants to choose between
            <strong className="text-text-secondary"> speed</strong> (pay high gas fees for instant settlement) and
            <strong className="text-text-secondary"> cost</strong> (wait indefinitely for cheaper settlement).
            This creates a poor experience where merchants either overpay or lose access to their funds.
          </p>
        </div>
        <div className="card p-6 border-accent/20">
          <h2 className="text-lg font-semibold text-accent mb-3">The Solution</h2>
          <p className="text-sm text-text-muted leading-relaxed">
            StabL decouples payment receipt from settlement using a
            <strong className="text-text-secondary"> carpool model</strong>. Merchants declare their settlement preferences, and the protocol automatically
            batches compatible settlements to minimize gas costs — the more merchants use StabL, the cheaper it gets for everyone.
          </p>
        </div>
      </div>

      {/* How It Works */}
      <div className="mb-12">
        <h2 className="text-xl font-semibold text-text-primary text-center mb-8">How It Works</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <StepCard
            number={1}
            icon={<Users className="w-5 h-5" />}
            title="Customer Pays"
            description="Customer sends stablecoins to the merchant via StabL Gateway — from any supported chain."
          />
          <StepCard
            number={2}
            icon={<Shield className="w-5 h-5" />}
            title="Funds Secured"
            description="Payment is deposited into PaymentPool, a secure audited smart contract on Arc."
          />
          <StepCard
            number={3}
            icon={<Layers className="w-5 h-5" />}
            title="Smart Batching"
            description="The protocol groups compatible settlements to share gas costs across merchants."
          />
          <StepCard
            number={4}
            icon={<Zap className="w-5 h-5" />}
            title="Settlement"
            description="Merchant receives funds automatically based on their chosen settlement speed."
          />
        </div>
      </div>

      {/* Features */}
      <div className="mb-12">
        <h2 className="text-xl font-semibold text-text-primary text-center mb-8">Why StabL?</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <FeatureCard
            icon={<TrendingDown className="w-5 h-5" />}
            title="Up to 95% Gas Savings"
            description="Batch settlements share gas costs across multiple merchants. The larger the network, the more you save."
          />
          <FeatureCard
            icon={<Zap className="w-5 h-5" />}
            title="Flexible Settlement"
            description="Choose Immediate, Standard, or Deferred settlement. Change anytime — your funds, your rules."
          />
          <FeatureCard
            icon={<Globe className="w-5 h-5" />}
            title="Multi-chain Payments"
            description="Accept USDC from Ethereum, Base, Arbitrum and more via Circle's Cross-Chain Transfer Protocol (CCTP V2)."
          />
          <FeatureCard
            icon={<Shield className="w-5 h-5" />}
            title="Secure & Audited"
            description="All contracts are verified on-chain. Atomic settlements ensure funds are never stuck or lost."
          />
          <FeatureCard
            icon={<Layers className="w-5 h-5" />}
            title="Cross-token Swaps"
            description="Receive payments in USDC and settle in EURC — or any supported token. Powered by Uniswap V4."
          />
          <FeatureCard
            icon={<Users className="w-5 h-5" />}
            title="Developer Friendly"
            description="Simple SDK integration. Accept stablecoin payments on your website with just a few lines of code."
          />
        </div>
      </div>

      {/* Tech Stack */}
      <div className="card p-8 mb-12">
        <h2 className="text-xl font-semibold text-text-primary text-center mb-6">Built With</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <TechItem name="Arc Network" detail="EVM chain, gas in USDC" />
          <TechItem name="Circle CCTP V2" detail="Cross-chain USDC transfers" />
          <TechItem name="Uniswap V4" detail="Settlement hooks & swaps" />
          <TechItem name="Li.Fi" detail="Multi-chain routing fallback" />
          <TechItem name="Foundry" detail="Smart contract testing" />
          <TechItem name="Next.js 14" detail="Frontend dashboard" />
          <TechItem name="Redis Streams" detail="Event-driven pipeline" />
          <TechItem name="PostgreSQL" detail="Payment persistence" />
        </div>
      </div>

      {/* CTA */}
      <div className="text-center">
        <h2 className="text-xl font-semibold text-text-primary mb-3">Ready to get started?</h2>
        <p className="text-sm text-text-muted mb-6">Connect your wallet and start accepting payments in minutes.</p>
        <div className="flex justify-center gap-4">
          <a href="/pay" className="px-6 py-3 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors">
            Send a Payment
          </a>
          <a href="/settings" className="px-6 py-3 rounded-lg border border-border text-sm font-medium text-text-secondary hover:bg-surface-overlay transition-colors">
            Configure Settings
          </a>
        </div>
      </div>
    </div>
  );
}

// ─── Components ──────────────────────────────────────────────────────────────

function StepCard({ number, icon, title, description }: {
  number: number;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="card p-5 relative">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center text-accent">
          {icon}
        </div>
        <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Step {number}</span>
      </div>
      <h3 className="text-sm font-semibold text-text-primary mb-1">{title}</h3>
      <p className="text-xs text-text-muted leading-relaxed">{description}</p>
    </div>
  );
}

function FeatureCard({ icon, title, description }: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="card p-5">
      <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center text-accent mb-3">
        {icon}
      </div>
      <h3 className="text-sm font-semibold text-text-primary mb-1">{title}</h3>
      <p className="text-xs text-text-muted leading-relaxed">{description}</p>
    </div>
  );
}

function TechItem({ name, detail }: { name: string; detail: string }) {
  return (
    <div className="text-center">
      <div className="text-sm font-medium text-text-primary">{name}</div>
      <div className="text-[10px] text-text-muted mt-0.5">{detail}</div>
    </div>
  );
}