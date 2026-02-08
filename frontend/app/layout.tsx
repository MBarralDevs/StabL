import type { Metadata } from 'next';
import '../styles/globals.css';  // Changed path

export const metadata: Metadata = {
  title: 'StabL Gateway - Universal Stablecoin Payment Processing',
  description: 'Intent-based payment gateway with Yellow Network & Li.Fi integration',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}