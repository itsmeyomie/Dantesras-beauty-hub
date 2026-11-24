import { Injectable, signal } from '@angular/core';

interface InstallPrompt extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>; }

/** "Install the app" for the website (Chrome on Android / desktop): free, updates itself. */
@Injectable({ providedIn: 'root' })
export class InstallService {
  private ev: InstallPrompt | null = null;
  readonly canInstall = signal(false);
  /** running as the Android app, or already installed from the website */
  readonly isApp = signal(
    !!(window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.() ||
      window.matchMedia?.('(display-mode: standalone)').matches,
  );

  constructor() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.ev = e as InstallPrompt;
      this.canInstall.set(true);
    });
    window.addEventListener('appinstalled', () => {
      this.canInstall.set(false);
      this.isApp.set(true);
    });
  }
  async install() {
    if (!this.ev) return;
    await this.ev.prompt();
    await this.ev.userChoice.catch(() => undefined);
    this.ev = null;
    this.canInstall.set(false);
  }
}
