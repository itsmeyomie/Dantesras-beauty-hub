import { Component, OnDestroy, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonBackButton, IonButtons, IonContent, IonHeader, IonIcon, IonSpinner, IonToolbar } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { mailOutline, shieldCheckmarkOutline } from 'ionicons/icons';
import { Ui } from '../core/ui';
import { PortalService } from './portal.service';

type Step = 'start' | 'code' | 'google-test' | 'finishing' | 'name';

/** Client sign-in, free: a 6-digit code by email, or Google. */
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
          @case ('start') {
            <div class="p-kicker">Dantesras Beauty Hub</div>
            <h1 class="p-h1">Sign in</h1>
            <p class="p-muted">Continue with Google, or get a 6-digit code by email. No password needed.</p>

            <button class="p-google" (click)="google()" [disabled]="busy()" data-testid="signin-google">
              <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true">
                <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.6 13.2l7.9 6.2C12.4 13.7 17.7 9.5 24 9.5z"/>
                <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.8c4.3-4 6.9-9.9 6.9-17.2z"/>
                <path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.2C.9 16.5 0 20.1 0 24s.9 7.5 2.6 10.8l7.9-6.2z"/>
                <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.8c-2.1 1.4-4.8 2.3-8.5 2.3-6.3 0-11.6-4.2-13.5-9.9l-7.9 6.2C6.6 42.6 14.6 48 24 48z"/>
              </svg>
              Continue with Google
            </button>
            <div class="p-or"><span>or by email</span></div>

            <label class="p-field">
              <span>Email address</span>
              <input class="p-input" type="email" inputmode="email" autocomplete="email" placeholder="you@example.com"
                [(ngModel)]="email" (keyup.enter)="send()" data-testid="signin-address" />
            </label>
            @if (error()) { <div class="p-error">{{ error() }}</div> }
            <button class="p-btn block" (click)="send()" [disabled]="busy()" data-testid="signin-send">
              @if (busy()) { <ion-spinner name="dots"></ion-spinner> } @else { <ion-icon name="mail-outline"></ion-icon> Email me a code }
            </button>
            <p class="p-muted p-small p-center" style="margin-top:18px">
              <ion-icon name="shield-checkmark-outline" style="vertical-align:-2px"></ion-icon>
              Your details are only used for your bookings. <a class="p-link" href="portal/privacy" (click)="privacy($event)">Privacy</a>
            </p>
          }
          @case ('code') {
            <h1 class="p-h1">Enter the code</h1>
            <p class="p-muted">We emailed a 6-digit code to <strong>{{ sentTo() }}</strong>. Check your inbox (and spam).
              <button class="p-link" (click)="step.set('start')">Change</button></p>
            @if (devCode()) {
              <div class="p-note sim" data-testid="dev-code">Test mode – no email was sent. Your code is <strong>{{ devCode() }}</strong>
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
          @case ('google-test') {
            <h1 class="p-h1">Google (test)</h1>
            <div class="p-note sim">Test mode – no Google account is used. Type any email to sign in as.</div>
            <label class="p-field"><span>Google email</span>
              <input class="p-input" type="email" [(ngModel)]="email" data-testid="google-test-email" /></label>
            <label class="p-field"><span>Name on the Google account</span>
              <input class="p-input" [(ngModel)]="name" data-testid="google-test-name" /></label>
            @if (error()) { <div class="p-error">{{ error() }}</div> }
            <button class="p-btn block" (click)="testGoogle()" [disabled]="busy()" data-testid="google-test-go">Continue</button>
            <p class="p-center"><button class="p-link" (click)="step.set('start')">Back</button></p>
          }
          @case ('finishing') {
            <div class="p-empty"><ion-spinner name="dots"></ion-spinner><br />Signing you in…</div>
            @if (error()) { <div class="p-error">{{ error() }}</div>
              <button class="p-btn block" (click)="step.set('start'); error.set('')">Try again</button> }
          }
          @case ('name') {
            <div class="p-kicker">Welcome to Dantesras</div>
            <h1 class="p-h1">Your details</h1>
            <p class="p-muted">So the salon knows who's coming.</p>
            <label class="p-field" style="margin-top:16px"><span>Full name</span>
              <input class="p-input" autocomplete="name" [(ngModel)]="name" placeholder="e.g. Grace Wanjiru" data-testid="signin-name" (keyup.enter)="saveName()" /></label>
            <label class="p-field"><span>Phone number (for M-Pesa deposits)</span>
              <input class="p-input" type="tel" inputmode="tel" [(ngModel)]="phone" placeholder="07XX XXX XXX" data-testid="signin-phone" /></label>
            @if (error()) { <div class="p-error">{{ error() }}</div> }
            <button class="p-btn block" (click)="saveName()" [disabled]="busy()" data-testid="signin-save-name">Continue</button>
          }
        }
      </div>
    </ion-content>
  `,
  styles: `
    .p-google { width: 100%; display: flex; align-items: center; justify-content: center; gap: 10px; margin-top: 18px; padding: 14px;
      border-radius: 16px; border: 1.5px solid var(--p-line); background: #fff; font: 600 .95rem 'Inter', sans-serif; color: var(--p-ink); cursor: pointer; }
    .p-or { display: flex; align-items: center; gap: 10px; margin: 18px 0 8px; color: var(--p-muted); font-size: .8rem; }
    .p-or::before, .p-or::after { content: ''; flex: 1; height: 1px; background: var(--p-line); }
  `,
})
export class PortalSignInPage implements OnDestroy {
  private p = inject(PortalService);
  private ui = inject(Ui);
  private router = inject(Router);
  readonly returnUrl = input<string>();
  /** Google sends the client back here with ?code=… */
  readonly code$ = input<string>(undefined, { alias: 'code' });

  readonly step = signal<Step>('start');
  readonly busy = signal(false);
  readonly error = signal('');
  readonly sentTo = signal('');
  readonly devCode = signal<string | null>(null);
  readonly wait = signal(0);
  email = '';
  code = '';
  name = '';
  phone = '';
  private next = '/portal';
  private timer?: ReturnType<typeof setInterval>;

  constructor() {
    addIcons({ mailOutline, shieldCheckmarkOutline });
    // back from Google (web redirect, or the Android app link) with ?code=…
    effect(() => {
      const c = this.code$();
      if (c && c !== this.handledCode) {
        this.handledCode = c;
        void this.finishGoogle(c);
      }
    });
  }
  private handledCode = '';
  ngOnDestroy() {
    clearInterval(this.timer);
  }

  async google() {
    this.error.set('');
    if (this.p.simulatedSignIn) {
      this.step.set('google-test');
      return;
    }
    this.busy.set(true);
    try {
      await this.p.googleStart(this.returnUrl());
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy.set(false);
    }
  }
  async testGoogle() {
    this.error.set('');
    this.busy.set(true);
    try {
      this.after(await this.p.testGoogle(this.email, this.name));
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy.set(false);
    }
  }
  private async finishGoogle(code: string) {
    this.step.set('finishing');
    try {
      const r = await this.p.googleFinish(code);
      this.next = r.returnUrl;
      this.after(r);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    }
  }

  async send() {
    this.error.set('');
    if (!this.email.trim()) return this.error.set('Enter your email address');
    this.busy.set(true);
    try {
      const r = await this.p.requestEmailCode(this.email);
      this.sentTo.set(r.to);
      this.devCode.set(r.dev_code ?? null);
      this.code = '';
      this.step.set('code');
      this.wait.set(60);
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
      this.after(await this.p.verifyEmailCode(this.email, this.code));
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
      this.code = '';
    } finally {
      this.busy.set(false);
    }
  }

  /** new clients (or ones without a phone) add their details first */
  private after(r: { is_new: boolean }) {
    if (r.is_new) {
      const me = this.p.me();
      this.name = me?.name === 'New client' ? '' : (me?.name ?? this.name);
      this.phone = me?.phone ?? '';
      this.step.set('name');
    } else this.done();
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
  privacy(ev: Event) {
    ev.preventDefault();
    void this.router.navigateByUrl('/portal/privacy');
  }

  private done() {
    this.ui.toast(`Welcome${this.p.firstName() ? ', ' + this.p.firstName() : ''}!`);
    void this.router.navigateByUrl(this.returnUrl() || this.next, { replaceUrl: true });
  }
}
