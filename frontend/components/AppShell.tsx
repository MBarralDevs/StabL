'use client';

import { useState } from 'react';
import Sidebar from './Sidebar';
import { Menu } from 'lucide-react';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="h-14 border-b border-border bg-surface-raised flex items-center justify-between px-4 sm:px-6 shrink-0">
          {/* Mobile menu button */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-1.5 rounded-md text-text-muted hover:text-text-secondary hover:bg-surface-overlay transition-colors"
            >
              <Menu className="w-5 h-5" />
            </button>
            <HeaderContent />
          </div>

          {/* Wallet button */}
          <HeaderWallet />
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}

// Split Header into parts so we can place the menu button on the left
function HeaderContent() {
  // Re-use the status indicator from Header
  return (
    <div className="flex items-center gap-3">
      <div className="hidden sm:flex items-center gap-2">
        <div className="w-2 h-2 bg-success rounded-full animate-pulse" />
        <span className="text-xs text-text-muted">Connected to Arc Testnet</span>
      </div>
    </div>
  );
}

function HeaderWallet() {
  // Import ConnectButton inline to keep it simple
  const { ConnectButton } = require('@rainbow-me/rainbowkit');
  const { useAccount, useBalance } = require('wagmi');

  const ARC_USDC = '0x4c20Ca8BF703fe85447954Af3EF0E3eCf16dEdb5';
  const { address, isConnected } = useAccount();
  const { data: usdcBalance } = useBalance({
    address,
    token: ARC_USDC as `0x${string}`,
  });

  return (
    <div className="flex items-center gap-3">
      {isConnected && usdcBalance && (
        <div className="hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-md bg-surface-overlay">
          <span className="text-xs text-text-muted">Balance:</span>
          <span className="text-xs font-medium text-text-primary">
            {parseFloat(usdcBalance.formatted).toFixed(2)} USDC
          </span>
        </div>
      )}
      <ConnectButton
        chainStatus="icon"
        showBalance={false}
        accountStatus={{ smallScreen: 'avatar', largeScreen: 'address' }}
      />
    </div>
  );
}