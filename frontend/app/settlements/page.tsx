'use client';

import { useEffect, useState } from 'react';
import {
  Layers,
  ExternalLink,
  TrendingDown,
  DollarSign,
  Zap,
  Package,
  Clock,
} from 'lucide-react';
import EmptyState from '../../components/EmptyState';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Settlement {
  id: string;
  merchant: string;
  token: string;
  grossAmount: string;
  netAmount: string;
  fee: string;
  batchId: string | null;
  txHash: string | null;
  settledAt: string | null;
}

interface Stats {
  totalPayments: number;
  settledPayments: number;
  totalVolume: string;
  totalFees: string;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';
const EXPLORER_URL = 'https://testnet.arcscan.app/tx';

// ─── Page ────────────────────────────────────────────────────────────────────

export default function SettlementsPage() {
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [stats, setStats] = useState<Stats>({
    totalPayments: 0,
    settledPayments: 0,
    totalVolume: '0',
    totalFees: '0',
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, []);

  const fetchData = async () => {
    try {
      const [settlementsRes, statsRes] = await Promise.all([
        fetch(`${API_BASE}/api/settlements`),
        fetch(`${API_BASE}/api/stats`),
      ]);

      if (settlementsRes.ok) {
        setSettlements(await settlementsRes.json());
      }
      if (statsRes.ok) {
        setStats(await statsRes.json());
      }
      setLoading(false);
    } catch (error) {
      console.error('Failed to fetch data:', error);
      setLoading(false);
    }
  };

  const settlementRate = stats.totalPayments > 0
    ? Math.round((stats.settledPayments / stats.totalPayments) * 100)
    : 0;

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-text-primary">Settlements</h1>
        <p className="text-sm text-text-secondary mt-1">
          Batch settlements executed via BatchSettler + Uniswap V4 Hook
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Settled"
          value={stats.settledPayments.toString()}
          subtitle={`of ${stats.totalPayments} payments`}
          icon={<Layers className="w-4 h-4" />}
        />
        <StatCard
          label="Settlement Rate"
          value={`${settlementRate}%`}
          subtitle="Payments settled"
          icon={<Zap className="w-4 h-4" />}
        />
        <StatCard
          label="Volume Settled"
          value={`$${stats.totalVolume}`}
          subtitle="Total USDC"
          icon={<DollarSign className="w-4 h-4" />}
        />
        <StatCard
          label="Fees Collected"
          value={`$${stats.totalFees}`}
          subtitle="V4 Hook dynamic fees"
          icon={<TrendingDown className="w-4 h-4" />}
        />
      </div>

      {/* How Settlements Work */}
      <div className="card p-5 mb-6">
        <h3 className="text-sm font-semibold text-text-primary mb-4">How Settlements Work</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 rounded-lg bg-surface-overlay border border-border">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-4 h-4 text-accent" />
              <span className="text-sm font-medium text-text-primary">Immediate</span>
            </div>
            <p className="text-xs text-text-muted leading-relaxed">
              Every payment settles instantly. Best for speed, higher gas per transaction.
            </p>
          </div>
          <div className="p-4 rounded-lg bg-surface-overlay border border-border">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="w-4 h-4 text-warning" />
              <span className="text-sm font-medium text-text-primary">Standard</span>
            </div>
            <p className="text-xs text-text-muted leading-relaxed">
              Waits for batch partners to share gas costs. Balanced speed and savings.
            </p>
          </div>
          <div className="p-4 rounded-lg bg-surface-overlay border border-border">
            <div className="flex items-center gap-2 mb-2">
              <TrendingDown className="w-4 h-4 text-success" />
              <span className="text-sm font-medium text-text-primary">Deferred</span>
            </div>
            <p className="text-xs text-text-muted leading-relaxed">
              Accumulates until a threshold is reached. Maximum gas savings for high volume.
            </p>
          </div>
        </div>
        <p className="text-[10px] text-text-muted mt-3 text-center">
          Change your settlement preference anytime in <a href="/settings" className="text-accent hover:underline">Settings</a>
        </p>
      </div>

      {/* Settlements Table */}
      <div className="card overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text-primary">Settlement History</h2>
          <span className="text-xs text-text-muted">{settlements.length} settlement{settlements.length !== 1 ? 's' : ''}</span>
        </div>

        {/* Table Header */}
        <div className="grid grid-cols-12 gap-4 px-6 py-3 border-b border-border bg-surface-overlay/50 text-xs font-medium text-text-muted uppercase tracking-wider">
          <div className="col-span-2">Merchant</div>
          <div className="col-span-2">Gross Amount</div>
          <div className="col-span-2">Net Amount</div>
          <div className="col-span-1">Fee</div>
          <div className="col-span-2">Batch ID</div>
          <div className="col-span-2">Tx Hash</div>
          <div className="col-span-1">Time</div>
        </div>

        {/* Table Body */}
        {loading ? (
          <div className="px-6 py-16 text-center">
            <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <span className="text-sm text-text-muted">Loading...</span>
          </div>
        ) : settlements.length === 0 ? (
          <EmptyState
            icon={<Package className="w-6 h-6 text-text-muted" />}
            title="No settlements yet"
            description="Settlements are created when the batch executor processes payments based on merchant intents. Send a payment to a merchant with an IMMEDIATE intent to see instant settlement."
            action={{ label: 'View Payments', href: '/payments' }}
          />
        ) : (
          <div className="divide-y divide-border">
            {settlements.map((settlement) => (
              <SettlementRow key={settlement.id} settlement={settlement} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Components ──────────────────────────────────────────────────────────────

function StatCard({ label, value, subtitle, icon }: {
  label: string;
  value: string;
  subtitle: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="card p-5">
      <div className="w-8 h-8 rounded-lg bg-surface-overlay flex items-center justify-center text-text-secondary mb-3">
        {icon}
      </div>
      <div className="text-2xl font-semibold text-text-primary tracking-tight">{value}</div>
      <div className="text-xs text-text-muted mt-1">{subtitle}</div>
    </div>
  );
}

function PipelineStep({ label, active }: { label: string; active: boolean }) {
  return (
    <div className={`px-3 py-1.5 rounded-md border ${
      active
        ? 'border-success/30 bg-success-muted text-success'
        : 'border-border bg-surface text-text-muted'
    }`}>
      {label}
    </div>
  );
}

function PipelineArrow() {
  return (
    <div className="text-text-muted">→</div>
  );
}

function SettlementRow({ settlement }: { settlement: Settlement }) {
  return (
    <div className="grid grid-cols-12 gap-4 px-6 py-4 items-center table-row-hover">
      {/* Merchant */}
      <div className="col-span-2">
        <span className="text-sm font-mono text-text-primary">
          {settlement.merchant.slice(0, 6)}...{settlement.merchant.slice(-4)}
        </span>
      </div>

      {/* Gross Amount */}
      <div className="col-span-2">
        <span className="text-sm text-text-secondary">
          {settlement.grossAmount}
        </span>
        <span className="text-xs text-text-muted ml-1">USDC</span>
      </div>

      {/* Net Amount */}
      <div className="col-span-2">
        <span className="text-sm font-medium text-text-primary">
          {settlement.netAmount}
        </span>
        <span className="text-xs text-text-muted ml-1">USDC</span>
      </div>

      {/* Fee */}
      <div className="col-span-1">
        <span className="text-xs text-text-muted">
          {settlement.fee === '0' ? '—' : `$${settlement.fee}`}
        </span>
      </div>

      {/* Batch ID */}
      <div className="col-span-2">
        {settlement.batchId ? (
          <span className="text-xs font-mono text-text-secondary">
            {settlement.batchId.slice(0, 10)}...
          </span>
        ) : (
          <span className="text-xs text-text-muted">—</span>
        )}
      </div>

      {/* Tx Hash */}
      <div className="col-span-2">
        {settlement.txHash ? (
          <a
            href={`${EXPLORER_URL}/${settlement.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-mono text-success hover:underline flex items-center gap-1"
          >
            {settlement.txHash.slice(0, 8)}...{settlement.txHash.slice(-6)}
            <ExternalLink className="w-3 h-3" />
          </a>
        ) : (
          <span className="text-xs text-text-muted">—</span>
        )}
      </div>

      {/* Time */}
      <div className="col-span-1">
        {settlement.settledAt ? (
          <>
            <span className="text-xs text-text-muted">
              {new Date(settlement.settledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
            <div className="text-[10px] text-text-muted">
              {new Date(settlement.settledAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
            </div>
          </>
        ) : (
          <span className="text-xs text-text-muted">—</span>
        )}
      </div>
    </div>
  );
}