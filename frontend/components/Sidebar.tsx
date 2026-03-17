'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  ArrowLeftRight,
  Layers,
  Globe,
  Settings,
  Zap,
  CreditCard,
} from 'lucide-react';

const navigation = [
  { name: 'Overview', href: '/', icon: LayoutDashboard },
  { name: 'Pay', href: '/pay', icon: CreditCard },
  { name: 'Payments', href: '/payments', icon: ArrowLeftRight },
  { name: 'Settlements', href: '/settlements', icon: Layers },
  { name: 'CCTP', href: '/cctp', icon: Globe },
  { name: 'Settings', href: '/settings', icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-[220px] h-screen bg-surface-raised border-r border-border flex flex-col shrink-0">
      {/* Logo */}
      <div className="px-5 py-6 border-b border-border">
        <Link href="/" className="flex items-center gap-3">
          <div className="w-8 h-8 bg-accent rounded-lg flex items-center justify-center glow-accent">
            <Zap className="w-4 h-4 text-white" />
          </div>
          <div>
            <span className="text-base font-semibold text-text-primary tracking-tight">
              StabL
            </span>
            <span className="block text-[10px] uppercase tracking-widest text-text-muted font-medium">
              Gateway
            </span>
          </div>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navigation.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.name}
              href={item.href}
              className={`
                flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium
                transition-all duration-150
                ${isActive
                  ? 'bg-accent/10 text-accent'
                  : 'text-text-secondary hover:text-text-primary hover:bg-surface-overlay'
                }
              `}
            >
              <item.icon className={`w-4 h-4 ${isActive ? 'text-accent' : ''}`} />
              {item.name}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-border">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-success rounded-full animate-pulse" />
          <span className="text-xs text-text-muted">Arc Testnet</span>
        </div>
        <div className="mt-1 text-[10px] text-text-muted font-mono">
          v2.0.0
        </div>
      </div>
    </aside>
  );
}