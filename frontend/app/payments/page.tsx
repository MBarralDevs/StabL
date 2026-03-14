'use client';

import { useEffect, useState } from 'react';
import {
  Search,
  Filter,
  CheckCircle2,
  Clock,
  Activity,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

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
  settlementAmount: string | null;
  settlementFee: string | null;
  batchId: string | null;
  timestamp: string;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';
const EXPLORER_URL = 'https://testnet.arcscan.app/tx';

// ─── Page ────────────────────────────────────────────────────────────────────

export default function PaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [filtered, setFiltered] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'settled' | 'pending'>('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'ARC' | 'CCTP'>('all');
  const [page, setPage] = useState(0);
  const perPage = 10;

  useEffect(() => {
    fetchPayments();
    const interval = setInterval(fetchPayments, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    applyFilters();
  }, [payments, search, statusFilter, sourceFilter]);

  const fetchPayments = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/payments`);
      if (res.ok) {
        const data = await res.json();
        setPayments(data);
      }
      setLoading(false);
    } catch (error) {
      console.error('Failed to fetch payments:', error);
      setLoading(false);
    }
  };

  const applyFilters = () => {
    let result = [...payments];

    // Status filter
    if (statusFilter !== 'all') {
      result = result.filter(p => p.status === statusFilter);
    }

    // Source filter
    if (sourceFilter !== 'all') {
      result = result.filter(p => p.source === sourceFilter);
    }

    // Search (merchant address or payment ID)
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        p =>
          p.merchant.toLowerCase().includes(q) ||
          p.paymentId.toLowerCase().includes(q) ||
          p.transactionHash?.toLowerCase().includes(q)
      );
    }

    setFiltered(result);
    setPage(0); // Reset to first page on filter change
  };

  const paginated = filtered.slice(page * perPage, (page + 1) * perPage);
  const totalPages = Math.ceil(filtered.length / perPage);

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-text-primary">Payments</h1>
        <p className="text-sm text-text-secondary mt-1">
          {payments.length} total payment{payments.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Filters Bar */}
      <div className="card p-4 mb-6">
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <input
              type="text"
              placeholder="Search by address, payment ID, or tx hash..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-surface border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30"
            />
          </div>

          {/* Status Filter */}
          <div className="flex gap-2">
            {(['all', 'settled', 'pending'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-2.5 rounded-lg text-xs font-medium capitalize transition-colors ${
                  statusFilter === s
                    ? 'bg-accent/10 text-accent border border-accent/30'
                    : 'bg-surface border border-border text-text-secondary hover:text-text-primary hover:border-border-light'
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          {/* Source Filter */}
          <div className="flex gap-2">
            {(['all', 'ARC', 'CCTP'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSourceFilter(s)}
                className={`px-3 py-2.5 rounded-lg text-xs font-medium transition-colors ${
                  sourceFilter === s
                    ? 'bg-accent/10 text-accent border border-accent/30'
                    : 'bg-surface border border-border text-text-secondary hover:text-text-primary hover:border-border-light'
                }`}
              >
                {s === 'all' ? 'All Sources' : s}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {/* Table Header */}
        <div className="grid grid-cols-12 gap-4 px-6 py-3 border-b border-border bg-surface-overlay/50 text-xs font-medium text-text-muted uppercase tracking-wider">
          <div className="col-span-1">Status</div>
          <div className="col-span-2">Payment ID</div>
          <div className="col-span-2">Merchant</div>
          <div className="col-span-1">Amount</div>
          <div className="col-span-1">Source</div>
          <div className="col-span-2">Tx Hash</div>
          <div className="col-span-2">Settlement</div>
          <div className="col-span-1">Time</div>
        </div>

        {/* Table Body */}
        {loading ? (
          <div className="px-6 py-16 text-center">
            <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <span className="text-sm text-text-muted">Loading payments...</span>
          </div>
        ) : paginated.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <p className="text-sm text-text-secondary">
              {payments.length === 0 ? 'No payments yet' : 'No payments match your filters'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {paginated.map((payment) => (
              <PaymentTableRow key={payment.id} payment={payment} />
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-6 py-3 border-t border-border flex items-center justify-between">
            <span className="text-xs text-text-muted">
              Showing {page * perPage + 1}–{Math.min((page + 1) * perPage, filtered.length)} of {filtered.length}
            </span>
            <div className="flex gap-1">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="p-1.5 rounded-md border border-border text-text-secondary hover:bg-surface-overlay disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="p-1.5 rounded-md border border-border text-text-secondary hover:bg-surface-overlay disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Table Row Component ─────────────────────────────────────────────────────

function PaymentTableRow({ payment }: { payment: Payment }) {
  const statusConfig = {
    settled: { icon: CheckCircle2, color: 'text-success', bg: 'bg-success-muted' },
    pending: { icon: Clock, color: 'text-warning', bg: 'bg-warning-muted' },
    processing: { icon: Activity, color: 'text-accent', bg: 'bg-accent-muted' },
  };

  const config = statusConfig[payment.status as keyof typeof statusConfig] || statusConfig.pending;
  const StatusIcon = config.icon;

  return (
    <div className="grid grid-cols-12 gap-4 px-6 py-4 items-center table-row-hover">
      {/* Status */}
      <div className="col-span-1">
        <div className={`w-7 h-7 rounded-full ${config.bg} flex items-center justify-center`}>
          <StatusIcon className={`w-3.5 h-3.5 ${config.color}`} />
        </div>
      </div>

      {/* Payment ID */}
      <div className="col-span-2">
        <span className="text-xs font-mono text-text-secondary">
          {payment.paymentId.slice(0, 10)}...{payment.paymentId.slice(-6)}
        </span>
      </div>

      {/* Merchant */}
      <div className="col-span-2">
        <span className="text-sm font-mono text-text-primary">
          {payment.merchant.slice(0, 6)}...{payment.merchant.slice(-4)}
        </span>
      </div>

      {/* Amount */}
      <div className="col-span-1">
        <span className="text-sm font-medium text-text-primary">
          {payment.amount}
        </span>
        <span className="text-xs text-text-muted ml-1">USDC</span>
      </div>

      {/* Source */}
      <div className="col-span-1">
        <span className={`text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded ${
          payment.source === 'CCTP'
            ? 'bg-accent-muted text-accent'
            : 'bg-surface-overlay text-text-secondary'
        }`}>
          {payment.source || 'ARC'}
        </span>
      </div>

      {/* Tx Hash */}
      <div className="col-span-2">
        {payment.transactionHash ? (
          <a
            href={`${EXPLORER_URL}/${payment.transactionHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-mono text-accent hover:underline flex items-center gap-1"
          >
            {payment.transactionHash.slice(0, 8)}...{payment.transactionHash.slice(-6)}
            <ExternalLink className="w-3 h-3" />
          </a>
        ) : (
          <span className="text-xs text-text-muted">—</span>
        )}
      </div>

      {/* Settlement */}
      <div className="col-span-2">
        {payment.settlementTxHash ? (
          <a
            href={`${EXPLORER_URL}/${payment.settlementTxHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-mono text-success hover:underline flex items-center gap-1"
          >
            {payment.settlementTxHash.slice(0, 8)}...{payment.settlementTxHash.slice(-6)}
            <ExternalLink className="w-3 h-3" />
          </a>
        ) : (
          <span className="text-xs text-text-muted">Pending</span>
        )}
      </div>

      {/* Time */}
      <div className="col-span-1">
        <span className="text-xs text-text-muted">
          {new Date(payment.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
        <div className="text-[10px] text-text-muted">
          {new Date(payment.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' })}
        </div>
      </div>
    </div>
  );
}