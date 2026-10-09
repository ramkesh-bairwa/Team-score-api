import type { Metadata, Viewport } from 'next';
import { PopupHost } from '@/components/Popup';
import './globals.css';

export const metadata: Metadata = {
  title: 'CricScore — Live Cricket Scoring',
  description: 'Score cricket matches ball by ball, share live scores and stream your match.',
  icons: { icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🏏</text></svg>" },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#E63946',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <PopupHost />
      </body>
    </html>
  );
}
