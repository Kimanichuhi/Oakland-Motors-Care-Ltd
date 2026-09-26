'use client';

import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

type StandaloneNavigator = Navigator & { standalone?: boolean };

function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as StandaloneNavigator).standalone === true
  );
}

function isIos() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

// Not installed yet means the banner keeps coming back — dismiss only clears
// it for the current page load, not for good, so it reappears on the next
// visit until the app is actually installed.
export default function InstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [platform, setPlatform] = useState<'installable' | 'ios' | null>(null);

  useEffect(() => {
    if (isStandalone()) return;

    function onBeforeInstallPrompt(e: Event) {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setPlatform('installable');
      setVisible(true);
    }
    function onInstalled() {
      setVisible(false);
      setDeferredPrompt(null);
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);

    if (isIos()) {
      setPlatform('ios');
      setVisible(true);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  function dismiss() {
    setVisible(false);
  }

  async function install() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') setVisible(false);
    setDeferredPrompt(null);
  }

  if (!visible || !platform) return null;

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
      {platform === 'installable' && (
        <button className="button primary small" onClick={() => void install()}>Install</button>
      )}
      <button className="install-banner-close" onClick={dismiss} aria-label="Dismiss">
        <X size={16} />
      </button>
    </div>
  );
}
