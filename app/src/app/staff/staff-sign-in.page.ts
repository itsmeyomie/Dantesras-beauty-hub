import { Component, OnDestroy, OnInit, computed, effect, inject, input, signal } from '@angular/core';
import { environment } from '../../environments/environment';
import { DataService } from '../core/data.service';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { IonContent, IonSpinner } from '@ionic/angular';
import { StaffAuthService, StaffMe, resizePhoto } from '../core/staff-auth.service';
import { Ui } from '../core/ui';

type Mode = 'signin' | 'create' | 'owner' | 'pending' | 'forgot' | 'reset' | 'google-test' | 'google-wait';

/** Staff: sign in, create an account (owner approves), first owner setup, waiting screen. */
@Component({
  selector: 'app-staff-sign-in',
  host: { class: 'portal' },
  imports: [FormsModule, RouterLink, IonContent, IonSpinner],
  template: `
    <ion-content>
      <div class="p-wrap" style="padding-top:max(26px, env(safe-area-inset-top))">
        @if (mode() === 'pending') {
          <div class="p-center" style="margin-top:40px">
            <span class="p-avatar" style="width:96px;height:96px;margin:0 auto">
              @if (pending()?.photo) { <img [src]="pending()!.photo" alt="" class="p-photo" /> } @else { <span>{{ initial(pending()?.name) }}</span> }
            </span>
            <h1 class="p-display" style="margin-top:20px">Waiting <strong>for approval</strong></h1>
            <p class="p-muted" style="margin:12px 10px">Thanks {{ firstName(pending()?.name) }}. The owner will check your request and give you access as
              <b style="color:var(--p-maroon)">{{ roleName(pending()?.wanted_role) }}</b>.</p>
            <span class="p-badge wait" data-testid="pending-badge">Pending</span>
          </div>
          <div class="p-card" style="margin-top:26px"><div class="p-kicker">What next</div>
            <p class="p-small" style="margin:6px 0 0">When the owner approves you, sign in again with your email and password.</p></div>
          <button class="p-btn block ghost" style="margin-top:16px" (click)="mode.set('signin')">Back to sign in</button>
        } @else if (mode() === 'google-wait') {
          <div class="p-empty" style="margin-top:60px"><ion-spinner name="dots"></ion-spinner><br />Signing you in with Google…</div>
          @if (error()) {
            <div class="p-error" data-testid="su-error">{{ error() }}</div>
            <button class="p-btn block ghost" (click)="switch('signin')">Back to sign in</button>
          }
        } @else if (mode() === 'google-test') {
          <div class="p-kicker">Dantesras · staff</div>
          <h1 class="p-display" style="margin-top:6px">Google <strong class="blk">(test)</strong></h1>
          <div class="p-note sim" style="margin-top:14px">Test mode – no Google account is used. Type the staff email to sign in as.</div>
          <label class="p-field"><span>Google email</span>
            <input class="p-input" type="email" [(ngModel)]="f.email" data-testid="sg-test-email" (keyup.enter)="testGoogle()" /></label>
          @if (error()) { <div class="p-error" data-testid="su-error">{{ error() }}</div> }
          <button class="p-btn block" (click)="testGoogle()" [disabled]="busy()" data-testid="sg-test-go">Continue</button>
          <button class="p-link" style="display:block;margin:14px auto" (click)="switch('signin')">Back to sign in</button>
        } @else if (mode() === 'forgot') {
          <div class="p-kicker">Dantesras · staff</div>
          <h1 class="p-display" style="margin-top:6px">Forgot <strong class="blk">password?</strong></h1>
          <p class="p-muted" style="margin:10px 2px 16px">Enter the email you sign in with. We'll send you a 6-digit code to set a new password.</p>
          <label class="p-field"><span>Email</span>
            <input class="p-input" type="email" inputmode="email" autocomplete="email" [(ngModel)]="f.email" (keyup.enter)="sendReset()" data-testid="fp-email" /></label>
          @if (error()) { <div class="p-error" data-testid="su-error">{{ error() }}</div> }
          <button class="p-btn block" (click)="sendReset()" [disabled]="busy()" data-testid="fp-send">
            @if (busy()) { <ion-spinner name="dots"></ion-spinner> } @else { Send code }</button>
          <button class="p-link" style="display:block;margin:14px auto" (click)="switch('signin')">Back to sign in</button>
        } @else if (mode() === 'reset') {
          <div class="p-kicker">Dantesras · staff</div>
          <h1 class="p-display" style="margin-top:6px">New <strong class="blk">password</strong></h1>
          <p class="p-muted" style="margin:10px 2px 14px">If <b>{{ sentTo() }}</b> has a staff account, a 6-digit code is on its way. Check your inbox and spam.
            <button class="p-link" (click)="switch('forgot')">Change email</button></p>
          @if (devCode()) {
            <div class="p-note sim" data-testid="fp-dev-code">Test mode – no email was sent. Your code is <strong>{{ devCode() }}</strong></div>
          }
          <label class="p-field"><span>6-digit code</span>
            <input class="p-input p-code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••" [(ngModel)]="code" data-testid="fp-code" /></label>
          <label class="p-field"><span>New password</span>
            <span class="p-pass">
              <input class="p-input" [type]="showPw() ? 'text' : 'password'" autocomplete="new-password" [(ngModel)]="newPw" data-testid="fp-new" />
              <button type="button" class="p-link" (click)="showPw.set(!showPw())">{{ showPw() ? 'Hide' : 'Show' }}</button>
            </span></label>
          <p class="p-small" [class.p-muted]="newPw.length < 8" [style.color]="newPw.length >= 8 ? '#1e6b34' : null" style="margin:-6px 2px 10px">
            {{ newPw.length >= 8 ? '✓ Good length' : 'At least 8 characters' }}</p>
          <label class="p-field"><span>Repeat new password</span>
            <input class="p-input" [type]="showPw() ? 'text' : 'password'" autocomplete="new-password" [(ngModel)]="newPw2" (keyup.enter)="doReset()" data-testid="fp-new2" /></label>
          @if (error()) { <div class="p-error" data-testid="su-error">{{ error() }}</div> }
          <button class="p-btn block" (click)="doReset()" [disabled]="busy()" data-testid="fp-save">
            @if (busy()) { <ion-spinner name="dots"></ion-spinner> } @else { Save new password }</button>
          <p class="p-center p-small" style="margin-top:14px">
            @if (wait() > 0) { <span class="p-muted">Send a new code in {{ wait() }}s</span> }
            @else { <button class="p-link" (click)="sendReset()">Send a new code</button> }</p>
          <button class="p-link" style="display:block;margin:6px auto" (click)="switch('signin')">Back to sign in</button>
        } @else {
          <div class="p-kicker">Dantesras · staff</div>
          <h1 class="p-display" style="margin-top:6px">
            @switch (mode()) {
              @case ('create') { Create <strong class="blk">your account</strong> }
              @case ('owner') { Set up <strong class="blk">the owner</strong> }
              @default { Staff <strong>sign in</strong> }
            }
          </h1>
          @if (mode() !== 'owner') {
            <div class="p-seg" style="margin-top:16px">
              <button type="button" [class.on]="mode() === 'signin'" (click)="switch('signin')">Sign in</button>
              <button type="button" [class.on]="mode() === 'create'" (click)="switch('create')" data-testid="tab-create">Create account</button>
            </div>
          }
          @if (setupNeeded() && mode() === 'signin') {
            <div class="p-note">First time here? <button class="p-link" (click)="switch('owner')" data-testid="owner-setup">Set up the owner account</button></div>
          }

          @if (mode() === 'create') {
            <label class="p-upload" data-testid="photo-pick">
              <span class="p-avatar" style="width:64px;height:64px;flex:0 0 auto">
                @if (photo()) { <img [src]="photo()" alt="Your photo" class="p-photo" /> } @else { <span>+</span> }
              </span>
              <span><b>{{ photo() ? 'Change photo' : 'Add your photo' }}</b><br /><span class="p-muted p-small">Clients see it when they choose a stylist</span></span>
              <input type="file" accept="image/*" capture="user" (change)="pickPhoto($event)" hidden data-testid="photo-input" />
            </label>
            <label class="p-field"><span>Full name</span><input class="p-input" [(ngModel)]="f.name" autocomplete="name" data-testid="su-name" /></label>
          }
          @if (mode() === 'owner') {
            <label class="p-field" style="margin-top:16px"><span>Your name</span><input class="p-input" [(ngModel)]="f.name" data-testid="su-name" /></label>
          }
          @if (mode() === 'signin') {
            <button class="p-google" (click)="google()" [disabled]="busy()" data-testid="staff-google">
              <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true">
                <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.6 13.2l7.9 6.2C12.4 13.7 17.7 9.5 24 9.5z"/>
                <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.8c4.3-4 6.9-9.9 6.9-17.2z"/>
                <path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.2C.9 16.5 0 20.1 0 24s.9 7.5 2.6 10.8l7.9-6.2z"/>
                <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.8c-2.1 1.4-4.8 2.3-8.5 2.3-6.3 0-11.6-4.2-13.5-9.9l-7.9 6.2C6.6 42.6 14.6 48 24 48z"/>
              </svg>
              Continue with Google
            </button>
            <div class="p-or"><span>or with your password</span></div>
          }
          <label class="p-field" [style.margin-top]="mode() === 'signin' ? '6px' : null"><span>Email</span>
            <input class="p-input" type="email" inputmode="email" autocomplete="email" [(ngModel)]="f.email" data-testid="su-email" /></label>
          @if (mode() === 'create') {
            <label class="p-field"><span>Phone (M-Pesa)</span><input class="p-input" type="tel" inputmode="tel" [(ngModel)]="f.phone" placeholder="07XX XXX XXX" data-testid="su-phone" /></label>
          }
          <label class="p-field"><span>Password</span>
            <input class="p-input" type="password" [autocomplete]="mode() === 'signin' ? 'current-password' : 'new-password'" [(ngModel)]="f.password"
              (keyup.enter)="mode() === 'signin' && submit()" data-testid="su-password" /></label>
          @if (mode() === 'create') {
            <div class="p-kicker" style="color:var(--p-muted);margin:4px 2px 6px">I work as</div>
            <div class="p-pills">
              @for (r of roles(); track r.value) {
                <button class="p-chip" [class.on]="f.role === r.value" (click)="f.role = r.value" [attr.data-role]="r.value">{{ r.label }}</button>
              }
            </div>
            <label class="p-field" style="margin-top:12px"><span>Speciality (shown to clients)</span>
              <input class="p-input" [(ngModel)]="f.specialty" placeholder="e.g. Nails · gel & builder gel" data-testid="su-specialty" /></label>
          }
          @if (error()) { <div class="p-error" data-testid="su-error">{{ error() }}</div> }
          <button class="p-btn block" style="margin-top:8px" (click)="submit()" [disabled]="busy()" data-testid="su-submit">
            @if (busy()) { <ion-spinner name="dots"></ion-spinner> }
            @else { {{ mode() === 'create' ? 'Request access' : mode() === 'owner' ? 'Create owner account' : 'Sign in' }} }
          </button>
          @if (mode() === 'signin') {
            <button class="p-link" style="display:block;margin:14px auto 0" (click)="switch('forgot')" data-testid="forgot-link">Forgot password?</button>
          }
          @if (mode() === 'create') { <p class="p-muted p-small p-center">The owner approves every new account.</p> }
          @if (mode() === 'owner') { <button class="p-link" style="display:block;margin:10px auto" (click)="switch('signin')">Back</button> }
          <a class="p-staff-link" routerLink="/portal">Client app</a>
        }
      </div>
    </ion-content>
  `,
})
export class StaffSignInPage implements OnInit, OnDestroy {
  private auth = inject(StaffAuthService);
  private router = inject(Router);
  private ui = inject(Ui);
  private data = inject(DataService);
  readonly returnUrl = input<string>();
  readonly mode = signal<Mode>('signin');
  readonly busy = signal(false);
  /** picked photo (data URL) – a signal so the preview redraws */
  readonly photo = signal<string | null>(null);
  readonly error = signal('');
  readonly setupNeeded = signal(false);
  readonly pending = signal<StaffMe | null>(null);
  /** jobs someone can ask for (all roles except owner and tutor) */
  readonly roles = computed(() => {
    const list = this.data.roles().filter((r) => r.key !== 'owner' && r.key !== 'tutor').map((r) => ({ value: r.key, label: r.name }));
    return list.length ? list : [{ value: 'stylist', label: 'Stylist' }, { value: 'receptionist', label: 'Receptionist' }, { value: 'manager', label: 'Manager' }];
  });
  f = { name: '', email: '', phone: '', password: '', role: 'stylist', specialty: '' };
  // forgot password
  readonly sentTo = signal('');
  readonly devCode = signal<string | null>(null);
  readonly wait = signal(0);
  readonly showPw = signal(false);
  code = '';
  newPw = '';
  newPw2 = '';
  private timer?: ReturnType<typeof setInterval>;

  ngOnDestroy() {
    clearInterval(this.timer);
  }
  // ---------- Continue with Google ----------
  /** Google sends staff back here with ?code=… (web redirect, or the Android app link) */
  readonly code$ = input<string>(undefined, { alias: 'code' });
  private handledCode = '';
  private readonly onCode = effect(() => {
    const c = this.code$();
    if (c && c !== this.handledCode) {
      this.handledCode = c;
      void this.finishGoogle(c);
    }
  });
  async google() {
    this.error.set('');
    // remember where to go after Google (e.g. /dev); the round trip loses the address
    try { const r = this.returnUrl(); if (r) sessionStorage.setItem('dbh.staff.return', r); } catch { /* private mode */ }
    if (environment.simulateSignIn) return this.mode.set('google-test');
    this.busy.set(true);
    try {
      await this.auth.googleStart();
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
      this.afterLogin(await this.auth.testGoogle(this.f.email));
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy.set(false);
    }
  }
  private async finishGoogle(code: string) {
    this.mode.set('google-wait');
    this.error.set('');
    try {
      this.afterLogin(await this.auth.googleFinish(code));
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    }
  }
  private afterLogin(status: 'approved' | 'pending') {
    if (status === 'pending') {
      this.pending.set(this.auth.me());
      this.mode.set('pending');
      return;
    }
    this.ui.toast(`Welcome, ${this.auth.firstName()}`);
    let back = this.returnUrl();
    try { back ||= sessionStorage.getItem('dbh.staff.return') ?? undefined; sessionStorage.removeItem('dbh.staff.return'); } catch { /* private mode */ }
    void this.router.navigateByUrl(back && !back.startsWith('/staff') ? back : this.auth.home(), { replaceUrl: true });
  }
  async sendReset() {
    this.error.set('');
    if (!this.f.email.trim()) return this.error.set('Enter your email');
    this.busy.set(true);
    try {
      const r = await this.auth.resetCode(this.f.email);
      this.sentTo.set(r.to);
      this.devCode.set(r.dev_code ?? null);
      this.code = '';
      this.mode.set('reset');
      this.wait.set(60);
      clearInterval(this.timer);
      this.timer = setInterval(() => this.wait.update((w) => (w > 0 ? w - 1 : 0)), 1000);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy.set(false);
    }
  }
  async doReset() {
    this.error.set('');
    if (!/^\d{6}$/.test(this.code.trim())) return this.error.set('Enter the 6-digit code from the email');
    if (this.newPw.length < 8) return this.error.set('Use at least 8 characters');
    if (this.newPw !== this.newPw2) return this.error.set('The two passwords are not the same');
    this.busy.set(true);
    try {
      await this.auth.resetPassword(this.sentTo(), this.code.trim(), this.newPw);
      this.f.password = '';
      this.f.email = this.sentTo();
      this.newPw = this.newPw2 = this.code = '';
      clearInterval(this.timer);
      this.mode.set('signin');
      this.ui.toast('Password changed – sign in with your new password');
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy.set(false);
    }
  }

  async ngOnInit() {
    this.setupNeeded.set(await this.auth.setupNeeded().catch(() => false));
  }
  switch(m: Mode) {
    this.mode.set(m);
    this.error.set('');
  }
  initial(n?: string | null) {
    return (n ?? '?').charAt(0).toUpperCase();
  }
  firstName(n?: string | null) {
    return (n ?? '').split(' ')[0];
  }
  roleName(r?: string | null) {
    return this.data.roleName(r || 'stylist');
  }
  async pickPhoto(ev: Event) {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      this.photo.set(await resizePhoto(file));
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    }
  }
  async submit() {
    this.error.set('');
    this.busy.set(true);
    try {
      if (this.mode() === 'create') {
        const s = await this.auth.signup({ ...this.f, email: this.f.email.trim(), photo: this.photo() });
        this.pending.set(s);
        this.mode.set('pending');
      } else if (this.mode() === 'owner') {
        await this.auth.ownerSetup({ name: this.f.name, email: this.f.email.trim(), password: this.f.password });
        this.ui.toast('Owner account ready');
        void this.router.navigateByUrl(this.auth.home(), { replaceUrl: true });
      } else {
        const status = await this.auth.login(this.f.email.trim(), this.f.password);
        if (status === 'pending') {
          this.pending.set(this.auth.me());
          this.mode.set('pending');
        } else {
          this.ui.toast(`Welcome, ${this.auth.firstName()}`);
          const back = this.returnUrl();
          void this.router.navigateByUrl(back && !back.startsWith('/staff') ? back : this.auth.home(), { replaceUrl: true });
        }
      }
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy.set(false);
    }
  }
}
