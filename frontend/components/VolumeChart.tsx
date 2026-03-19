'use client';

import { useEffect, useState } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { BarChart3 } from 'lucide-react';

interface DataPoint {
  date: string;
  volume: number;
  cumulative: number;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';

export default function VolumeChart() {
  const [data, setData] = useState<DataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'volume' | 'cumulative'>('volume');

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchData = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/volume-chart`);
      if (res.ok) {
        setData(await res.json());
      }
      setLoading(false);
    } catch {
      setLoading(false);
    }
  };

  const formatDate = (label: any) => {
    if (typeof label !== 'string') return '';
    const date = new Date(label);
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const dataKey = view === 'volume' ? 'volume' : 'cumulative';

  return (
    <div className="card">
      <div className="px-6 py-4 border-b border-border flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text-primary">Settlement Volume</h2>
        <div className="flex gap-1">
          <button
            onClick={() => setView('volume')}
            className={`px-2.5 py-1 rounded text-[10px] font-medium transition-colors ${
              view === 'volume'
                ? 'bg-accent/10 text-accent'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            Daily
          </button>
          <button
            onClick={() => setView('cumulative')}
            className={`px-2.5 py-1 rounded text-[10px] font-medium transition-colors ${
              view === 'cumulative'
                ? 'bg-accent/10 text-accent'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            Cumulative
          </button>
        </div>
      </div>

      <div className="p-6">
        {loading ? (
          <div className="h-48 flex items-center justify-center">
            <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : data.length === 0 ? (
          <div className="h-48 flex flex-col items-center justify-center">
            <BarChart3 className="w-8 h-8 text-text-muted mb-2" />
            <p className="text-xs text-text-muted">No settlement data yet</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="volumeGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#4A7C59" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#4A7C59" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1E2536" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={formatDate}
                tick={{ fontSize: 10, fill: '#64748B' }}
                axisLine={{ stroke: '#1E2536' }}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: '#64748B' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `$${v}`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#131825',
                  border: '1px solid #1E2536',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
                labelStyle={{ color: '#64748B' }}
                itemStyle={{ color: '#F1F5F9' }}
                formatter={(value: number | undefined) => [`$${value ?? 0} USDC`, view === 'volume' ? 'Volume' : 'Cumulative']}
                labelFormatter={formatDate}
              />
              <Area
                type="monotone"
                dataKey={dataKey}
                stroke="#4A7C59"
                strokeWidth={2}
                fill="url(#volumeGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}