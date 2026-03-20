'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  ArrowLeftRight,
  Layers,
  Globe,
  Settings,
  CreditCard,
  Info,
  BookOpen,
  X,
  ExternalLink,
} from 'lucide-react';

const navigation = [
  { name: 'Overview', href: '/', icon: LayoutDashboard },
  { name: 'Pay', href: '/pay', icon: CreditCard },
  { name: 'Payments', href: '/payments', icon: ArrowLeftRight },
  { name: 'Settlements', href: '/settlements', icon: Layers },
  { name: 'CCTP', href: '/cctp', icon: Globe },
  { name: 'Settings', href: '/settings', icon: Settings },
  { name: 'About', href: '/about', icon: Info },
  { name: 'Docs', href: '/docs', icon: BookOpen, external: true },
];

interface SidebarProps {
  open?: boolean;
  onClose?: () => void;
}

export default function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();

  return (
    <>
      {/* Mobile backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed lg:static inset-y-0 left-0 z-50
          w-[220px] h-screen bg-surface-raised border-r border-border
          flex flex-col shrink-0
          transform transition-transform duration-200 ease-out
          ${open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        {/* Logo */}
        <div className="px-5 py-6 border-b border-border flex items-center justify-between">
          <Link href="/home" className="flex items-center gap-3" onClick={onClose}>
            <img src="/logo.png" alt="StabL" className="w-20 h-20 rounded-lg" />
            <div>
              <span className="text-base font-semibold text-text-primary tracking-tight">
                STABL
              </span>
              <span className="block text-[10px] uppercase tracking-widest text-text-muted font-medium">
                Gateway
              </span>
            </div>
          </Link>

          {/* Mobile close button */}
          <button
            onClick={onClose}
            className="lg:hidden p-1 rounded-md text-text-muted hover:text-text-secondary hover:bg-surface-overlay transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {navigation.map((item) => {
            const isActive = pathname === item.href;

            if ((item as any).external) {
              return (
                <a
                  key={item.name}
                  href="https://docs.stabl.dev"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-surface-overlay transition-all duration-150"
                >
                  <item.icon className="w-4 h-4" />
                  {item.name}
                  <ExternalLink className="w-3 h-3 ml-auto text-text-muted" />
                </a>
              );
            }

            return (
              <Link
                key={item.name}
                href={item.href}
                onClick={onClose}
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
    </>
  );
}