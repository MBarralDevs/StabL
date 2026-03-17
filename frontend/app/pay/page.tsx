'use client';

import { useState, useEffect } from 'react';
import {
  useAccount,
  useBalance,
  useWriteContract,
  useWaitForTransactionReceipt,
  useReadContract,
} from 'wagmi';
import {
  DollarSign,
  CheckCircle2,
  Loader2,
  AlertCircle,
  User,
  Wallet,
  Shield,
  Zap,
  ExternalLink,
  ChevronDown,
  Plus,
  Minus,
} from 'lucide-react';
import { parseUnits, encodePacked, keccak256 } from 'viem';

// ─── Constants ───────────────────────────────────────────────────────────────

const TOKENS = [
  {
    symbol: 'USDC',
    name: 'USD Coin',
    address: '0x4c20Ca8BF703fe85447954Af3EF0E3eCf16dEdb5' as const,
    decimals: 6,
  },
  {
    symbol: 'EURC',
    name: 'Euro Coin',
    address: '0x89B5c243b6ebF1a2f615bD8a75B7C1F44c4063A2' as const,
    decimals: 6,
  },
];

const PAYMENT_POOL = '0xf929d461B266a671A4AE6dC731cB7107b57946B2' as const;
const EXPLORER_URL = 'https://testnet.arcscan.app/tx';

const ERC20_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
] as const;

const PAYMENT_POOL_ABI = [
  {
    name: 'receivePayment',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'merchant', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'paymentId', type: 'bytes32' },
    ],
    outputs: [],
  },
] as const;

type Step = 'details' | 'approve' | 'pay' | 'confirming' | 'success';

// ─── Page ────────────────────────────────────────────────────────────────────

export default function PayPage() {
  const { address, isConnected } = useAccount();

  // Form state
  const [merchantAddress, setMerchantAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [selectedToken, setSelectedToken] = useState(TOKENS[0]);
  const [showTokenSelect, setShowTokenSelect] = useState(false);
  const [step, setStep] = useState<Step>('details');
  const [error, setError] = useState('');

  // Balance for selected token
  const { data: tokenBalance } = useBalance({
    address,
    token: selectedToken.address,
  });

  // Check existing allowance
  const amountWei = amount ? parseUnits(amount, selectedToken.decimals) : BigInt(0);
  const { data: currentAllowance, refetch: refetchAllowance } = useReadContract({
    address: selectedToken.address,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address ? [address, PAYMENT_POOL] : undefined,
    query: { enabled: !!address },
  });

  const needsApproval = currentAllowance !== undefined && amountWei > BigInt(0) && currentAllowance < amountWei;

  // Approve transaction
  const {
    writeContract: writeApprove,
    data: approveTxHash,
    isPending: isApproveSigning,
    error: approveError,
    reset: resetApprove,
  } = useWriteContract();

  const { isLoading: isApproveConfirming, isSuccess: isApproveSuccess } = useWaitForTransactionReceipt({
    hash: approveTxHash,
  });

  // Payment transaction
  const {
    writeContract: writePayment,
    data: paymentTxHash,
    isPending: isPaymentSigning,
    error: paymentError,
    reset: resetPayment,
  } = useWriteContract();

  const { isLoading: isPaymentConfirming, isSuccess: isPaymentSuccess } = useWaitForTransactionReceipt({
    hash: paymentTxHash,
  });

  // Auto-advance steps
  useEffect(() => {
    if (isApproveSuccess) {
      refetchAllowance();
      setStep('pay');
    }
  }, [isApproveSuccess]);

  useEffect(() => {
    if (isPaymentConfirming) setStep('confirming');
  }, [isPaymentConfirming]);

  useEffect(() => {
    if (isPaymentSuccess) setStep('success');
  }, [isPaymentSuccess]);

  // ─── Handlers ──────────────────────────────────────────────────────────

  const validateAndProceed = () => {
    setError('');
    if (!merchantAddress || !merchantAddress.startsWith('0x') || merchantAddress.length !== 42) {
      setError('Enter a valid merchant address');
      return;
    }
    const amountNum = parseFloat(amount);
    if (!amount || isNaN(amountNum) || amountNum <= 0) {
      setError('Enter a valid amount');
      return;
    }
    if (tokenBalance && amountNum > parseFloat(tokenBalance.formatted)) {
      setError(`Insufficient ${selectedToken.symbol} balance`);
      return;
    }
    setStep(needsApproval ? 'approve' : 'pay');
  };

  const handleApprove = () => {
    writeApprove({
      address: selectedToken.address,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [PAYMENT_POOL, amountWei],
    });
  };

  const handlePay = () => {
    const paymentId = keccak256(
      encodePacked(
        ['uint256', 'address', 'address', 'uint256'],
        [BigInt(Date.now()), address!, merchantAddress as `0x${string}`, amountWei]
      )
    );
    writePayment({
      address: PAYMENT_POOL,
      abi: PAYMENT_POOL_ABI,
      functionName: 'receivePayment',
      args: [merchantAddress as `0x${string}`, selectedToken.address, amountWei, paymentId],
    });
  };

  const handleReset = () => {
    setStep('details');
    setMerchantAddress('');
    setAmount('');
    setError('');
    resetApprove();
    resetPayment();
  };

  const adjustAmount = (delta: number) => {
    const current = parseFloat(amount) || 0;
    const newAmount = Math.max(0, current + delta);
    setAmount(newAmount.toString());
  };

  const isProcessing = isApproveSigning || isApproveConfirming || isPaymentSigning || isPaymentConfirming;

  return (
    <div className="p-8 flex justify-center">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold text-text-primary">Send Payment</h1>
          <p className="text-sm text-text-secondary mt-1">
            Pay any merchant via StabL Gateway
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Payment Widget — 3 cols */}
          <div className="lg:col-span-3 card overflow-hidden">
            {/* Progress */}
            <div className="px-6 py-4 border-b border-border bg-surface-overlay/30">
              <div className="flex items-center justify-between">
                <ProgressStep label="Details" number={1} active={step === 'details'} done={step !== 'details'} />
                <ProgressLine active={step !== 'details'} />
                <ProgressStep label="Approve" number={2} active={step === 'approve'} done={step === 'pay' || step === 'confirming' || step === 'success'} />
                <ProgressLine active={step === 'pay' || step === 'confirming' || step === 'success'} />
                <ProgressStep label="Pay" number={3} active={step === 'pay' || step === 'confirming'} done={step === 'success'} />
              </div>
            </div>

            <div className="p-6">
              {/* ── Details ──────────────────────────────────────────────── */}
              {step === 'details' && (
                <div className="space-y-5">
                  {/* Merchant */}
                  <div>
                    <label className="text-xs font-medium text-text-secondary block mb-2">Merchant Address</label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                      <input
                        type="text"
                        value={merchantAddress}
                        onChange={(e) => setMerchantAddress(e.target.value)}
                        placeholder="0x..."
                        className="w-full pl-10 pr-4 py-3 bg-surface border border-border rounded-lg text-sm text-text-primary font-mono placeholder:text-text-muted focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30"
                      />
                    </div>
                  </div>

                  {/* Amount + Token */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-medium text-text-secondary">Amount</label>
                      {isConnected && tokenBalance && (
                        <button
                          onClick={() => setAmount(tokenBalance.formatted)}
                          className="text-[10px] text-accent hover:underline"
                        >
                          Max: {parseFloat(tokenBalance.formatted).toFixed(2)} {selectedToken.symbol}
                        </button>
                      )}
                    </div>
                    <div className="flex gap-2">
                      {/* Amount input with +/- buttons */}
                      <div className="flex-1 flex items-center bg-surface border border-border rounded-lg overflow-hidden focus-within:border-accent focus-within:ring-1 focus-within:ring-accent/30">
                        <button
                          onClick={() => adjustAmount(-1)}
                          className="px-3 py-3 text-text-muted hover:text-text-secondary hover:bg-surface-overlay transition-colors"
                        >
                          <Minus className="w-4 h-4" />
                        </button>
                        <div className="relative flex-1">
                          <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                          <input
                            type="number"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            placeholder="0.00"
                            step="0.01"
                            className="w-full pl-7 pr-2 py-3 bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
                          />
                        </div>
                        <button
                          onClick={() => adjustAmount(1)}
                          className="px-3 py-3 text-text-muted hover:text-text-secondary hover:bg-surface-overlay transition-colors"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>

                      {/* Token selector */}
                      <div className="relative">
                        <button
                          onClick={() => setShowTokenSelect(!showTokenSelect)}
                          className="flex items-center gap-2 px-4 py-3 bg-surface border border-border rounded-lg hover:border-border-light transition-colors"
                        >
                          <div className="w-5 h-5 rounded-full bg-accent/20 flex items-center justify-center text-[9px] font-bold text-accent">$</div>
                          <span className="text-sm font-medium text-text-primary">{selectedToken.symbol}</span>
                          <ChevronDown className="w-3 h-3 text-text-muted" />
                        </button>

                        {showTokenSelect && (
                          <div className="absolute right-0 top-full mt-1 w-48 card border border-border-light shadow-xl z-10 py-1">
                            {TOKENS.map((token) => (
                              <button
                                key={token.symbol}
                                onClick={() => {
                                  setSelectedToken(token);
                                  setShowTokenSelect(false);
                                }}
                                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-overlay transition-colors ${
                                  selectedToken.symbol === token.symbol ? 'bg-accent/5' : ''
                                }`}
                              >
                                <div className="w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center text-[9px] font-bold text-accent">$</div>
                                <div>
                                  <div className="text-sm font-medium text-text-primary">{token.symbol}</div>
                                  <div className="text-[10px] text-text-muted">{token.name}</div>
                                </div>
                                {selectedToken.symbol === token.symbol && (
                                  <CheckCircle2 className="w-3.5 h-3.5 text-accent ml-auto" />
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    {/* Quick amounts */}
                    <div className="flex gap-2 mt-2">
                      {[5, 10, 50, 100].map((preset) => (
                        <button
                          key={preset}
                          onClick={() => setAmount(preset.toString())}
                          className="flex-1 py-1.5 rounded-md border border-border text-xs text-text-secondary hover:bg-surface-overlay hover:border-border-light transition-colors"
                        >
                          ${preset}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Summary */}
                  {amount && parseFloat(amount) > 0 && merchantAddress.length === 42 && (
                    <div className="p-4 rounded-lg bg-surface-overlay border border-border space-y-2">
                      <div className="flex justify-between text-xs">
                        <span className="text-text-muted">Network</span>
                        <span className="text-text-secondary">Arc Testnet</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-text-muted">Protocol</span>
                        <span className="text-text-secondary">StabL Gateway</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-text-muted">Token</span>
                        <span className="text-text-secondary">{selectedToken.symbol} ({selectedToken.name})</span>
                      </div>
                      <div className="flex justify-between text-xs pt-2 border-t border-border">
                        <span className="text-text-muted">You pay</span>
                        <span className="text-sm font-semibold text-text-primary">{amount} {selectedToken.symbol}</span>
                      </div>
                    </div>
                  )}

                  {error && (
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-danger-muted text-danger text-xs">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      {error}
                    </div>
                  )}

                  {!isConnected ? (
                    <div className="p-4 rounded-lg bg-surface-overlay text-center">
                      <Wallet className="w-5 h-5 text-text-muted mx-auto mb-2" />
                      <p className="text-sm text-text-secondary">Connect your wallet to pay</p>
                    </div>
                  ) : (
                    <button
                      onClick={validateAndProceed}
                      className="w-full py-3.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors"
                    >
                      Continue
                    </button>
                  )}
                </div>
              )}

              {/* ── Approve ─────────────────────────────────────────────── */}
              {step === 'approve' && (
                <div className="space-y-5">
                  <div className="text-center">
                    <div className="w-12 h-12 rounded-full bg-accent-muted flex items-center justify-center mx-auto mb-3">
                      <Shield className="w-5 h-5 text-accent" />
                    </div>
                    <h3 className="text-sm font-semibold text-text-primary">Approve {selectedToken.symbol}</h3>
                    <p className="text-xs text-text-muted mt-1">
                      Allow StabL Gateway to transfer {amount} {selectedToken.symbol}
                    </p>
                  </div>

                  <div className="p-4 rounded-lg bg-surface-overlay border border-border space-y-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-text-muted">Token</span>
                      <span className="text-text-secondary">{selectedToken.symbol}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-text-muted">Spender</span>
                      <span className="text-text-secondary font-mono">PaymentPool</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-text-muted">Amount</span>
                      <span className="text-text-primary font-medium">{amount} {selectedToken.symbol}</span>
                    </div>
                  </div>

                  {approveError && (
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-danger-muted text-danger text-xs">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      {approveError.message.includes('User rejected') ? 'Transaction rejected' : 'Approval failed'}
                    </div>
                  )}

                  <button
                    onClick={handleApprove}
                    disabled={isApproveSigning || isApproveConfirming}
                    className={`w-full py-3.5 rounded-lg text-sm font-medium transition-colors ${
                      isApproveSigning || isApproveConfirming
                        ? 'bg-accent/30 text-accent/50 cursor-not-allowed'
                        : 'bg-accent text-white hover:bg-accent-hover'
                    }`}
                  >
                    {isApproveSigning ? (
                      <span className="flex items-center justify-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" /> Confirm in wallet...
                      </span>
                    ) : isApproveConfirming ? (
                      <span className="flex items-center justify-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" /> Approving...
                      </span>
                    ) : (
                      `Approve ${selectedToken.symbol}`
                    )}
                  </button>
                  <button onClick={() => { setStep('details'); resetApprove(); }} className="w-full py-2 text-xs text-text-muted hover:text-text-secondary">Back</button>
                </div>
              )}

              {/* ── Pay ─────────────────────────────────────────────────── */}
              {step === 'pay' && (
                <div className="space-y-5">
                  <div className="text-center">
                    <div className="w-12 h-12 rounded-full bg-accent-muted flex items-center justify-center mx-auto mb-3">
                      <Zap className="w-5 h-5 text-accent" />
                    </div>
                    <h3 className="text-sm font-semibold text-text-primary">Confirm Payment</h3>
                    <p className="text-xs text-text-muted mt-1">Send {amount} {selectedToken.symbol} to merchant</p>
                  </div>

                  <div className="p-4 rounded-lg bg-surface-overlay border border-border space-y-3">
                    <div className="flex justify-between text-xs">
                      <span className="text-text-muted">To</span>
                      <span className="text-text-secondary font-mono">{merchantAddress.slice(0, 6)}...{merchantAddress.slice(-4)}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-text-muted">Amount</span>
                      <span className="text-text-primary font-medium">{amount} {selectedToken.symbol}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-text-muted">Via</span>
                      <span className="text-text-secondary">PaymentPool → BatchSettler</span>
                    </div>
                  </div>

                  {paymentError && (
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-danger-muted text-danger text-xs">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      {paymentError.message.includes('User rejected') ? 'Transaction rejected' : 'Payment failed'}
                    </div>
                  )}

                  <button
                    onClick={handlePay}
                    disabled={isPaymentSigning}
                    className={`w-full py-3.5 rounded-lg text-sm font-medium transition-colors ${
                      isPaymentSigning
                        ? 'bg-accent/30 text-accent/50 cursor-not-allowed'
                        : 'bg-accent text-white hover:bg-accent-hover'
                    }`}
                  >
                    {isPaymentSigning ? (
                      <span className="flex items-center justify-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" /> Confirm in wallet...
                      </span>
                    ) : (
                      `Pay ${amount} ${selectedToken.symbol}`
                    )}
                  </button>
                  <button onClick={() => { setStep('details'); resetPayment(); }} className="w-full py-2 text-xs text-text-muted hover:text-text-secondary">Back</button>
                </div>
              )}

              {/* ── Confirming ──────────────────────────────────────────── */}
              {step === 'confirming' && (
                <div className="py-8 text-center space-y-4">
                  <div className="w-16 h-16 rounded-full bg-accent-muted flex items-center justify-center mx-auto">
                    <Loader2 className="w-7 h-7 text-accent animate-spin" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-text-primary">Processing Payment</h3>
                    <p className="text-xs text-text-muted mt-1">Waiting for on-chain confirmation...</p>
                  </div>
                  {paymentTxHash && (
                    <a href={`${EXPLORER_URL}/${paymentTxHash}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
                      View on explorer <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              )}

              {/* ── Success ─────────────────────────────────────────────── */}
              {step === 'success' && (
                <div className="py-8 text-center space-y-4">
                  <div className="w-16 h-16 rounded-full bg-success-muted flex items-center justify-center mx-auto">
                    <CheckCircle2 className="w-7 h-7 text-success" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-text-primary">Payment Sent!</h3>
                    <p className="text-xs text-text-muted mt-1">{amount} {selectedToken.symbol} sent to {merchantAddress.slice(0, 6)}...{merchantAddress.slice(-4)}</p>
                  </div>

                  <div className="p-4 rounded-lg bg-surface-overlay border border-border space-y-2 text-left">
                    <div className="flex justify-between text-xs">
                      <span className="text-text-muted">Amount</span>
                      <span className="text-success font-medium">{amount} {selectedToken.symbol}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-text-muted">Status</span>
                      <span className="text-success">Confirmed</span>
                    </div>
                    {paymentTxHash && (
                      <div className="flex justify-between text-xs">
                        <span className="text-text-muted">Transaction</span>
                        <a href={`${EXPLORER_URL}/${paymentTxHash}`} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline flex items-center gap-1">
                          {paymentTxHash.slice(0, 8)}...{paymentTxHash.slice(-6)}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-3 pt-2">
                    <button onClick={handleReset} className="flex-1 py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors">
                      Send Another
                    </button>
                    <a href="/payments" className="flex-1 py-2.5 rounded-lg border border-border text-sm font-medium text-text-secondary hover:bg-surface-overlay transition-colors text-center">
                      View Payments
                    </a>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-3 border-t border-border bg-surface-overlay/30 flex items-center justify-center gap-1.5">
              <Shield className="w-3 h-3 text-text-muted" />
              <span className="text-[10px] text-text-muted">Secured by StabL Gateway on Arc Testnet</span>
            </div>
          </div>

          {/* Right Column — Info — 2 cols */}
          <div className="lg:col-span-2 space-y-4">
            <div className="card p-5">
              <h3 className="text-sm font-semibold text-text-primary mb-3">How it works</h3>
              <div className="space-y-3">
                <InfoStep number={1} title="Enter details" description="Merchant address and payment amount" />
                <InfoStep number={2} title="Approve token" description="Allow PaymentPool to transfer your tokens" />
                <InfoStep number={3} title="Send payment" description="Tokens are deposited into PaymentPool" />
                <InfoStep number={4} title="Auto-settlement" description="BatchSettler settles based on merchant intent" />
              </div>
            </div>

            <div className="card p-5">
              <h3 className="text-sm font-semibold text-text-primary mb-3">Settlement Info</h3>
              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-text-muted">Contract</span>
                  <span className="text-text-secondary font-mono">PaymentPool</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-text-muted">Settlement</span>
                  <span className="text-text-secondary">BatchSettler + V4 Hook</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-text-muted">Cross-token</span>
                  <span className="text-text-secondary">Uniswap V4 atomic swap</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-text-muted">Cross-chain</span>
                  <span className="text-text-secondary">CCTP V2</span>
                </div>
              </div>
            </div>

            <div className="card p-5">
              <h3 className="text-sm font-semibold text-text-primary mb-3">Supported Tokens</h3>
              <div className="space-y-2">
                {TOKENS.map((token) => (
                  <div key={token.symbol} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center text-[9px] font-bold text-accent">$</div>
                      <span className="text-sm text-text-primary">{token.symbol}</span>
                    </div>
                    <span className="text-xs font-mono text-text-muted">
                      {token.address.slice(0, 6)}...{token.address.slice(-4)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function ProgressStep({ label, number, active, done }: {
  label: string;
  number: number;
  active: boolean;
  done: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
        done
          ? 'bg-success text-white'
          : active
            ? 'bg-accent text-white'
            : 'bg-surface-overlay text-text-muted'
      }`}>
        {done ? <CheckCircle2 className="w-3.5 h-3.5" /> : number}
      </div>
      <span className={`text-xs font-medium ${
        active ? 'text-text-primary' : done ? 'text-success' : 'text-text-muted'
      }`}>
        {label}
      </span>
    </div>
  );
}

function ProgressLine({ active }: { active: boolean }) {
  return <div className={`flex-1 h-px mx-2 ${active ? 'bg-success' : 'bg-border'}`} />;
}

function InfoStep({ number, title, description }: { number: number; title: string; description: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-6 h-6 rounded-full bg-surface-overlay flex items-center justify-center text-[10px] font-bold text-text-muted shrink-0 mt-0.5">
        {number}
      </div>
      <div>
        <div className="text-xs font-medium text-text-primary">{title}</div>
        <div className="text-[10px] text-text-muted">{description}</div>
      </div>
    </div>
  );
}