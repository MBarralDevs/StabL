'use client';

import { useEffect, useState } from 'react';
import { Activity, Zap, TrendingUp, DollarSign, ArrowRight, CheckCircle, Clock } from 'lucide-react';

interface Payment {
  id: string;
  paymentId: string;
  merchant: string;
  amount: string;
  token: string;
  status: string;
  yellowCredited: boolean;
  settled: boolean;
  blockNumber: number;
  transactionHash: string;
  timestamp: string;
}

interface Stats {
  totalVolume: string;
  totalPayments: number;
  avgSettlementTime: string;
  activeChains: number;
}

export default function Dashboard() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [stats, setStats] = useState<Stats>({
    totalVolume: '0',
    totalPayments: 0,
    avgSettlementTime: '0',
    activeChains: 3,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
    // Poll for updates every 5 seconds
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  const fetchData = async () => {
  try {
    // Fetch payments from real backend
    const paymentsRes = await fetch('http://localhost:3002/api/payments');
    const paymentsData = await paymentsRes.json();
    setPayments(paymentsData);

    // Fetch stats from real backend
    const statsRes = await fetch('http://localhost:3002/api/stats');
    const statsData = await statsRes.json();
    
    setStats({
      totalVolume: statsData.totalVolume,
      totalPayments: statsData.totalPayments,
      avgSettlementTime: statsData.avgSettlementTime,
      activeChains: statsData.activeChains,
    });

    setLoading(false);
  } catch (error) {
    console.error('Failed to fetch data:', error);
    setLoading(false);
  }
};

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg flex items-center justify-center">
                <Zap className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-slate-900">StabL Gateway</h1>
                <p className="text-sm text-slate-500">Universal Stablecoin Payment Processing</p>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
              <span className="text-sm text-slate-600">Live</span>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <StatCard
            title="Total Volume"
            value={`$${stats.totalVolume}`}
            icon={<DollarSign className="w-5 h-5" />}
            trend="+12.5%"
            trendUp={true}
          />
          <StatCard
            title="Total Payments"
            value={stats.totalPayments.toString()}
            icon={<Activity className="w-5 h-5" />}
            trend="+8"
            trendUp={true}
          />
          <StatCard
            title="Avg Settlement"
            value={stats.avgSettlementTime}
            icon={<Zap className="w-5 h-5" />}
            trend="Instant"
            trendUp={true}
          />
          <StatCard
            title="Active Chains"
            value={stats.activeChains.toString()}
            icon={<TrendingUp className="w-5 h-5" />}
            trend="Arc, ETH, ARB"
            trendUp={true}
          />
        </div>

        {/* Recent Payments */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50">
            <h2 className="text-lg font-semibold text-slate-900">Recent Payments</h2>
            <p className="text-sm text-slate-500 mt-1">Real-time payment processing with Yellow Network & Li.Fi</p>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Payment ID
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Merchant
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Amount
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Yellow
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Settlement
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-200">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-slate-500">
                      <div className="flex items-center justify-center space-x-2">
                        <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                        <span>Loading payments...</span>
                      </div>
                    </td>
                  </tr>
                ) : payments.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-slate-500">
                      No payments yet. Send a test payment to see it here!
                    </td>
                  </tr>
                ) : (
                  payments.map((payment) => (
                    <tr key={payment.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-mono text-slate-900">
                          {payment.paymentId.slice(0, 10)}...
                        </div>
                        <div className="text-xs text-slate-500">
                          Block {payment.blockNumber}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-mono text-slate-900">
                          {payment.merchant.slice(0, 6)}...{payment.merchant.slice(-4)}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-semibold text-slate-900">
                          {payment.amount} {payment.token}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <StatusBadge status={payment.status} />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {payment.yellowCredited ? (
                          <CheckCircle className="w-5 h-5 text-green-500" />
                        ) : (
                          <Clock className="w-5 h-5 text-yellow-500" />
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {payment.settled ? (
                          <div className="flex items-center space-x-1 text-green-600">
                            <CheckCircle className="w-4 h-4" />
                            <span className="text-xs font-medium">On-Chain</span>
                          </div>
                        ) : (
                          <div className="flex items-center space-x-1 text-yellow-600">
                            <Clock className="w-4 h-4" />
                            <span className="text-xs font-medium">Pending</span>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Integration Partners */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-6">
          <IntegrationCard
            name="Yellow Network"
            description="Instant liquidity via state channels"
            status="Connected"
            logo="🟡"
          />
          <IntegrationCard
            name="Li.Fi"
            description="Cross-chain routing & bridges"
            status="Active"
            logo="🌉"
          />
          <IntegrationCard
            name="Arc Testnet"
            description="Gas paid in USDC"
            status="Live"
            logo="⚡"
          />
        </div>
      </main>
    </div>
  );
}

function StatCard({ title, value, icon, trend, trendUp }: {
  title: string;
  value: string;
  icon: React.ReactNode;
  trend: string;
  trendUp: boolean;
}) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center text-blue-600">
          {icon}
        </div>
        <div className={`text-xs font-medium ${trendUp ? 'text-green-600' : 'text-red-600'}`}>
          {trend}
        </div>
      </div>
      <div className="text-2xl font-bold text-slate-900 mb-1">{value}</div>
      <div className="text-sm text-slate-500">{title}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles = {
    settled: 'bg-green-100 text-green-800',
    pending: 'bg-yellow-100 text-yellow-800',
    processing: 'bg-blue-100 text-blue-800',
  };

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${styles[status as keyof typeof styles] || styles.processing}`}>
      {status}
    </span>
  );
}

function IntegrationCard({ name, description, status, logo }: {
  name: string;
  description: string;
  status: string;
  logo: string;
}) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
      <div className="flex items-center space-x-3 mb-3">
        <div className="text-3xl">{logo}</div>
        <div>
          <h3 className="font-semibold text-slate-900">{name}</h3>
          <div className="flex items-center space-x-1">
            <div className="w-2 h-2 bg-green-500 rounded-full"></div>
            <span className="text-xs text-green-600 font-medium">{status}</span>
          </div>
        </div>
      </div>
      <p className="text-sm text-slate-500">{description}</p>
    </div>
  );
}