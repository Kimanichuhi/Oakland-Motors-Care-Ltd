'use client';

import { useEffect } from 'react';
import Image from 'next/image';
import { Download, RefreshCw } from 'lucide-react';
import { useInstallPrompt, useAppUpdate } from '@/lib/pwa';

const UPDATE_LABEL: Record<ReturnType<typeof useAppUpdate>['status'], string> = {
  idle: 'Check for updates',
  checking: 'Checking…',
  updating: 'Updating…',
  'up-to-date': "You're up to date",
  unsupported: 'Updates not supported here',
};

export default function InstallPage() {
  useEffect(() => { if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js'); }, []);

  const { installed, platform, canInstall, install } = useInstallPrompt();
  const { status, checkForUpdate } = useAppUpdate();

  return (
    <div className="auth-layout"><div className="auth-panel"><div className="auth-card">
      <Image src="/logo.png" alt="Oakland Motor Care Ltd" className="auth-logo" width={1774} height={887} priority />
      <h2>Install &amp; updates</h2>
      <p className="muted">Add Oakland Motor Care to this device for full-screen, offline-ready access, and keep it on the latest version.</p>

      {installed && <div className="form-success">Already installed on this device.</div>}

      {!installed && platform === 'ios' && (
        <p className="muted">Tap the Share icon in Safari, then &quot;Add to Home Screen&quot;.</p>
      )}

      {!installed && platform !== 'ios' && canInstall && (
        <button className="button primary wide" onClick={() => void install()}><Download size={17} /> Install app</button>
      )}

      {!installed && platform !== 'ios' && !canInstall && (
        <p className="muted">Your browser didn&apos;t offer a one-tap install here. Open its menu and look for &quot;Install app&quot; or &quot;Add to Home Screen&quot;.</p>
      )}

      <button
        className="button secondary wide"
        disabled={status === 'checking' || status === 'updating' || status === 'unsupported'}
        onClick={() => void checkForUpdate()}
        style={{ marginTop: 14 }}
      >
        <RefreshCw size={17} /> {UPDATE_LABEL[status]}
      </button>
    </div></div></div>
  );
}
