'use client';

import { useEffect, useState } from 'react';

export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

type StandaloneNavigator = Navigator & { standalone?: boolean };

export function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as StandaloneNavigator).standalone === true
  );
}

export function isIos() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

/** Shared by the floating InstallBanner and the dedicated /install page —
 * both just need to know whether/how this device can install the app. */
export function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [platform, setPlatform] = useState<'installable' | 'ios' | null>(null);

  useEffect(() => {
    if (isStandalone()) { setInstalled(true); return; }

    function onBeforeInstallPrompt(e: Event) {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setPlatform('installable');
    }
    function onInstalled() {
      setInstalled(true);
      setDeferredPrompt(null);
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);

    if (isIos()) setPlatform('ios');

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  async function install() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') setInstalled(true);
    setDeferredPrompt(null);
  }

  return { installed, platform, canInstall: !!deferredPrompt, install };
}

export type AppUpdateStatus = 'idle' | 'checking' | 'up-to-date' | 'updating' | 'unsupported';

/** Forces a service-worker update check and, if a new version is waiting,
 * tells it to take over and reloads — the app's own "check for updates". */
export function useAppUpdate() {
  const [status, setStatus] = useState<AppUpdateStatus>('idle');

  useEffect(() => {
    if (!('serviceWorker' in navigator)) { setStatus('unsupported'); return; }
    let reloaded = false;
    function onControllerChange() {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    }
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    return () => navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
  }, []);

  async function checkForUpdate() {
    if (!('serviceWorker' in navigator)) { setStatus('unsupported'); return; }
    setStatus('checking');
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) { setStatus('unsupported'); return; }
      await reg.update();

      if (reg.waiting) {
        setStatus('updating');
        reg.waiting.postMessage('SKIP_WAITING');
        return;
      }
      if (reg.installing) {
        setStatus('updating');
        reg.installing.addEventListener('statechange', function onStateChange(this: ServiceWorker) {
          if (this.state === 'installed') this.postMessage('SKIP_WAITING');
        });
        return;
      }
      setStatus('up-to-date');
      setTimeout(() => setStatus('idle'), 3000);
    } catch {
      setStatus('idle');
    }
  }

  return { status, checkForUpdate };
}
