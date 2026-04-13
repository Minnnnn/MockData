import type { Metadata } from 'next';
import { TooltipProvider } from '@/components/ui/tooltip';
import { JetBrains_Mono } from 'next/font/google';
import './globals.css';

const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400'],
  variable: '--font-mono',
});

const SANS_STACK =
  "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

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
    <html lang='zh-CN' className={mono.variable}>
      <body style={{ fontFamily: SANS_STACK }}>
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
