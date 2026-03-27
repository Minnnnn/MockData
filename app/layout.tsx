import type { Metadata } from 'next';
import { IBM_Plex_Sans, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const sans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '600'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'MockData Workflow Studio',
  description: 'OpenAPI parser, TS generator, mock generator and local mock server workflow',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang='zh-CN' className={`${sans.variable} ${mono.variable}`}>
      <body style={{ fontFamily: 'var(--font-sans)' }}>{children}</body>
    </html>
  );
}
