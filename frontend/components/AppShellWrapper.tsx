'use client';

import { usePathname } from 'next/navigation';
import AppShell from './AppShell';

export default function AppShellWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Home page renders without the dashboard shell
  if (pathname === '/home') {
    return <>{children}</>;
  }

  return <AppShell>{children}</AppShell>;
}