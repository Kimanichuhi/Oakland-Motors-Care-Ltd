import './globals.css';
import type { Metadata } from 'next';
import { Poppins } from 'next/font/google';
import InstallBanner from '@/components/InstallBanner';

const poppins = Poppins({ subsets: ['latin'], weight: ['400', '500', '600', '700', '800'], variable: '--font-sans' });

export const metadata: Metadata = {
  title: 'Oakland Motor Care Ltd | Workshop Operations',
  description: 'The operating system for Oakland Motor Care Ltd workshop operations.',
  themeColor: '#10263f',
  viewport: { width: 'device-width', initialScale: 1, viewportFit: 'cover' },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Oakland Motor Care',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body className={poppins.variable}>{children}<InstallBanner /></body></html>;
}
