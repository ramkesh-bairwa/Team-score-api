import type { Metadata, Viewport } from 'next';
import Navbar from '@/components/Navbar';
import './globals.css';

export const metadata: Metadata = {
  title: 'LiveStream',
  description: 'Go live from your camera and share a link. Viewers watch in real time over WebRTC.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#09090b',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <Navbar />
        <main>{children}</main>
      </body>
    </html>
  );
}
