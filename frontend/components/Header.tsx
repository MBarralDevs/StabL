'use client';

import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useBalance } from 'wagmi';
import { Activity } from 'lucide-react';

const ARC_USDC = '0x4c20Ca8BF703fe85447954Af3EF0E3eCf16dEdb5';

export default function Header() {
  const { address, isConnected } = useAccount();
  const { data: usdcBalance } = useBalance({
    address,
    token: ARC_USDC as `0x${string}`,
  });

  return (
    <header className="h-14 border-b border-border bg-surface-raised flex items-center justify-between px-6 shrink-0">
      {/* Left: Status */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-success rounded-full animate-pulse" />
          <span className="text-xs text-text-muted">Connected to Arc Testnet</span>
        </div>
        {isConnected && usdcBalance && (
          <div className="flex items-center gap-1.5 ml-4 px-3 py-1 rounded-md bg-surface-overlay">
            <span className="text-xs text-text-muted">Balance:</span>
            <span className="text-xs font-medium text-text-primary">
              {parseFloat(usdcBalance.formatted).toFixed(2)} USDC
            </span>
          </div>
        )}
      </div>

      {/* Right: Wallet */}
      <ConnectButton
        chainStatus="icon"
        showBalance={false}
        accountStatus="address"
      />
    </header>
  );
}