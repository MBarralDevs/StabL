import type { Metadata } from 'next';
import '../styles/globals.css';
import Sidebar from '../components/Sidebar';

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
        <div className="flex h-screen overflow-hidden">
          {/* Sidebar */}
          <Sidebar />

          {/* Main content */}
          <main className="flex-1 overflow-y-auto">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}