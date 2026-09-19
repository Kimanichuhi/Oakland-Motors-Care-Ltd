import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Josefin_Sans } from 'next/font/google';
import InstallBanner from '@/components/InstallBanner';

const josefinSans = Josefin_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-sans' });

export const metadata: Metadata = {
  title: 'Oakland Motor Care Ltd | Workshop Operations',
  description: 'The operating system for Oakland Motor Care Ltd workshop operations.',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Oakland Motor Care',
  },
};

export const viewport: Viewport = {
  themeColor: '#10263f',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body className={josefinSans.variable}>{children}<InstallBanner /></body></html>;
}
