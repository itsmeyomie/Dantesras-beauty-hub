import { Injectable, computed, inject, signal } from '@angular/core';
import { DataService } from './data.service';

/** The developer's switches, read by every app (see /dev and migration 020). */
export interface AppStatus {
  paused: boolean;
  pause_message: string;
  maintenance: boolean;
  maintenance_message: string;
  banner: string | null;
  min_version_code: number;
}

/** Error messages worth sending to the developer (not "wrong password" and other normal answers). */
const TECHNICAL = /fetch|network|typeerror|cannot read|undefined|null is not|violates|relation|column|function .* does not exist|permission denied|jwt|timeout|syntax|internal|\b50[0-4]\b/i;

@Injectable({ providedIn: 'root' })
export class AppControlService {
  private data = inject(DataService);
  readonly status = signal<AppStatus | null>(null);
  /** Android versionCode of this app (null on the website). */
  readonly build = signal<number | null>(null);
  readonly version = signal<string>('web');
  readonly bannerHidden = signal(false);
  readonly updateNeeded = computed(() => {
    const b = this.build(), s = this.status();
    return b !== null && !!s && s.min_version_code > b;
  });
  private started = false;
  private sent = new Map<string, number>();
  private reports = 0;

  start() {
    if (this.started || !this.data.configured) return;
    this.started = true;
    void this.refresh();
    setInterval(() => void this.refresh(), 60_000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void this.refresh(); });
    window.addEventListener('dbh-paused', (e) => this.pausedHit(String((e as CustomEvent).detail ?? '')));
    window.addEventListener('dbh-error', (e) => { const m = String((e as CustomEvent).detail ?? ''); if (TECHNICAL.test(m)) this.report(m); });
    window.addEventListener('error', (e) => this.report(e.message || 'Script error', `${e.filename ?? ''}:${e.lineno ?? ''}`));
    window.addEventListener('unhandledrejection', (e) => {
      const r = (e as PromiseRejectionEvent).reason;
      const m = r instanceof Error ? r.message : String(r);
      if (m.includes('SERVICE_PAUSED')) return this.pausedHit(m);
      this.report(m, r instanceof Error ? r.stack : undefined);
    });
    void this.readBuild();
  }
  async refresh() {
    try {
      const s = await this.data.rpc<AppStatus>('app_status', {});
      if (s) this.status.set(s);
    } catch { /* offline: keep the last known status */ }
  }
  /** A call was refused because the service is paused. */
  pausedHit(msg: string) {
    const text = msg.replace(/^.*SERVICE_PAUSED:\s*/, '') || 'This service is paused.';
    this.status.update((s) => ({ ...(s ?? { maintenance: false, maintenance_message: '', banner: null, min_version_code: 0 }), paused: true, pause_message: text }));
  }
  /** Send an error to the developer panel (deduplicated, at most 30 per app start). */
  report(message: string, detail?: string) {
    if (!message || this.reports >= 30) return;
    const key = message.slice(0, 120);
    if (Date.now() - (this.sent.get(key) ?? 0) < 60_000) return;
    this.sent.set(key, Date.now());
    this.reports++;
    const app = location.pathname.startsWith('/portal') || location.pathname === '/' ? 'client' : 'staff';
    void this.data.rpc('report_error', { p: { app, version: this.version(), url: location.pathname, message, detail: detail?.slice(0, 2000) } }).catch(() => undefined);
  }
  private async readBuild() {
    try {
      const { Capacitor } = await import('@capacitor/core');
      if (!Capacitor.isNativePlatform()) return;
      const { App } = await import('@capacitor/app');
      const info = await App.getInfo();
      this.build.set(Number(info.build) || null);
      this.version.set(`android ${info.version} (${info.build})`);
    } catch { /* not available */ }
  }
}
