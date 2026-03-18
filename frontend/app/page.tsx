'use client';

import { useEffect, useState, useRef } from 'react';
import {
  DollarSign,
  ArrowUpRight,
  ArrowDownRight,
  Activity,
  Zap,
  TrendingUp,
  Clock,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
} from 'lucide-react';
import { useToast } from '../components/Toast';
import VolumeChart from '../components/VolumeChart';
import { StatCardSkeleton, PaymentRowSkeleton, StatusCardSkeleton } from '../components/Skeleton';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Payment {
  id: string;
  paymentId: string;
  merchant: string;
  amount: string;
  token: string;
  status: string;
  settled: boolean;
  source: string;
  sourceChain: string;
  blockNumber: number;
  transactionHash: string;
  settlementTxHash: string | null;
  timestamp: string;
}

interface Stats {
  totalVolume: string;
  totalPayments: number;
  settledPayments: number;
  totalFees: string;
  avgSettlementTime: string;
  activeChains: number;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';

// ─── Page ────────────────────────────────────────────────────────────────────

export default function OverviewPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [stats, setStats] = useState<Stats>({
    totalVolume: '0',
    totalPayments: 0,
    settledPayments: 0,
    totalFees: '0',
    avgSettlementTime: '<5s',
    activeChains: 1,
  });
  const [loading, setLoading] = useState(true);
  const { addToast } = useToast();
  const prevPaymentCount = useRef(0);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  const fetchData = async () => {
    try {
      const [paymentsRes, statsRes] = await Promise.all([
        fetch(`${API_BASE}/api/payments`),
        fetch(`${API_BASE}/api/stats`),
      ]);

      if (paymentsRes.ok) {
        const data = await paymentsRes.json();
        setPayments(data.slice(0, 5));

        // Notify on new payments (skip initial load)
        if (prevPaymentCount.current > 0 && data.length > prevPaymentCount.current) {
          const newPayment = data[0];
          addToast({
            type: newPayment.status === 'settled' ? 'success' : 'info',
            title: newPayment.status === 'settled' ? 'Payment Settled' : 'Payment Received',
            message: `${newPayment.amount} USDC from ${newPayment.merchant.slice(0, 6)}...${newPayment.merchant.slice(-4)}`,
          });
        }
        prevPaymentCount.current = data.length;
      }

      if (statsRes.ok) {
        const data = await statsRes.json();
        setStats(data);
      }

      setLoading(false);
    } catch (error) {
      console.error('Failed to fetch data:', error);
      setLoading(false);
    }
  };

  return (
    <div className="p-8">
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-text-primary">Overview</h1>
        <p className="text-sm text-text-secondary mt-1">
          Real-time payment processing on Arc
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {loading ? (
          <>
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </>
        ) : (
          <>
            <StatCard
              label="Total Volume"
              value={`$${stats.totalVolume}`}
              icon={<DollarSign className="w-4 h-4" />}
              change={stats.totalPayments > 0 ? '+' + stats.totalVolume : undefined}
              positive={true}
            />
            <StatCard
              label="Payments"
              value={stats.totalPayments.toString()}
              icon={<Activity className="w-4 h-4" />}
              subtitle={`${stats.settledPayments} settled`}
            />
            <StatCard
              label="Avg Settlement"
              value={stats.avgSettlementTime}
              icon={<Zap className="w-4 h-4" />}
              subtitle="IMMEDIATE intent"
            />
            <StatCard
              label="Fees Collected"
              value={`$${stats.totalFees}`}
              icon={<TrendingUp className="w-4 h-4" />}
              subtitle="V4 Hook fees"
            />
          </>
        )}
      </div>

      {/* Volume Chart */}
      <div className="mb-8">
        <VolumeChart />
      </div>

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6"></div>

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Payments — takes 2 columns */}
        <div className="lg:col-span-2 card">
          <div className="px-6 py-4 border-b border-border">
            <h2 className="text-sm font-semibold text-text-primary">Recent Payments</h2>
          </div>

          {loading ? (
            <div className="divide-y divide-border">
              <PaymentRowSkeleton />
              <PaymentRowSkeleton />
              <PaymentRowSkeleton />
            </div>
          ) : payments.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <AlertCircle className="w-8 h-8 text-text-muted mx-auto mb-3" />
              <p className="text-sm text-text-secondary">No payments yet</p>
              <p className="text-xs text-text-muted mt-1">
                Send a test payment to see it here
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {payments.map((payment) => (
                <PaymentRow key={payment.id} payment={payment} />
              ))}
            </div>
          )}
        </div>

        {/* Right Column — System Status */}
        <div className="space-y-4">
          {loading ? (
            <>
              <StatusCardSkeleton />
              <StatusCardSkeleton />
              <StatusCardSkeleton />
            </>
          ) : (
            <>
              {/* Pipeline Status */}
              <div className="card p-5">
                <h3 className="text-sm font-semibold text-text-primary mb-4">
                  Pipeline Status
                </h3>
                <div className="space-y-3">
                  <StatusRow label="Event Listener" status="active" detail="WebSocket" />
                  <StatusRow label="Payment Consumer" status="active" detail="Redis Streams" />
                  <StatusRow label="Intent Checker" status="active" detail="On-chain" />
                  <StatusRow label="Batch Executor" status="active" detail="BatchSettler" />
                  <StatusRow label="CCTP Relayer" status="standby" detail="No source RPCs" />
                </div>
              </div>

              {/* Architecture */}
              <div className="card p-5">
                <h3 className="text-sm font-semibold text-text-primary mb-4">
                  Architecture
                </h3>
                <div className="space-y-2">
                  <ArchRow label="Cross-chain" value="CCTP V2" />
                  <ArchRow label="Settlement" value="Uniswap V4 Hook" />
                  <ArchRow label="Batching" value="BatchSettler" />
                  <ArchRow label="Fallback" value="Li.Fi SDK" />
                  <ArchRow label="Network" value="Arc Testnet" />
                </div>
              </div>

              {/* Contracts */}
              <div className="card p-5">
                <h3 className="text-sm font-semibold text-text-primary mb-4">
                  Deployed Contracts
                </h3>
                <div className="space-y-2">
                  <ContractRow label="PaymentPool" address="0xf929...46B2" />
                  <ContractRow label="IntentVault" address="0x992f...1942" />
                  <ContractRow label="BatchSettler" address="0x6362...6DA9" />
                  <ContractRow label="CCTPReceiver" address="0x3ea7...d490" />
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Components ──────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon,
  change,
  positive,
  subtitle,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  change?: string;
  positive?: boolean;
  subtitle?: string;
}) {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="w-8 h-8 rounded-lg bg-surface-overlay flex items-center justify-center text-text-secondary">
          {icon}
        </div>
        {change && (
          <span className={`text-xs font-medium flex items-center gap-0.5 ${positive ? 'text-success' : 'text-danger'}`}>
            {positive ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
            {change}
          </span>
        )}
      </div>
      <div className="text-2xl font-semibold text-text-primary tracking-tight">
        {value}
      </div>
      <div className="text-xs text-text-muted mt-1">
        {subtitle || label}
      </div>
    </div>
  );
}

function PaymentRow({ payment }: { payment: Payment }) {
  const statusConfig = {
    settled: { icon: CheckCircle2, color: 'text-success', bg: 'bg-success-muted', label: 'Settled' },
    pending: { icon: Clock, color: 'text-warning', bg: 'bg-warning-muted', label: 'Pending' },
    processing: { icon: Activity, color: 'text-accent', bg: 'bg-accent-muted', label: 'Processing' },
  };

  const config = statusConfig[payment.status as keyof typeof statusConfig] || statusConfig.pending;
  const StatusIcon = config.icon;

  return (
    <div className="px-6 py-4 flex items-center justify-between table-row-hover">
      <div className="flex items-center gap-4">
        {/* Status icon */}
        <div className={`w-8 h-8 rounded-full ${config.bg} flex items-center justify-center`}>
          <StatusIcon className={`w-4 h-4 ${config.color}`} />
        </div>

        {/* Payment info */}
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-text-primary">
              {payment.amount} USDC
            </span>
            {payment.source === 'CCTP' && (
              <span className="text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded bg-accent-muted text-accent">
                CCTP
              </span>
            )}
          </div>
          <div className="text-xs text-text-muted font-mono mt-0.5">
            {payment.merchant.slice(0, 6)}...{payment.merchant.slice(-4)}
          </div>
        </div>
      </div>

      {/* Right side */}
      <div className="text-right">
        <span className={`text-xs font-medium ${config.color}`}>
          {config.label}
        </span>
        <div className="text-[10px] text-text-muted mt-0.5">
          {new Date(payment.timestamp).toLocaleTimeString()}
        </div>
      </div>
    </div>
  );
}

function StatusRow({ label, status, detail }: { label: string; status: 'active' | 'standby' | 'error'; detail: string }) {
  const colors = {
    active: 'bg-success',
    standby: 'bg-warning',
    error: 'bg-danger',
  };

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <div className={`w-1.5 h-1.5 rounded-full ${colors[status]}`} />
        <span className="text-sm text-text-secondary">{label}</span>
      </div>
      <span className="text-xs text-text-muted">{detail}</span>
    </div>
  );
}

function ArchRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-text-muted">{label}</span>
      <span className="text-xs font-medium text-text-secondary">{value}</span>
    </div>
  );
}

function ContractRow({ label, address }: { label: string; address: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-text-muted">{label}</span>
      <span className="text-xs font-mono text-text-secondary">{address}</span>
    </div>
  );
}