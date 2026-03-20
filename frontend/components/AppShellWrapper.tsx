'use client';

import { usePathname } from 'next/navigation';
import AppShell from './AppShell';

export default function AppShellWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Landing page renders without the dashboard shell
  if (pathname === '/') {
    return <>{children}</>;
  }

  return <AppShell>{children}</AppShell>;
}