import type { Metadata } from 'next';
import '../styles/globals.css';
import Providers from '../components/Providers';
import AppShell from '../components/AppShell';
import OnboardingModal from '../components/OnboardingModal';

export const metadata: Metadata = {
  title: 'StabL — Merchant Dashboard',
  description: 'Intent-based stablecoin payment gateway powered by CCTP V2 and Uniswap V4',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body>
        <Providers>
          <AppShell>
            {children}
          </AppShell>
          <OnboardingModal />
        </Providers>
      </body>
    </html>
  );
}