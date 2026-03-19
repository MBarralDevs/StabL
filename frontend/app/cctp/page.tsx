'use client';

import { useEffect, useState } from 'react';
import {
  Globe,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  Clock,
  ExternalLink,
  Shield,
  Zap,
  Link2,
} from 'lucide-react';
import EmptyState from '../../components/EmptyState';

// ─── Types ───────────────────────────────────────────────────────────────────

interface CCTPTransfer {
  id: string;
  nonce: string;
  sourceDomain: number;
  sourceChain: string;
  amount: string;
  depositor: string;
  status: string;
  sourceTxHash: string;
  mintTxHash: string | null;
  processTxHash: string | null;
  completedAt: string | null;
  createdAt: string;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';
const EXPLORER_URL = 'https://testnet.arcscan.app/tx';

// ─── Domain Mapping ──────────────────────────────────────────────────────────

const DOMAIN_NAMES: Record<number, string> = {
  0: 'Ethereum',
  1: 'Avalanche',
  2: 'OP Mainnet',
  3: 'Arbitrum',
  6: 'Base',
  7: 'Polygon',
  26: 'Arc',
};

const STATUS_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  DETECTED: { color: 'text-text-secondary', bg: 'bg-surface-overlay', label: 'Detected' },
  PENDING_ATTESTATION: { color: 'text-warning', bg: 'bg-warning-muted', label: 'Awaiting Attestation' },
  ATTESTED: { color: 'text-accent', bg: 'bg-accent-muted', label: 'Attested' },
  MINTING: { color: 'text-accent', bg: 'bg-accent-muted', label: 'Minting' },
  MINTED: { color: 'text-accent', bg: 'bg-accent-muted', label: 'Minted' },
  PROCESSING: { color: 'text-accent', bg: 'bg-accent-muted', label: 'Processing' },
  COMPLETED: { color: 'text-success', bg: 'bg-success-muted', label: 'Completed' },
  FAILED: { color: 'text-danger', bg: 'bg-danger-muted', label: 'Failed' },
};

// ─── Page ────────────────────────────────────────────────────────────────────

export default function CCTPPage() {
  const [transfers, setTransfers] = useState<CCTPTransfer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTransfers();
    const interval = setInterval(fetchTransfers, 10000);
    return () => clearInterval(interval);
  }, []);

  const fetchTransfers = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/cctp-transfers`);
      if (res.ok) {
        setTransfers(await res.json());
      }
      setLoading(false);
    } catch (error) {
      // API endpoint might not exist yet — that's OK
      setLoading(false);
    }
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-text-primary">Cross-Chain (CCTP V2)</h1>
        <p className="text-sm text-text-secondary mt-1">
          USDC transfers via Circle's Cross-Chain Transfer Protocol
        </p>
      </div>

      {/* How CCTP Works */}
      <div className="card p-6 mb-6">
        <h3 className="text-sm font-semibold text-text-primary mb-4">Transfer Flow</h3>
        <div className="flex items-center justify-between gap-2">
          <FlowStep icon={<Globe className="w-4 h-4" />} label="Source Chain" detail="Burn USDC" />
          <FlowArrow />
          <FlowStep icon={<Shield className="w-4 h-4" />} label="Attestation" detail="Circle Iris" />
          <FlowArrow />
          <FlowStep icon={<Zap className="w-4 h-4" />} label="Arc Mint" detail="receiveMessage" />
          <FlowArrow />
          <FlowStep icon={<Link2 className="w-4 h-4" />} label="CCTPReceiver" detail="→ PaymentPool" />
          <FlowArrow />
          <FlowStep icon={<CheckCircle2 className="w-4 h-4" />} label="Settlement" detail="V4 Hook" />
        </div>
      </div>

      {/* Supported Networks */}
      <div className="card p-6 mb-8">
        <h3 className="text-sm font-semibold text-text-primary mb-2">
          Accept payments from multiple chains
        </h3>
        <p className="text-xs text-text-muted mb-4">
          Customers can send USDC from any supported chain. Funds are automatically bridged to Arc and credited to your account.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <NetworkCard name="Ethereum" status="Active" icon="⟠" />
          <NetworkCard name="Base" status="Active" icon="🔵" />
          <NetworkCard name="Arbitrum" status="Coming soon" icon="🔷" />
          <NetworkCard name="OP Mainnet" status="Coming soon" icon="🔴" />
        </div>
      </div>

      {/* Transfers Table */}
      <div className="card overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text-primary">CCTP Transfers</h2>
          <span className="text-xs text-text-muted">
            {transfers.length} transfer{transfers.length !== 1 ? 's' : ''}
          </span>
        </div>

        {loading ? (
          <div className="px-6 py-16 text-center">
            <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <span className="text-sm text-text-muted">Loading...</span>
          </div>
        ) : transfers.length === 0 ? (
          <EmptyState
            icon={<Globe className="w-6 h-6 text-text-muted" />}
            title="No cross-chain transfers yet"
            description="CCTP transfers appear when users send USDC from Ethereum or Base to Arc via Circle's Cross-Chain Transfer Protocol. Configure source chain RPCs in your backend .env to start monitoring."
            action={{ label: 'View Settings', href: '/settings' }}
          />
        ) : (
          <>
            {/* Table Header */}
            <div className="grid grid-cols-12 gap-4 px-6 py-3 border-b border-border bg-surface-overlay/50 text-xs font-medium text-text-muted uppercase tracking-wider">
              <div className="col-span-1">Status</div>
              <div className="col-span-2">Source</div>
              <div className="col-span-2">Depositor</div>
              <div className="col-span-1">Amount</div>
              <div className="col-span-2">Source Tx</div>
              <div className="col-span-2">Mint Tx</div>
              <div className="col-span-2">Time</div>
            </div>

            <div className="divide-y divide-border">
              {transfers.map((transfer) => (
                <TransferRow key={transfer.id} transfer={transfer} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Components ──────────────────────────────────────────────────────────────

function FlowStep({ icon, label, detail }: { icon: React.ReactNode; label: string; detail: string }) {
  return (
    <div className="flex flex-col items-center text-center gap-2 flex-1">
      <div className="w-10 h-10 rounded-lg bg-surface-overlay border border-border flex items-center justify-center text-accent">
        {icon}
      </div>
      <div>
        <div className="text-xs font-medium text-text-primary">{label}</div>
        <div className="text-[10px] text-text-muted">{detail}</div>
      </div>
    </div>
  );
}

function FlowArrow() {
  return <ArrowRight className="w-4 h-4 text-text-muted shrink-0 mt-[-16px]" />;
}


function TransferRow({ transfer }: { transfer: CCTPTransfer }) {
  const config = STATUS_CONFIG[transfer.status] || STATUS_CONFIG.DETECTED;

  return (
    <>
      <div className="grid grid-cols-12 gap-4 px-6 py-4 items-center table-row-hover">
        <div className="col-span-1">
          <span className={`text-[10px] font-medium px-2 py-1 rounded ${config.bg} ${config.color}`}>
            {config.label}
          </span>
        </div>
        <div className="col-span-2">
          <span className="text-sm text-text-primary">
            {DOMAIN_NAMES[transfer.sourceDomain] || `Domain ${transfer.sourceDomain}`}
          </span>
          <div className="text-[10px] text-text-muted">→ Arc</div>
        </div>
        <div className="col-span-2">
          <span className="text-xs font-mono text-text-secondary">
            {transfer.depositor.slice(0, 6)}...{transfer.depositor.slice(-4)}
          </span>
        </div>
        <div className="col-span-1">
          <span className="text-sm font-medium text-text-primary">{transfer.amount}</span>
          <span className="text-xs text-text-muted ml-1">USDC</span>
        </div>
        <div className="col-span-2">
          <span className="text-xs font-mono text-text-secondary">
            {transfer.sourceTxHash.slice(0, 8)}...{transfer.sourceTxHash.slice(-6)}
          </span>
        </div>
        <div className="col-span-2">
          {transfer.mintTxHash ? (
            <a
              href={`${EXPLORER_URL}/${transfer.mintTxHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-mono text-success hover:underline flex items-center gap-1"
            >
              {transfer.mintTxHash?.slice(0, 8)}...{transfer.mintTxHash?.slice(-6)}
              <ExternalLink className="w-3 h-3" />
            </a>
          ) : (
            <span className="text-xs text-text-muted">—</span>
          )}
        </div>
        <div className="col-span-2">
          <span className="text-xs text-text-muted">
            {new Date(transfer.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          <div className="text-[10px] text-text-muted">
            {new Date(transfer.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
          </div>
        </div>
      </div>
    </>
  );
}

function NetworkCard({ name, status, icon }: { name: string; status: string; icon: string }) {
  const isActive = status === 'Active';
  return (
    <div className={`p-4 rounded-lg border text-center ${
      isActive
        ? 'border-accent/20 bg-accent/5'
        : 'border-border bg-surface'
    }`}>
      <div className="text-2xl mb-2">{icon}</div>
      <div className={`text-sm font-medium ${isActive ? 'text-text-primary' : 'text-text-muted'}`}>
        {name}
      </div>
      <div className={`text-[10px] mt-1 ${isActive ? 'text-accent' : 'text-text-muted'}`}>
        {status}
      </div>
    </div>
  );
}