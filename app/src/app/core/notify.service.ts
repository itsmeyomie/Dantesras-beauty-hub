import { Injectable, NgZone, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { DataService } from './data.service';

export interface AppNotification { id: string; title: string; body: string; url: string | null; created_at: string; read_at: string | null; }
type Who = { kind: 'client' | 'staff'; token: string };

const DEVICE_KEY = 'dbh.push.device';
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* private mode */ } };

/**
 * Notifications: the in-app list (everyone, also on the website) and push to the Android app
 * through Firebase (free). Push only works once google-services.json is in the Android project;
 * until then the app quietly keeps to the in-app list.
 */
@Injectable({ providedIn: 'root' })
export class NotifyService {
  private data = inject(DataService);
  private router = inject(Router);
  private zone = inject(NgZone);
  readonly unread = signal(0);
  private who: Who | null = null;
  private started = false;
  private lastCount = 0;

  // ---------- in-app list ----------
  async list(kind: 'client' | 'staff', token: string): Promise<AppNotification[]> {
    const rows = await this.data.rpc<AppNotification[]>(kind === 'client' ? 'portal_notifications' : 'staff_notifications', { p_token: token });
    this.unread.set(rows.filter((r) => !r.read_at).length);
    return rows;
  }
  async markRead(kind: 'client' | 'staff', token: string) {
    await this.data.rpc(kind === 'client' ? 'portal_notifications_read' : 'staff_notifications_read', { p_token: token });
    this.unread.set(0);
  }
  /** Refresh the unread badge (at most every 30 s). */
  async refresh(kind: 'client' | 'staff', token: string | null) {
    if (!token || Date.now() - this.lastCount < 30_000) return;
    this.lastCount = Date.now();
    await this.list(kind, token).catch(() => undefined);
  }

  // ---------- push (Android app) ----------
  /** After sign-in: ask permission once and link this phone to the person. */
  async register(kind: 'client' | 'staff', token: string) {
    if (this.who?.token === token) return;
    this.who = { kind, token };
    this.lastCount = 0;
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) return;
    try {
      const { PushNotifications } = await import('@capacitor/push-notifications');
      await this.listen();
      let perm = await PushNotifications.checkPermissions();
      if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') perm = await PushNotifications.requestPermissions();
      if (perm.receive !== 'granted') return;
      await PushNotifications.register(); // → 'registration' below
      const known = read(DEVICE_KEY);
      if (known) await this.save(known);
    } catch {
      /* Firebase not set up in this build – in-app notifications still work */
    }
  }
  /** Signing out: this phone stops receiving that person's notifications. */
  async unregister() {
    this.who = null;
    this.unread.set(0);
    const device = read(DEVICE_KEY);
    if (device) await this.data.rpc('unregister_device', { p_device: device }).catch(() => undefined);
  }

  private async save(device: string) {
    if (!this.who) return;
    await this.data.rpc(this.who.kind === 'client' ? 'portal_register_device' : 'staff_register_device',
      { p_token: this.who.token, p_device: device, p_platform: 'android' }).catch(() => undefined);
  }
  private async listen() {
    if (this.started) return;
    this.started = true;
    const { PushNotifications } = await import('@capacitor/push-notifications');
    await PushNotifications.createChannel({ id: 'dantesras', name: 'Bookings and reminders', importance: 4, lightColor: '#7b1e2e', vibration: true })
      .catch(() => undefined);
    await PushNotifications.addListener('registration', ({ value }) => {
      write(DEVICE_KEY, value);
      void this.save(value);
    });
    // a notification arrives while the app is open: update the badge
    await PushNotifications.addListener('pushNotificationReceived', () => this.zone.run(() => this.unread.update((n) => n + 1)));
    // tapped a notification: open its page
    await PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
      const url = (notification.data as { url?: string } | undefined)?.url;
      if (url) this.zone.run(() => void this.router.navigateByUrl(url));
    });
  }
}
