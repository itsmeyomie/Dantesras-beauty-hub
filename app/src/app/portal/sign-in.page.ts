import { Component, OnDestroy, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonBackButton, IonButtons, IonContent, IonHeader, IonIcon, IonSpinner, IonToolbar } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { chatbubbleEllipsesOutline, logoWhatsapp, mailOutline, shieldCheckmarkOutline } from 'ionicons/icons';
import { Ui } from '../core/ui';
import { OtpChannel, PortalService } from './portal.service';

type Step = 'address' | 'code' | 'name';

@Component({
  selector: 'app-portal-sign-in',
  host: { class: 'portal' },
  imports: [FormsModule, IonHeader, IonToolbar, IonButtons, IonBackButton, IonContent, IonIcon, IonSpinner],
  template: `
    <ion-header><ion-toolbar>
      <ion-buttons slot="start"><ion-back-button defaultHref="/portal" text=""></ion-back-button></ion-buttons>
    </ion-toolbar></ion-header>
    <ion-content>
      <div class="p-wrap">
        @switch (step()) {
          @case ('address') {
            <div class="p-kicker">Dantesras Beauty Hub</div>
            <h1 class="p-h1">Sign in</h1>
            <p class="p-muted">We'll send you a 6-digit code. No password needed.</p>
            <div class="p-seg" role="tablist" style="margin-top:18px">
              <button type="button" [class.on]="channel() === 'sms'" (click)="setChannel('sms')"><ion-icon name="chatbubble-ellipses-outline"></ion-icon>SMS</button>
              <button type="button" [class.on]="channel() === 'whatsapp'" (click)="setChannel('whatsapp')"><ion-icon name="logo-whatsapp"></ion-icon>WhatsApp</button>
              <button type="button" [class.on]="channel() === 'email'" (click)="setChannel('email')"><ion-icon name="mail-outline"></ion-icon>Email</button>
            </div>
            <label class="p-field">
              <span>{{ channel() === 'email' ? 'Email address' : channel() === 'whatsapp' ? 'WhatsApp number' : 'Phone number' }}</span>
              @if (channel() === 'email') {
                <input class="p-input" type="email" inputmode="email" autocomplete="email" placeholder="you@example.com"
                  [(ngModel)]="address" (keyup.enter)="send()" data-testid="signin-address" />
              } @else {
                <input class="p-input" type="tel" inputmode="tel" autocomplete="tel" placeholder="07XX XXX XXX"
                  [(ngModel)]="address" (keyup.enter)="send()" data-testid="signin-address" />
              }
            </label>
            @if (error()) { <div class="p-error">{{ error() }}</div> }
            <button class="p-btn block" (click)="send()" [disabled]="busy()" data-testid="signin-send">
              @if (busy()) { <ion-spinner name="dots"></ion-spinner> } @else { Send code }
            </button>
            <p class="p-muted p-small p-center" style="margin-top:18px">
              <ion-icon name="shield-checkmark-outline" style="vertical-align:-2px"></ion-icon>
              Your number is only used for your bookings and reminders.
            </p>
          }
          @case ('code') {
            <h1 class="p-h1">Enter the code</h1>
            <p class="p-muted">Sent by {{ channelName() }} to <strong>{{ sentTo() }}</strong>.
              <button class="p-link" (click)="step.set('address')">Change</button></p>
            @if (devCode()) {
              <div class="p-note sim" data-testid="dev-code">Test mode – no {{ channelName() }} was sent. Your code is <strong>{{ devCode() }}</strong>
                <button class="p-link" style="color:#f1d27a;margin-left:10px;text-decoration:underline" (click)="code = devCode()!; verify()">Use it</button></div>
            }
            <input class="p-input p-code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••"
              [(ngModel)]="code" (ngModelChange)="code.length === 6 && verify()" data-testid="signin-code" aria-label="6-digit code" />
            @if (error()) { <div class="p-error">{{ error() }}</div> }
            <button class="p-btn block" style="margin-top:12px" (click)="verify()" [disabled]="busy() || code.length !== 6" data-testid="signin-verify">
              @if (busy()) { <ion-spinner name="dots"></ion-spinner> } @else { Continue }
            </button>
            <p class="p-center p-small" style="margin-top:14px">
              @if (wait() > 0) { <span class="p-muted">Send a new code in {{ wait() }}s</span> }
              @else { <button class="p-link" (click)="send()">Send a new code</button> }
            </p>
          }
          @case ('name') {
            <div class="p-kicker">Welcome to Dantesras</div>
            <h1 class="p-h1">What's your name?</h1>
            <p class="p-muted">So the salon knows who's coming.</p>
            <label class="p-field" style="margin-top:16px"><span>Full name</span>
              <input class="p-input" autocomplete="name" [(ngModel)]="name" placeholder="e.g. Grace Wanjiru" data-testid="signin-name" (keyup.enter)="saveName()" /></label>
            @if (channel() === 'email') {
              <label class="p-field"><span>Phone number (for M-Pesa and reminders)</span>
                <input class="p-input" type="tel" inputmode="tel" [(ngModel)]="phone" placeholder="07XX XXX XXX" /></label>
            }
            @if (error()) { <div class="p-error">{{ error() }}</div> }
            <button class="p-btn block" (click)="saveName()" [disabled]="busy()" data-testid="signin-save-name">Continue</button>
          }
        }
      </div>
    </ion-content>
  `,
})
export class PortalSignInPage implements OnDestroy {
  private p = inject(PortalService);
  private ui = inject(Ui);
  private router = inject(Router);
  readonly returnUrl = input<string>();

  readonly step = signal<Step>('address');
  readonly channel = signal<OtpChannel>('sms');
  readonly busy = signal(false);
  readonly error = signal('');
  readonly sentTo = signal('');
  readonly devCode = signal<string | null>(null);
  readonly wait = signal(0);
  readonly channelName = computed(() => ({ sms: 'SMS', whatsapp: 'WhatsApp', email: 'email' })[this.channel()]);
  address = '';
  code = '';
  name = '';
  phone = '';
  private timer?: ReturnType<typeof setInterval>;

  constructor() {
    addIcons({ chatbubbleEllipsesOutline, logoWhatsapp, mailOutline, shieldCheckmarkOutline });
  }
  ngOnDestroy() {
    clearInterval(this.timer);
  }

  setChannel(c: OtpChannel) {
    if (c === 'email' || this.channel() === 'email') this.address = '';
    this.channel.set(c);
    this.error.set('');
  }

  async send() {
    this.error.set('');
    if (!this.address.trim()) return this.error.set(this.channel() === 'email' ? 'Enter your email address' : 'Enter your phone number');
    this.busy.set(true);
    try {
      const r = await this.p.requestCode(this.channel(), this.address.trim());
      this.sentTo.set(this.pretty(r.to));
      this.devCode.set(r.dev_code ?? null);
      this.code = '';
      this.step.set('code');
      this.wait.set(30);
      clearInterval(this.timer);
      this.timer = setInterval(() => this.wait.update((w) => (w > 0 ? w - 1 : 0)), 1000);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy.set(false);
    }
  }

  async verify() {
    if (this.busy() || this.code.length !== 6) return;
    this.error.set('');
    this.busy.set(true);
    try {
      const r = await this.p.verify(this.channel(), this.address.trim(), this.code);
      if (r.is_new) {
        this.name = this.p.me()?.name === 'New client' ? '' : (this.p.me()?.name ?? '');
        this.step.set('name');
      } else this.done();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
      this.code = '';
    } finally {
      this.busy.set(false);
    }
  }

  async saveName() {
    this.error.set('');
    if (this.name.trim().length < 2) return this.error.set('Enter your name');
    this.busy.set(true);
    try {
      await this.p.updateProfile({ name: this.name.trim(), ...(this.phone.trim() ? { phone: this.phone.trim() } : {}) });
      this.done();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy.set(false);
    }
  }

  private done() {
    this.ui.toast(`Welcome${this.p.firstName() ? ', ' + this.p.firstName() : ''}!`);
    void this.router.navigateByUrl(this.returnUrl() || '/portal', { replaceUrl: true });
  }
  private pretty(to: string) {
    return /^254\d{9}$/.test(to) ? `0${to.slice(3, 6)} ${to.slice(6, 9)} ${to.slice(9)}` : to;
  }
}
