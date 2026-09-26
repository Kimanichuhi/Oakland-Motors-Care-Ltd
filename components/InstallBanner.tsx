'use client';

import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { useInstallPrompt } from '@/lib/pwa';

// Not installed yet means the banner keeps coming back — dismiss only clears
// it for the current page load, not for good, so it reappears on the next
// visit until the app is actually installed.
export default function InstallBanner() {
  const { installed, platform, canInstall, install } = useInstallPrompt();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => { if (installed) setDismissed(true); }, [installed]);

  function dismiss() {
    setDismissed(true);
  }

  if (dismissed || installed || !platform) return null;

  return (
    <div className="install-banner" role="dialog" aria-label="Install Oakland Motor Care app">
      <div className="install-banner-icon"><Download size={18} /></div>
      <div className="install-banner-copy">
        <strong>Install Oakland Motor Care</strong>
        <span>
          {platform === 'ios'
            ? 'Tap the Share icon, then "Add to Home Screen".'
            : 'Add the app to your device for full-screen, offline-ready access.'}
        </span>
      </div>
      {canInstall && (
        <button className="button primary small" onClick={() => void install()}>Install</button>
      )}
      <button className="install-banner-close" onClick={dismiss} aria-label="Dismiss">
        <X size={16} />
      </button>
    </div>
  );
}
