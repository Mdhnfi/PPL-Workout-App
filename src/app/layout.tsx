import type { Metadata } from 'next';
import './globals.css';
import Providers from '@/components/Providers';

export const metadata: Metadata = {
  title: 'SchemaVCS | Database Schema Comparison & Version Control',
  description:
    'PostgreSQL Schema Comparison, Semantic Version Control, GitHub Migration Pipeline, Query EXPLAIN Analyzer & Health Monitoring',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
