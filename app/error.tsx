'use client';

import { useEffect } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);

  return (
    <div className="auth-layout">
      <div className="auth-panel">
        <div className="auth-card">
          <img src="/logo.png" alt="Oakland Motor Care Ltd" className="auth-logo" />
          <div className="auth-icon"><AlertTriangle size={22} /></div>
          <h2>Something went wrong</h2>
          <p className="muted">
            An unexpected error interrupted this page. Your data is safe — try again, and if it keeps
            happening, let your administrator know what you were doing.
          </p>
          <button className="button primary wide" onClick={() => reset()}>
            <RotateCcw size={16} /> Try again
          </button>
          {error.digest && <p className="muted" style={{ marginTop: 14, fontSize: 11 }}>Reference: {error.digest}</p>}
        </div>
      </div>
    </div>
  );
}
