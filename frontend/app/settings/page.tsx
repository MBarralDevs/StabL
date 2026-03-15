'use client';

import { useEffect, useState } from 'react';
import {
  Settings,
  Wallet,
  Shield,
  ExternalLink,
  Copy,
  Check,
  Zap,
  Clock,
  TrendingDown,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ContractStatus {
  paymentPool: {
    address: string;
    paused: boolean;
  };
  batchSettler: {
    address: string;
    paused: boolean;
    maxBatchSize: number;
    feeBasisPoints: number;
    feePercentage: string;
    feeRecipient: string;
  };
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';
const EXPLORER_URL = 'https://testnet.arcscan.app/address';

// ─── Contracts ───────────────────────────────────────────────────────────────

const CONTRACTS = [
  {
    name: 'PaymentPool',
    address: '0xf929d461B266a671A4AE6dC731cB7107b57946B2',
    description: 'Receives payments, tracks merchant balances',
  },
  {
    name: 'IntentVault',
    address: '0x992f46a9Da4458243a05A884D4bD68A851eA1942',
    description: 'Stores merchant settlement preferences on-chain',
  },
  {
    name: 'BatchSettler',
    address: '0x63626B6668BABc18c35e55a1982Ff8aD2C816DA9',
    description: 'Executes batch settlements with V4 Hook routing',
  },
  {
    name: 'CCTPReceiver',
    address: '0x3ea746C6aC0E3D7E38d83d43bF979451DAbFd490',
    description: 'Receives cross-chain USDC via CCTP V2',
  },
];

// ─── Page ────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [contractStatus, setContractStatus] = useState<ContractStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchContractStatus();
  }, []);

  const fetchContractStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/contract-status`);
      if (res.ok) {
        setContractStatus(await res.json());
      }
      setLoading(false);
    } catch (error) {
      console.error('Failed to fetch contract status:', error);
      setLoading(false);
    }
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-text-primary">Settings</h1>
        <p className="text-sm text-text-secondary mt-1">
          Contract configuration and merchant preferences
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column */}
        <div className="space-y-6">
          {/* Intent Configuration */}
          <div className="card">
            <div className="px-6 py-4 border-b border-border">
              <h2 className="text-sm font-semibold text-text-primary">Settlement Intent</h2>
              <p className="text-xs text-text-muted mt-1">
                Configure how your payments are settled
              </p>
            </div>
            <div className="p-6 space-y-4">
              <IntentOption
                icon={<Zap className="w-4 h-4" />}
                title="Immediate"
                description="Settle every payment instantly. Higher gas cost, fastest settlement."
                active={true}
                tag="Current"
              />
              <IntentOption
                icon={<Clock className="w-4 h-4" />}
                title="Standard"
                description="Wait up to N seconds for batch partners. Balanced speed and cost."
                active={false}
              />
              <IntentOption
                icon={<TrendingDown className="w-4 h-4" />}
                title="Deferred"
                description="Wait until balance reaches a threshold. Maximum gas savings."
                active={false}
              />
              <p className="text-[10px] text-text-muted pt-2 border-t border-border">
                Intent is stored on-chain in IntentVault. Change it by calling
                <code className="mx-1 px-1.5 py-0.5 bg-surface-overlay rounded text-accent">setIntent()</code>
                from your merchant wallet.
              </p>
            </div>
          </div>

          {/* Network Info */}
          <div className="card p-6">
            <h3 className="text-sm font-semibold text-text-primary mb-4">Network</h3>
            <div className="space-y-3">
              <InfoRow label="Chain" value="Arc Testnet" />
              <InfoRow label="Chain ID" value="5042002" />
              <InfoRow label="RPC" value="rpc.testnet.arc.network" />
              <InfoRow label="Explorer" value="testnet.arcscan.app" link="https://testnet.arcscan.app" />
              <InfoRow label="Gas Token" value="USDC" />
            </div>
          </div>
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          {/* Contract Status */}
          <div className="card">
            <div className="px-6 py-4 border-b border-border">
              <h2 className="text-sm font-semibold text-text-primary">Deployed Contracts</h2>
              <p className="text-xs text-text-muted mt-1">
                All contracts verified on Arc Testnet
              </p>
            </div>
            <div className="divide-y divide-border">
              {CONTRACTS.map((contract) => (
                <ContractRow key={contract.name} contract={contract} />
              ))}
            </div>
          </div>

          {/* BatchSettler Config */}
          <div className="card p-6">
            <h3 className="text-sm font-semibold text-text-primary mb-4">BatchSettler Configuration</h3>
            {loading ? (
              <div className="text-center py-4">
                <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto" />
              </div>
            ) : contractStatus ? (
              <div className="space-y-3">
                <InfoRow
                  label="Status"
                  value={contractStatus.batchSettler.paused ? 'Paused' : 'Active'}
                  valueColor={contractStatus.batchSettler.paused ? 'text-danger' : 'text-success'}
                />
                <InfoRow
                  label="Max Batch Size"
                  value={contractStatus.batchSettler.maxBatchSize.toString()}
                />
                <InfoRow
                  label="Fee"
                  value={contractStatus.batchSettler.feeBasisPoints === 0
                    ? 'Disabled'
                    : contractStatus.batchSettler.feePercentage
                  }
                />
                <InfoRow
                  label="Fee Recipient"
                  value={contractStatus.batchSettler.feeRecipient === '0x0000000000000000000000000000000000000000'
                    ? 'Not set'
                    : `${contractStatus.batchSettler.feeRecipient.slice(0, 6)}...${contractStatus.batchSettler.feeRecipient.slice(-4)}`
                  }
                />
              </div>
            ) : (
              <p className="text-xs text-text-muted">Failed to load contract status</p>
            )}
          </div>

          {/* Tokens */}
          <div className="card p-6">
            <h3 className="text-sm font-semibold text-text-primary mb-4">Supported Tokens</h3>
            <div className="space-y-3">
              <TokenRow
                name="USDC"
                address="0x4c20Ca8BF703fe85447954Af3EF0E3eCf16dEdb5"
                decimals={6}
                primary
              />
              <TokenRow
                name="EURC"
                address="0x89B5c243b6ebF1a2f615bD8a75B7C1F44c4063A2"
                decimals={6}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Components ──────────────────────────────────────────────────────────────

function IntentOption({ icon, title, description, active, tag }: {
  icon: React.ReactNode;
  title: string;
  description: string;
  active: boolean;
  tag?: string;
}) {
  return (
    <div className={`flex items-start gap-4 p-4 rounded-lg border transition-colors ${
      active
        ? 'border-accent/30 bg-accent/5'
        : 'border-border bg-surface hover:border-border-light'
    }`}>
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
        active ? 'bg-accent/10 text-accent' : 'bg-surface-overlay text-text-muted'
      }`}>
        {icon}
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-medium ${active ? 'text-text-primary' : 'text-text-secondary'}`}>
            {title}
          </span>
          {tag && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-accent/10 text-accent">
              {tag}
            </span>
          )}
        </div>
        <p className="text-xs text-text-muted mt-0.5">{description}</p>
      </div>
    </div>
  );
}

function ContractRow({ contract }: { contract: { name: string; address: string; description: string } }) {
  const [copied, setCopied] = useState(false);

  const copyAddress = () => {
    navigator.clipboard.writeText(contract.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="px-6 py-4">
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium text-text-primary">{contract.name}</span>
        <div className="flex items-center gap-1">
          <button
            onClick={copyAddress}
            className="p-1 rounded hover:bg-surface-overlay text-text-muted hover:text-text-secondary transition-colors"
            title="Copy address"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          <a
            href={`${EXPLORER_URL}/${contract.address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1 rounded hover:bg-surface-overlay text-text-muted hover:text-text-secondary transition-colors"
            title="View on explorer"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
      <div className="text-xs font-mono text-text-muted">{contract.address}</div>
      <div className="text-xs text-text-muted mt-1">{contract.description}</div>
    </div>
  );
}

function InfoRow({ label, value, link, valueColor }: {
  label: string;
  value: string;
  link?: string;
  valueColor?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-text-muted">{label}</span>
      {link ? (
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-accent hover:underline flex items-center gap-1"
        >
          {value}
          <ExternalLink className="w-3 h-3" />
        </a>
      ) : (
        <span className={`text-xs font-medium ${valueColor || 'text-text-secondary'}`}>
          {value}
        </span>
      )}
    </div>
  );
}

function TokenRow({ name, address, decimals, primary }: {
  name: string;
  address: string;
  decimals: number;
  primary?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
          primary ? 'bg-accent/10 text-accent' : 'bg-surface-overlay text-text-secondary'
        }`}>
          $
        </div>
        <div>
          <span className="text-sm font-medium text-text-primary">{name}</span>
          {primary && (
            <span className="text-[10px] text-accent ml-1.5">Primary</span>
          )}
        </div>
      </div>
      <span className="text-xs font-mono text-text-muted">
        {address.slice(0, 6)}...{address.slice(-4)}
      </span>
    </div>
  );
}