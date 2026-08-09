import './globals.css';
import type { Metadata } from 'next';
import { Josefin_Sans } from 'next/font/google';

const josefin = Josefin_Sans({ subsets: ['latin'], variable: '--font-sans' });

export const metadata: Metadata = {
  title: 'Oakland Motors | Workshop Operations',
  description: 'The operating system for Oakland Motors workshop operations.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body className={josefin.variable}>{children}</body></html>;
}
