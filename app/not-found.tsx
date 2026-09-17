import Link from 'next/link';
import Image from 'next/image';
import { SearchX } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="auth-layout">
      <div className="auth-panel">
        <div className="auth-card">
          <Image src="/logo.png" alt="Oakland Motor Care Ltd" className="auth-logo" width={1774} height={887} priority />
          <div className="auth-icon"><SearchX size={22} /></div>
          <h2>Page not found</h2>
          <p className="muted">This page doesn&apos;t exist, or you followed a stale link. Head back to the dashboard to keep going.</p>
          <Link href="/" className="button primary wide" style={{ textDecoration: 'none' }}>Back to dashboard</Link>
        </div>
      </div>
    </div>
  );
}
