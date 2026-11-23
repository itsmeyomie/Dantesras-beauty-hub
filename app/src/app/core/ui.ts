import { Injectable, Pipe, PipeTransform, inject } from '@angular/core';
import { AlertController, ToastController } from '@ionic/angular';

/** KSh 1,500 */
export function ksh(n: number | null | undefined): string {
  return 'KSh ' + Math.round(Number(n ?? 0)).toLocaleString('en-KE');
}

@Pipe({ name: 'ksh' })
export class KshPipe implements PipeTransform {
  transform(n: number | null | undefined): string {
    return ksh(n);
  }
}

/** Local (Nairobi) date helpers */
export function ymd(d: Date): string {
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
export function dayRange(d: Date): [string, string] {
  const s = startOfDay(d);
  return [s.toISOString(), addDays(s, 1).toISOString()];
}
export function ageFrom(birth: string | null): number | null {
  if (!birth) return null;
  const b = new Date(birth);
  const now = new Date();
  let a = now.getFullYear() - b.getFullYear();
  if (now.getMonth() < b.getMonth() || (now.getMonth() === b.getMonth() && now.getDate() < b.getDate())) a--;
  return a;
}

@Injectable({ providedIn: 'root' })
export class Ui {
  private toastCtrl = inject(ToastController);
  private alertCtrl = inject(AlertController);

  async toast(message: string, color: 'success' | 'danger' | 'medium' = 'success') {
    const t = await this.toastCtrl.create({ message, duration: color === 'danger' ? 4000 : 2000, color, position: 'top' });
    await t.present();
  }
  error(e: unknown) {
    return this.toast(e instanceof Error ? e.message : String(e), 'danger');
  }
  async confirm(header: string, message: string, ok = 'Yes'): Promise<boolean> {
    const a = await this.alertCtrl.create({ header, message, buttons: [{ text: 'Cancel', role: 'cancel' }, { text: ok, role: 'ok' }] });
    await a.present();
    return (await a.onDidDismiss()).role === 'ok';
  }
  async prompt(header: string, placeholder: string, message?: string): Promise<string | null> {
    const a = await this.alertCtrl.create({
      header,
      message,
      inputs: [{ name: 'v', type: 'text', placeholder }],
      buttons: [{ text: 'Cancel', role: 'cancel' }, { text: 'OK', role: 'ok' }],
    });
    await a.present();
    const r = await a.onDidDismiss();
    return r.role === 'ok' ? ((r.data?.values?.v as string) ?? '').trim() : null;
  }
}
