'use client';

import { useState, useEffect } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { Zap, Clock, TrendingDown, Loader2, Check, X } from 'lucide-react';

const ARC_USDC = '0x4c20Ca8BF703fe85447954Af3EF0E3eCf16dEdb5';
const INTENT_VAULT_ADDRESS = '0x992f46a9Da4458243a05A884D4bD68A851eA1942';

const INTENT_VAULT_ABI = [
  {
    name: 'setIntent',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'speed', type: 'uint8' },
      { name: 'minBatchAmount', type: 'uint256' },
      { name: 'maxWaitTimeSeconds', type: 'uint256' },
      { name: 'targetToken', type: 'address' },
    ],
    outputs: [],
  },
  {
    name: 'getIntent',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'merchant', type: 'address' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'speed', type: 'uint8' },
          { name: 'minBatchAmount', type: 'uint256' },
          { name: 'maxWaitTimeSeconds', type: 'uint256' },
          { name: 'targetToken', type: 'address' },
          { name: 'exists', type: 'bool' },
          { name: 'updatedAt', type: 'uint256' },
        ],
      },
    ],
  },
] as const;

const INTENTS = [
  {
    speed: 0 as const,
    icon: Zap,
    title: 'Immediate',
    description: 'Settle every payment instantly.',
    detail: 'Highest gas cost, fastest access to funds',
  },
  {
    speed: 1 as const,
    icon: Clock,
    title: 'Standard',
    description: 'Wait for batch partners to share gas costs.',
    detail: 'Best balance of speed and savings',
    recommended: true,
  },
  {
    speed: 2 as const,
    icon: TrendingDown,
    title: 'Deferred',
    description: 'Wait until balance hits a threshold.',
    detail: 'Maximum savings for high-volume merchants',
  },
];

export default function OnboardingModal() {
  const { address, isConnected } = useAccount();
  const [show, setShow] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [selectedSpeed, setSelectedSpeed] = useState<0 | 1 | 2>(0);
  const [minBatchAmount, setMinBatchAmount] = useState('100');
  const [maxWaitTime, setMaxWaitTime] = useState('3600');

  // Read current intent from chain
  const { data: intent, isLoading: isReading } = useReadContract({
    address: INTENT_VAULT_ADDRESS as `0x${string}`,
    abi: INTENT_VAULT_ABI,
    functionName: 'getIntent',
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
    },
  });

  // Write intent
  const { writeContract, data: txHash, isPending: isSigning, error: writeError } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });
  

  // Show modal if connected + no intent + not dismissed
  useEffect(() => {
    if (isConnected && !isReading && intent && !intent.exists && !dismissed) {
      setShow(true);
    } else {
      setShow(false);
    }
  }, [isConnected, isReading, intent, dismissed]);

  // Close on success
  useEffect(() => {
    if (isSuccess) {
      setTimeout(() => {
        setShow(false);
      }, 2000);
    }
  }, [isSuccess]);

  const handleSetIntent = () => {
    const minBatch = selectedSpeed === 2 
      ? BigInt(Math.round(parseFloat(minBatchAmount) * 1e6)) 
      : BigInt(0);
    const maxWait = selectedSpeed === 1 
      ? BigInt(maxWaitTime) 
      : BigInt(0);

    writeContract({
      address: INTENT_VAULT_ADDRESS as `0x${string}`,
      abi: INTENT_VAULT_ABI,
      functionName: 'setIntent',
      args: [selectedSpeed, minBatch, maxWait, ARC_USDC as `0x${string}`],
    });
  };

  const handleDismiss = () => {
    setDismissed(true);
    setShow(false);
  };

  if (!show) return null;

  const isProcessing = isSigning || isConfirming;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleDismiss} />

      {/* Modal */}
      <div className="relative w-full max-w-lg mx-4 card border border-border-light shadow-2xl">
        {/* Close button */}
        <button
          onClick={handleDismiss}
          className="absolute top-4 right-4 p-1 rounded-md text-text-muted hover:text-text-secondary hover:bg-surface-overlay transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Header */}
        <div className="px-6 pt-6 pb-4">
          <div className="w-10 h-10 bg-accent/10 rounded-xl flex items-center justify-center mb-4">
            <Zap className="w-5 h-5 text-accent" />
          </div>
          <h2 className="text-lg font-semibold text-text-primary">Welcome to StabL</h2>
          <p className="text-sm text-text-secondary mt-1">
            Choose how you'd like your payments settled. You can change this anytime in Settings.
          </p>
        </div>

        {/* Intent Options */}
        <div className="px-6 space-y-2">
          {INTENTS.map((intent) => {
            const Icon = intent.icon;
            const isSelected = selectedSpeed === intent.speed;

            return (
              <div key={intent.speed}>
                <button
                  onClick={() => setSelectedSpeed(intent.speed)}
                  disabled={isProcessing}
                  className={`w-full flex items-center gap-4 p-4 rounded-lg border transition-all text-left ${
                    isSelected
                      ? 'border-accent/40 bg-accent/5'
                      : 'border-border bg-surface hover:border-border-light'
                  } ${isProcessing ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                    isSelected ? 'bg-accent/10 text-accent' : 'bg-surface-overlay text-text-muted'
                  }`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-medium ${isSelected ? 'text-text-primary' : 'text-text-secondary'}`}>
                        {intent.title}
                      </span>
                      {intent.recommended && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-success-muted text-success">
                          Recommended
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-text-muted mt-0.5">{intent.description}</p>
                  </div>
                  <div className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${
                    isSelected ? 'border-accent' : 'border-border-light'
                  }`}>
                    {isSelected && <div className="w-2 h-2 rounded-full bg-accent" />}
                  </div>
                </button>

                {/* Standard: max wait time input */}
                {isSelected && intent.speed === 1 && (
                  <div className="ml-14 mr-4 mt-2 p-3 rounded-lg bg-surface border border-border">
                    <label className="text-xs text-text-muted block mb-1.5">
                      Max wait time (seconds)
                    </label>
                    <input
                      type="number"
                      value={maxWaitTime}
                      onChange={(e) => setMaxWaitTime(e.target.value)}
                      disabled={isProcessing}
                      className="w-full px-3 py-2 bg-surface-raised border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30"
                      placeholder="3600"
                    />
                    <div className="flex justify-between mt-1.5">
                      <p className="text-[10px] text-text-muted">How long to wait for batch partners</p>
                      <p className="text-[10px] text-text-secondary">
                        {parseInt(maxWaitTime) >= 3600
                          ? `${(parseInt(maxWaitTime) / 3600).toFixed(1)} hours`
                          : `${(parseInt(maxWaitTime) / 60).toFixed(0)} minutes`
                        }
                      </p>
                    </div>
                  </div>
                )}

                {/* Deferred: min batch amount input */}
                {isSelected && intent.speed === 2 && (
                  <div className="ml-14 mr-4 mt-2 p-3 rounded-lg bg-surface border border-border">
                    <label className="text-xs text-text-muted block mb-1.5">
                      Minimum batch amount (USDC)
                    </label>
                    <input
                      type="number"
                      value={minBatchAmount}
                      onChange={(e) => setMinBatchAmount(e.target.value)}
                      disabled={isProcessing}
                      className="w-full px-3 py-2 bg-surface-raised border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30"
                      placeholder="100"
                    />
                    <div className="flex justify-between mt-1.5">
                      <p className="text-[10px] text-text-muted">Settle when balance reaches this amount</p>
                      <p className="text-[10px] text-text-secondary">${minBatchAmount} USDC</p>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Action */}
        <div className="px-6 py-5">
          {isSuccess ? (
            <div className="py-2.5 rounded-lg bg-success-muted text-success text-sm text-center flex items-center justify-center gap-2">
              <Check className="w-4 h-4" />
              Intent set! You're ready to receive payments.
            </div>
          ) : (
            <>
              <button
                onClick={handleSetIntent}
                disabled={isProcessing}
                className={`w-full py-3 rounded-lg text-sm font-medium transition-colors ${
                  isProcessing
                    ? 'bg-accent/30 text-accent/50 cursor-not-allowed'
                    : 'bg-accent text-white hover:bg-accent-hover'
                }`}
              >
                {isSigning ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Confirm in wallet...
                  </span>
                ) : isConfirming ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Setting intent on-chain...
                  </span>
                ) : (
                  'Set Intent & Get Started'
                )}
              </button>

              {writeError && (
                <p className="text-xs text-danger text-center mt-2">
                  {writeError.message.includes('User rejected')
                    ? 'Transaction rejected'
                    : 'Failed — check console'}
                </p>
              )}

              <button
                onClick={handleDismiss}
                className="w-full mt-2 py-2 text-xs text-text-muted hover:text-text-secondary transition-colors"
              >
                Skip for now
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}