import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { IonContent, IonHeader, IonIcon, IonTitle, IonToolbar, ViewWillEnter } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { briefcaseOutline, logOutOutline, personCircleOutline } from 'ionicons/icons';
import { KshPipe, Ui } from '../core/ui';
import { PortalService } from './portal.service';
import { PortalTabsComponent } from './portal-tabs.component';
import { InstallService } from '../core/install.service';

@Component({
  selector: 'app-portal-account',
  host: { class: 'portal' },
  imports: [FormsModule, RouterLink, KshPipe, IonHeader, IonToolbar, IonTitle, IonContent, IonIcon, PortalTabsComponent],
  template: `
    <ion-header><ion-toolbar><ion-title>Account</ion-title></ion-toolbar></ion-header>
    <ion-content>
      <div class="p-wrap">
        @if (p.me(); as me) {
          <div class="p-card p-row">
            <div style="width:54px;height:54px;border-radius:50%;background:var(--p-maroon);color:var(--p-gold-soft);display:grid;place-items:center;font:700 1.3rem 'Playfair Display',serif">
              {{ initials(me.name) }}</div>
            <div class="p-spacer"><div style="font-weight:700;font-size:1.05rem">{{ me.name }}</div>
              <div class="p-muted p-small">{{ me.phone || me.email }}</div></div>
          </div>
          @if (me.balance > 0) {
            <div class="p-note">You have a balance of <strong>{{ me.balance | ksh }}</strong> from a past visit. You can clear it at the salon or by M-Pesa.</div>
          }
          <div class="p-h2">Your details</div>
          <label class="p-field"><span>Full name</span><input class="p-input" [(ngModel)]="f.name" data-testid="acc-name" /></label>
          <label class="p-field"><span>Phone (M-Pesa)</span><input class="p-input" type="tel" inputmode="tel" [(ngModel)]="f.phone" /></label>
          <label class="p-field"><span>Email</span><input class="p-input" type="email" inputmode="email" [(ngModel)]="f.email" /></label>
          <label class="p-field"><span>Area / estate</span><input class="p-input" [(ngModel)]="f.area" placeholder="e.g. Kamakis, Membley" /></label>
          @if (error()) { <div class="p-error">{{ error() }}</div> }
          <button class="p-btn block" (click)="save()" [disabled]="busy()" data-testid="acc-save">Save</button>
          <button class="p-btn block ghost" style="margin-top:10px" (click)="signOut()" data-testid="acc-signout"><ion-icon name="log-out-outline"></ion-icon>Sign out</button>
        } @else {
          <div class="p-empty">
            <ion-icon name="person-circle-outline"></ion-icon>
            Sign in to see your bookings, pay deposits and apply to the school.
            <div style="margin-top:16px"><a class="p-btn" routerLink="/portal/sign-in">Sign in</a></div>
          </div>
        }
        @if (!install.isApp()) {
          <div class="p-card" style="margin-top:22px" data-testid="get-app">
            <b>Get the Dantesras app</b>
            <p class="p-muted p-small" style="margin:4px 0 10px">Book faster and get notified when the salon confirms.</p>
            <div class="p-row" style="gap:8px;flex-wrap:wrap">
              @if (install.canInstall()) { <button class="p-btn small" (click)="install.install()" data-testid="install-app">Install on this phone</button> }
              <a class="p-btn small ghost" href="download/Dantesras.apk" download>Android app (APK)</a>
            </div>
            @if (!install.canInstall()) { <p class="p-muted p-small" style="margin:8px 0 0">iPhone: tap Share → "Add to Home Screen".</p> }
          </div>
        }
        <a class="p-card p-row" routerLink="/staff/sign-in" style="margin-top:22px;text-decoration:none;color:inherit" data-testid="staff-entry">
          <span class="p-round ink"><ion-icon name="briefcase-outline"></ion-icon></span>
          <span class="p-spacer"><b>Work at Dantesras?</b><br /><span class="p-muted p-small">Owner and staff sign in here</span></span>
          <span class="p-btn small">Staff sign-in</span>
        </a>
        <p class="p-center p-small" style="margin-top:14px"><a class="p-link" routerLink="/portal/privacy" data-testid="privacy-link">How we use your details (privacy)</a></p>
      </div>
    </ion-content>
    <app-portal-tabs />
  `,
})
export class PortalAccountPage implements ViewWillEnter {
  readonly p = inject(PortalService);
  readonly install = inject(InstallService);
  private ui = inject(Ui);
  private router = inject(Router);
  readonly busy = signal(false);
  readonly error = signal('');
  f = { name: '', phone: '', email: '', area: '' };

  constructor() {
    addIcons({ logOutOutline, personCircleOutline, briefcaseOutline });
  }
  async ionViewWillEnter() {
    try {
      const me = this.p.signedIn() ? await this.p.loadMe() : null;
      if (me) this.f = { name: me.name, phone: me.phone ?? '', email: me.email ?? '', area: me.area ?? '' };
    } catch (e) {
      this.ui.error(e);
    }
  }
  initials(n: string) {
    return n.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0].toUpperCase()).join('');
  }
  async save() {
    this.error.set('');
    this.busy.set(true);
    try {
      await this.p.updateProfile(this.f);
      this.ui.toast('Saved');
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy.set(false);
    }
  }
  async signOut() {
    await this.p.signOut();
    this.ui.toast('Signed out', 'medium');
    void this.router.navigateByUrl('/portal');
  }
}
