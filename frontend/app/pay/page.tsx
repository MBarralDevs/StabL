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
  ArrowRight,
  CheckCircle2,
  Loader2,
  AlertCircle,
  User,
  Wallet,
  Shield,
  Zap,
  ExternalLink,
} from 'lucide-react';
import { parseUnits, encodePacked, keccak256, formatUnits } from 'viem';

// ─── Constants ───────────────────────────────────────────────────────────────

const ARC_USDC = '0x4c20Ca8BF703fe85447954Af3EF0E3eCf16dEdb5' as const;
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

// ─── Steps ───────────────────────────────────────────────────────────────────

type Step = 'details' | 'approve' | 'pay' | 'confirming' | 'success';

// ─── Page ────────────────────────────────────────────────────────────────────

export default function PayPage() {
  const { address, isConnected } = useAccount();
  const { data: usdcBalance } = useBalance({
    address,
    token: ARC_USDC,
  });

  // Form state
  const [merchantAddress, setMerchantAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [step, setStep] = useState<Step>('details');
  const [error, setError] = useState('');

  // Check existing allowance
  const amountWei = amount ? parseUnits(amount, 6) : BigInt(0);
  const { data: currentAllowance, refetch: refetchAllowance } = useReadContract({
    address: ARC_USDC,
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
    if (isPaymentConfirming) {
      setStep('confirming');
    }
  }, [isPaymentConfirming]);

  useEffect(() => {
    if (isPaymentSuccess) {
      setStep('success');
    }
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

    if (usdcBalance && amountNum > parseFloat(usdcBalance.formatted)) {
      setError('Insufficient USDC balance');
      return;
    }

    if (needsApproval) {
      setStep('approve');
    } else {
      setStep('pay');
    }
  };

  const handleApprove = () => {
    writeApprove({
      address: ARC_USDC,
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
      args: [merchantAddress as `0x${string}`, ARC_USDC, amountWei, paymentId],
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

  // ─── Render ────────────────────────────────────────────────────────────

  return (
    <div className="p-8 flex items-start justify-center">
      <div className="w-full max-w-md">
        {/* Widget Header */}
        <div className="text-center mb-6">
          <h1 className="text-2xl font-semibold text-text-primary">Send Payment</h1>
          <p className="text-sm text-text-secondary mt-1">
            Pay any merchant via StabL Gateway
          </p>
        </div>

        {/* Payment Widget */}
        <div className="card overflow-hidden">
          {/* Progress Steps */}
          <div className="px-6 py-4 border-b border-border bg-surface-overlay/30">
            <div className="flex items-center justify-between">
              <ProgressStep label="Details" number={1} active={step === 'details'} done={step !== 'details'} />
              <ProgressLine active={step !== 'details'} />
              <ProgressStep label="Approve" number={2} active={step === 'approve'} done={step === 'pay' || step === 'confirming' || step === 'success'} />
              <ProgressLine active={step === 'pay' || step === 'confirming' || step === 'success'} />
              <ProgressStep label="Pay" number={3} active={step === 'pay' || step === 'confirming'} done={step === 'success'} />
            </div>
          </div>

          {/* Step Content */}
          <div className="p-6">
            {/* ── Step: Details ─────────────────────────────────────────── */}
            {step === 'details' && (
              <div className="space-y-5">
                {/* Merchant Address */}
                <div>
                  <label className="text-xs font-medium text-text-secondary block mb-2">
                    Merchant Address
                  </label>
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

                {/* Amount */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-medium text-text-secondary">Amount</label>
                    {isConnected && usdcBalance && (
                      <button
                        onClick={() => setAmount(usdcBalance.formatted)}
                        className="text-[10px] text-accent hover:underline"
                      >
                        Max: {parseFloat(usdcBalance.formatted).toFixed(2)} USDC
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                    <input
                      type="number"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.00"
                      step="0.01"
                      className="w-full pl-10 pr-20 py-3 bg-surface border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30"
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 px-2 py-1 rounded bg-surface-overlay">
                      <div className="w-4 h-4 rounded-full bg-accent/20 flex items-center justify-center text-[8px] font-bold text-accent">$</div>
                      <span className="text-xs font-medium text-text-secondary">USDC</span>
                    </div>
                  </div>
                </div>

                {/* Summary */}
                {amount && parseFloat(amount) > 0 && merchantAddress.length === 42 && (
                  <div className="p-3 rounded-lg bg-surface-overlay border border-border space-y-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-text-muted">Network</span>
                      <span className="text-text-secondary">Arc Testnet</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-text-muted">Protocol</span>
                      <span className="text-text-secondary">StabL Gateway</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-text-muted">Settlement</span>
                      <span className="text-text-secondary">BatchSettler + V4 Hook</span>
                    </div>
                    <div className="flex justify-between text-xs pt-2 border-t border-border">
                      <span className="text-text-muted">You pay</span>
                      <span className="text-sm font-medium text-text-primary">{amount} USDC</span>
                    </div>
                  </div>
                )}

                {/* Error */}
                {error && (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-danger-muted text-danger text-xs">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    {error}
                  </div>
                )}

                {/* Action */}
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

            {/* ── Step: Approve ─────────────────────────────────────────── */}
            {step === 'approve' && (
              <div className="space-y-5">
                <div className="text-center">
                  <div className="w-12 h-12 rounded-full bg-accent-muted flex items-center justify-center mx-auto mb-3">
                    <Shield className="w-5 h-5 text-accent" />
                  </div>
                  <h3 className="text-sm font-semibold text-text-primary">Approve USDC</h3>
                  <p className="text-xs text-text-muted mt-1">
                    Allow StabL Gateway to transfer {amount} USDC
                  </p>
                </div>

                <div className="p-3 rounded-lg bg-surface-overlay border border-border space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-text-muted">Token</span>
                    <span className="text-text-secondary">USDC</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-text-muted">Spender</span>
                    <span className="text-text-secondary font-mono">PaymentPool</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-text-muted">Amount</span>
                    <span className="text-text-primary font-medium">{amount} USDC</span>
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
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Confirm in wallet...
                    </span>
                  ) : isApproveConfirming ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Approving...
                    </span>
                  ) : (
                    'Approve USDC'
                  )}
                </button>

                <button
                  onClick={() => { setStep('details'); resetApprove(); }}
                  className="w-full py-2 text-xs text-text-muted hover:text-text-secondary transition-colors"
                >
                  Back
                </button>
              </div>
            )}

            {/* ── Step: Pay ─────────────────────────────────────────────── */}
            {step === 'pay' && (
              <div className="space-y-5">
                <div className="text-center">
                  <div className="w-12 h-12 rounded-full bg-accent-muted flex items-center justify-center mx-auto mb-3">
                    <Zap className="w-5 h-5 text-accent" />
                  </div>
                  <h3 className="text-sm font-semibold text-text-primary">Confirm Payment</h3>
                  <p className="text-xs text-text-muted mt-1">
                    Send {amount} USDC to merchant
                  </p>
                </div>

                <div className="p-4 rounded-lg bg-surface-overlay border border-border space-y-3">
                  <div className="flex justify-between text-xs">
                    <span className="text-text-muted">To</span>
                    <span className="text-text-secondary font-mono">
                      {merchantAddress.slice(0, 6)}...{merchantAddress.slice(-4)}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-text-muted">Amount</span>
                    <span className="text-text-primary font-medium">{amount} USDC</span>
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
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Confirm in wallet...
                    </span>
                  ) : (
                    `Pay ${amount} USDC`
                  )}
                </button>

                <button
                  onClick={() => { setStep('details'); resetPayment(); }}
                  className="w-full py-2 text-xs text-text-muted hover:text-text-secondary transition-colors"
                >
                  Back
                </button>
              </div>
            )}

            {/* ── Step: Confirming ──────────────────────────────────────── */}
            {step === 'confirming' && (
              <div className="py-8 text-center space-y-4">
                <div className="w-16 h-16 rounded-full bg-accent-muted flex items-center justify-center mx-auto">
                  <Loader2 className="w-7 h-7 text-accent animate-spin" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-text-primary">Processing Payment</h3>
                  <p className="text-xs text-text-muted mt-1">
                    Waiting for on-chain confirmation...
                  </p>
                </div>
                {paymentTxHash && (
                  <a
                    href={`${EXPLORER_URL}/${paymentTxHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                  >
                    View on explorer
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            )}

            {/* ── Step: Success ─────────────────────────────────────────── */}
            {step === 'success' && (
              <div className="py-8 text-center space-y-4">
                <div className="w-16 h-16 rounded-full bg-success-muted flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-7 h-7 text-success" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-text-primary">Payment Sent!</h3>
                  <p className="text-xs text-text-muted mt-1">
                    {amount} USDC sent to {merchantAddress.slice(0, 6)}...{merchantAddress.slice(-4)}
                  </p>
                </div>

                <div className="p-3 rounded-lg bg-surface-overlay border border-border space-y-2 text-left">
                  <div className="flex justify-between text-xs">
                    <span className="text-text-muted">Amount</span>
                    <span className="text-success font-medium">{amount} USDC</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-text-muted">Status</span>
                    <span className="text-success">Confirmed</span>
                  </div>
                  {paymentTxHash && (
                    <div className="flex justify-between text-xs">
                      <span className="text-text-muted">Transaction</span>
                      <a
                        href={`${EXPLORER_URL}/${paymentTxHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent hover:underline flex items-center gap-1"
                      >
                        {paymentTxHash.slice(0, 8)}...{paymentTxHash.slice(-6)}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  )}
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    onClick={handleReset}
                    className="flex-1 py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors"
                  >
                    Send Another
                  </button>
                  <a
                    href="/payments"
                    className="flex-1 py-2.5 rounded-lg border border-border text-sm font-medium text-text-secondary hover:bg-surface-overlay transition-colors text-center"
                  >
                    View Payments
                  </a>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-3 border-t border-border bg-surface-overlay/30 flex items-center justify-center gap-1.5">
            <Shield className="w-3 h-3 text-text-muted" />
            <span className="text-[10px] text-text-muted">
              Secured by StabL Gateway on Arc Testnet
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Progress Components ─────────────────────────────────────────────────────

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
  return (
    <div className={`flex-1 h-px mx-2 ${active ? 'bg-success' : 'bg-border'}`} />
  );
}