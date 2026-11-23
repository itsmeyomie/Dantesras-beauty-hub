import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonButton, IonButtons, IonContent, IonHeader, IonInput, IonItem, IonMenuButton, IonSelect, IonSelectOption, IonTitle, IonToggle,
  IonToolbar, ViewWillEnter,
} from '@ionic/angular';
import { environment } from '../../environments/environment';
import { DataService } from '../core/data.service';
import { NotConfiguredComponent } from '../core/not-configured.component';
import { Ui } from '../core/ui';

interface Hours { mon_sat: { open: string; close: string }; sun: { open: string; close: string } }

@Component({
  selector: 'app-settings',
  imports: [FormsModule, IonHeader, IonToolbar, IonButtons, IonMenuButton, IonTitle, IonContent, IonItem, IonInput, IonButton, IonToggle,
    IonSelect, IonSelectOption, NotConfiguredComponent],
  template: `
    <ion-header><ion-toolbar>
      <ion-buttons slot="start"><ion-menu-button></ion-menu-button></ion-buttons>
      <ion-title>Settings</ion-title>
    </ion-toolbar></ion-header>
    <ion-content>
      <div class="page-wrap">
        <app-not-configured />
        @if (!ready()) { <div class="empty">Loading settings…</div> } @else {
        <div class="card">
          <h3>Booking & checkout rules</h3>
          <div class="form-grid">
            <ion-item lines="none" class="field"><ion-input label="Minimum deposit to hold a slot (KSh)" labelPlacement="stacked" type="number" [(ngModel)]="v.deposit_min"></ion-input></ion-item>
            <ion-item lines="none" class="field"><ion-input label="Reschedule if late by (minutes)" labelPlacement="stacked" type="number" [(ngModel)]="v.late_minutes"></ion-input></ion-item>
            <ion-item lines="none" class="field"><ion-input label="Max staff discount (%)" labelPlacement="stacked" type="number" [(ngModel)]="v.max_discount_pct"></ion-input></ion-item>
            <ion-item lines="none" class="field"><ion-input label="Kids prices up to age" labelPlacement="stacked" type="number" [(ngModel)]="v.kids_max_age"></ion-input></ion-item>
            <ion-item lines="none" class="field"><ion-input label="Finisher's share of the commission (%)" labelPlacement="stacked" type="number" min="0" max="90" [(ngModel)]="v.finisher_share_pct" data-testid="finisher-share"></ion-input></ion-item>
          </div>
        </div>
        <div class="card" style="margin-top:12px">
          <h3>Salon opening hours</h3>
          <div class="form-grid">
            <ion-item lines="none" class="field"><ion-input label="Mon–Sat opens" labelPlacement="stacked" type="time" [(ngModel)]="hours.mon_sat.open"></ion-input></ion-item>
            <ion-item lines="none" class="field"><ion-input label="Mon–Sat closes" labelPlacement="stacked" type="time" [(ngModel)]="hours.mon_sat.close"></ion-input></ion-item>
            <ion-item lines="none" class="field"><ion-input label="Sunday opens" labelPlacement="stacked" type="time" [(ngModel)]="hours.sun.open"></ion-input></ion-item>
            <ion-item lines="none" class="field"><ion-input label="Sunday closes" labelPlacement="stacked" type="time" [(ngModel)]="hours.sun.close"></ion-input></ion-item>
          </div>
        </div>
        <div class="card" style="margin-top:12px">
          <h3>Client app – online booking</h3>
          <ion-item lines="none"><ion-toggle [(ngModel)]="online.on" labelPlacement="end">Clients can book online</ion-toggle></ion-item>
          <div class="form-grid">
            <ion-item lines="none" class="field"><ion-input label="Earliest booking (minutes from now)" labelPlacement="stacked" type="number" [(ngModel)]="online.lead"></ion-input></ion-item>
            <ion-item lines="none" class="field"><ion-input label="Book up to (days ahead)" labelPlacement="stacked" type="number" [(ngModel)]="online.days"></ion-input></ion-item>
            <ion-item lines="none" class="field"><ion-input label="Time held per online booking (minutes)" labelPlacement="stacked" type="number" [(ngModel)]="online.duration"></ion-input></ion-item>
            <ion-item lines="none" class="field"><ion-input label="Open requests allowed per client" labelPlacement="stacked" type="number" [(ngModel)]="online.max_open"></ion-input></ion-item>
            <ion-item lines="none" class="field"><ion-input label="Salon phone / WhatsApp shown to clients" labelPlacement="stacked" type="tel" placeholder="07XX XXX XXX" [(ngModel)]="online.phone"></ion-input></ion-item>
            <ion-item lines="none" class="field"><ion-input label="Location shown to clients" labelPlacement="stacked" [(ngModel)]="online.location"></ion-input></ion-item>
          </div>
        </div>
        <div class="card" style="margin-top:12px">
          <h3>M-Pesa prompt (STK push)</h3>
          <div class="form-grid">
            <ion-item lines="none" class="field">
              <ion-select label="Payments arrive on" labelPlacement="stacked" interface="popover" [(ngModel)]="mpesa.method">
                <ion-select-option value="mpesa_paybill">Paybill</ion-select-option>
                <ion-select-option value="mpesa_till">Till (Buy Goods)</ion-select-option>
              </ion-select>
            </ion-item>
            <ion-item lines="none" class="field"><ion-input label="Name on the prompt" labelPlacement="stacked" [(ngModel)]="mpesa.name"></ion-input></ion-item>
          </div>
          <p class="small muted">Mode: <strong>{{ simulate ? 'Test (simulated – no money moves)' : 'Live (Safaricom Daraja)' }}</strong>.
            Live mode needs the Daraja keys added to Supabase (see README).</p>
        </div>
        <div class="row" style="margin-top:12px"><span class="spacer"></span><ion-button (click)="save()" [disabled]="saving()">Save settings</ion-button></div>
        }
        <div class="card" style="margin-top:12px">
          <h3>Database</h3>
          <p class="small">Connected: <strong>{{ data.configured ? 'yes' : 'no' }}</strong></p>
          <p class="small muted">Staff login is not built yet, so anyone with the staff link can use it. Don't share the staff pages outside the salon until login is added.</p>
        </div>
      </div>
    </ion-content>
  `,
})
export class SettingsPage implements ViewWillEnter {
  readonly data = inject(DataService);
  private ui = inject(Ui);
  readonly simulate = environment.simulate;
  /** the form shows only once the saved values are loaded, so nothing typed is overwritten */
  readonly ready = signal(false);
  readonly saving = signal(false);
  v = { deposit_min: 500, late_minutes: 20, max_discount_pct: 10, kids_max_age: 12, finisher_share_pct: 20 };
  hours: Hours = { mon_sat: { open: '08:00', close: '20:00' }, sun: { open: '12:00', close: '20:00' } };
  online = { on: true, lead: 60, days: 30, duration: 120, max_open: 3, phone: '', location: '' };
  mpesa = { method: 'mpesa_paybill', name: 'DANTESRAS BEAUTY HUB' };

  async ionViewWillEnter() {
    this.ready.set(false);
    await this.data.loadReference().catch(() => undefined);
    for (const k of Object.keys(this.v) as (keyof typeof this.v)[]) this.v[k] = Number(this.data.setting(k, this.v[k]));
    const h = this.data.setting<Partial<Hours>>('salon_hours', {});
    this.hours = { mon_sat: { ...this.hours.mon_sat, ...h.mon_sat }, sun: { ...this.hours.sun, ...h.sun } };
    const s = <T>(k: string, d: T) => this.data.setting<T>(k, d);
    this.online = {
      on: s<unknown>('online_booking', true) !== false, lead: Number(s('online_lead_minutes', 60)), days: Number(s('online_days_ahead', 30)),
      duration: Number(s('online_duration_min', 120)), max_open: Number(s('online_max_open', 3)),
      phone: s('salon_phone', ''), location: s('salon_location', 'Karuguru junction, Kamakis, Ruiru'),
    };
    this.mpesa = { method: s('mpesa_stk_method', 'mpesa_paybill'), name: s('business_name', 'DANTESRAS BEAUTY HUB') };
    this.ready.set(true);
  }
  async save() {
    this.saving.set(true);
    try {
      for (const [k, val] of Object.entries(this.v)) await this.data.saveSetting(k, Number(val));
      await this.data.saveSetting('salon_hours', this.hours);
      const o = this.online;
      const pairs: [string, unknown][] = [
        ['online_booking', !!o.on], ['online_lead_minutes', Number(o.lead)], ['online_days_ahead', Number(o.days)],
        ['online_duration_min', Number(o.duration)], ['online_max_open', Number(o.max_open)],
        ['salon_phone', (o.phone ?? '').trim()], ['salon_location', (o.location ?? '').trim()],
        ['mpesa_stk_method', this.mpesa.method], ['business_name', (this.mpesa.name ?? '').trim() || 'DANTESRAS BEAUTY HUB'],
      ];
      for (const [k, val] of pairs) await this.data.saveSetting(k, val);
      this.ui.toast('Settings saved');
    } catch (e) {
      this.ui.error(e);
    } finally {
      this.saving.set(false);
    }
  }
}
