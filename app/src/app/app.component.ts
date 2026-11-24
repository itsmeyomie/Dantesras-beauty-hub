import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { IonApp, IonContent, IonIcon, IonMenu, IonMenuToggle, IonRouterOutlet, IonSplitPane } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { barChartOutline, calendarOutline, cashOutline, logOutOutline, peopleOutline, personOutline, schoolOutline, sparklesOutline, speedometerOutline, storefrontOutline, appsOutline, walletOutline, sunnyOutline } from 'ionicons/icons';
import { DataService } from './core/data.service';
import { StaffAuthService } from './core/staff-auth.service';
import { Ui } from './core/ui';
import { MODULES } from './staff/more.page';
import { APP_AUTH_CALLBACK } from './portal/portal.service';

interface Tab { label: string; url: string; icon: string; query?: Record<string, string>; area?: string; }

/** Bottom tabs per role (phones). Everything else is under More. */
const TABS: Record<string, Tab[]> = {
  owner: [
    { label: 'Home', url: '/dashboard', icon: 'speedometer-outline' }, { label: 'Bookings', url: '/bookings', icon: 'calendar-outline' },
    { label: 'Checkout', url: '/checkout', icon: 'cash-outline' }, { label: 'Team', url: '/staff-list', icon: 'people-outline' },
    { label: 'More', url: '/more', icon: 'apps-outline' },
  ],
  receptionist: [
    { label: 'Desk', url: '/desk', icon: 'storefront-outline' }, { label: 'Bookings', url: '/bookings', icon: 'calendar-outline' },
    { label: 'Checkout', url: '/checkout', icon: 'cash-outline' }, { label: 'Clients', url: '/clients', icon: 'people-outline' },
    { label: 'More', url: '/more', icon: 'apps-outline' },
  ],
  stylist: [
    { label: 'Today', url: '/my-day', icon: 'sunny-outline' }, { label: 'Calendar', url: '/my-calendar', icon: 'calendar-outline' },
    { label: 'Checkout', url: '/checkout', icon: 'cash-outline' }, { label: 'Earnings', url: '/my-earnings', icon: 'wallet-outline' },
    { label: 'Me', url: '/me', icon: 'person-outline' },
  ],
};
TABS['manager'] = TABS['owner'];

/** Tabs for roles the owner created, in order of importance; each shows only if the role has that screen. */
const ANY_TABS: Tab[] = [
  { label: 'Home', url: '/dashboard', icon: 'speedometer-outline', area: 'dashboard' },
  { label: 'Desk', url: '/desk', icon: 'storefront-outline', area: 'desk' },
  { label: 'Today', url: '/my-day', icon: 'sunny-outline', area: 'my-day' },
  { label: 'Bookings', url: '/bookings', icon: 'calendar-outline', area: 'bookings' },
  { label: 'Checkout', url: '/checkout', icon: 'cash-outline', area: 'checkout' },
  { label: 'Clients', url: '/clients', icon: 'people-outline', area: 'clients' },
  { label: 'Earnings', url: '/my-earnings', icon: 'wallet-outline', area: 'my-day' },
  { label: 'Sales', url: '/sales', icon: 'cash-outline', area: 'sales' },
  { label: 'Students', url: '/school', icon: 'school-outline', area: 'school' },
  { label: 'Team', url: '/staff-list', icon: 'people-outline', area: 'team' },
  { label: 'Reports', url: '/reports', icon: 'bar-chart-outline', area: 'reports' },
];
const AREA_OF: Record<string, string> = {
  '/dashboard': 'dashboard', '/desk': 'desk', '/my-day': 'my-day', '/my-calendar': 'my-day', '/my-earnings': 'my-day', '/bookings': 'bookings',
  '/checkout': 'checkout', '/clients': 'clients', '/staff-list': 'team', '/sales': 'sales', '/school': 'school', '/reports': 'reports', '/more': 'more', '/me': 'me',
};

@Component({
  selector: 'app-root',
  imports: [IonApp, IonSplitPane, IonMenu, IonContent, IonMenuToggle, IonIcon, IonRouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <ion-app [class.staff-ui]="kind() === 'staff'">
      <ion-split-pane contentId="main" when="lg" [disabled]="kind() !== 'staff'">
        <ion-menu contentId="main" type="overlay" [disabled]="kind() !== 'staff' || !wide()" class="staff-menu">
          <ion-content>
            <div class="sb portal">
              <div class="brand">DANTESRAS</div>
              <div class="tag">Beauty Hub · Hair and Beauty School</div>
              @if (auth.me(); as me) {
                <a class="who" routerLink="/me">
                  <span class="p-avatar" style="width:42px;height:42px">@if (me.photo) { <img [src]="me.photo" alt="" class="p-photo" /> } @else { <span>{{ me.name.charAt(0) }}</span> }</span>
                  <span><b>{{ me.name }}</b><br /><small>{{ auth.roleLabel() }}</small></span>
                </a>
              }
              @for (g of groups(); track g.name) {
                <div class="grp">{{ g.name }}</div>
                @for (m of g.items; track m.title) {
                  <ion-menu-toggle [autoHide]="false">
                    <a class="it" [routerLink]="m.url" [queryParams]="m.query ?? null" routerLinkActive="on" [routerLinkActiveOptions]="{ exact: !!m.query }" routerDirection="root">
                      <ion-icon [name]="m.icon"></ion-icon><span>{{ m.title }}</span>
                    </a>
                  </ion-menu-toggle>
                }
              }
              <button class="it out" (click)="signOut()"><ion-icon name="log-out-outline"></ion-icon><span>Sign out</span></button>
            </div>
          </ion-content>
        </ion-menu>
        <ion-router-outlet id="main"></ion-router-outlet>
      </ion-split-pane>
      @if (kind() === 'staff' && auth.me() && !wide()) {
        <div class="p-tabs staff-tabs portal" data-testid="staff-tabs">
          <nav aria-label="Staff">
            @for (t of tabs(); track t.url + t.label) {
              <a [routerLink]="t.url" [queryParams]="t.query ?? null" routerLinkActive="active" [attr.aria-label]="t.label" [title]="t.label"><ion-icon [name]="t.icon"></ion-icon>{{ t.label }}</a>
            }
          </nav>
        </div>
      }
    </ion-app>
  `,
  styles: `
    .staff-menu { --width: 260px; --background: transparent; }
    .staff-menu ion-content { --background: rgba(255,255,255,.6); }
    .sb { padding: 22px 14px 30px; font-family: 'Inter', sans-serif; }
    .brand { font: 700 1.35rem 'Playfair Display', serif; letter-spacing: .16em; color: #7b1e2e; padding: 0 8px; }
    .tag { font-size: .7rem; color: #8a7f78; margin: 2px 8px 16px; }
    .who { display: flex; align-items: center; gap: 10px; text-decoration: none; color: #161214; padding: 8px; border-radius: 16px; background: rgba(255,255,255,.7); margin-bottom: 8px; }
    .who small { color: #8a7f78; }
    .grp { font: 600 .62rem 'Inter', sans-serif; letter-spacing: .14em; text-transform: uppercase; color: #c9a227; margin: 14px 10px 4px; }
    .it { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-radius: 14px; color: #161214; text-decoration: none; font-size: .88rem; font-weight: 500;
      border: 0; background: none; width: 100%; cursor: pointer; font-family: inherit; }
    .it ion-icon { font-size: 18px; color: #7b1e2e; }
    .it:hover { background: rgba(123,30,46,.06); }
    .it.on { background: #161214; color: #f1d27a; }
    .it.on ion-icon { color: #f1d27a; }
    .it.out { margin-top: 12px; color: #8a7f78; }
  `,
})
export class AppComponent implements OnInit {
  private data = inject(DataService);
  private ui = inject(Ui);
  private router = inject(Router);
  readonly auth = inject(StaffAuthService);
  private readonly url = signal(location.pathname);
  readonly wide = signal(window.innerWidth >= 992);
  /** portal = client app · auth = staff sign-in · staff = staff app */
  readonly kind = computed(() => {
    const u = this.url();
    return u === '/' || u.startsWith('/portal') ? 'portal' : u.startsWith('/staff/sign-in') ? 'auth' : 'staff';
  });
  /** The role's usual tabs, minus screens it can't open, topped up from its other screens. Always ends with More. */
  readonly tabs = computed(() => {
    this.auth.me();
    const base = (TABS[this.auth.role() ?? ''] ?? []).filter((t) => t.url !== '/more' && t.url !== '/me' && this.auth.can(AREA_OF[t.url] ?? 'me'));
    for (const t of ANY_TABS) {
      if (base.length >= 4) break;
      if (!base.some((b) => b.url === t.url) && this.auth.can(t.area!)) base.push(t);
    }
    const last = TABS[this.auth.role() ?? '']?.at(-1);
    return [...base, last?.url === '/me' ? last : { label: 'More', url: '/more', icon: 'apps-outline' }];
  });
  readonly groups = computed(() => {
    this.auth.me();
    const visible = MODULES.filter((m) => m.area !== 'me' && this.auth.can(m.area));
    return (['Salon', 'School & owner'] as const).map((name) => ({ name, items: visible.filter((m) => m.group === name) })).filter((g) => g.items.length);
  });

  constructor() {
    addIcons({ barChartOutline, schoolOutline, speedometerOutline, calendarOutline, cashOutline, peopleOutline, appsOutline, storefrontOutline, sunnyOutline, walletOutline, personOutline, sparklesOutline, logOutOutline });
    window.addEventListener('resize', () => this.wide.set(window.innerWidth >= 992));
  }

  async ngOnInit() {
    this.router.events.subscribe((e) => {
      if (e instanceof NavigationEnd) this.url.set(e.urlAfterRedirects.split('?')[0]);
    });
    void this.listenForAppLinks();
    if (!this.data.configured) return;
    try {
      await this.data.loadReference();
    } catch (e) {
      this.ui.error(e);
    }
  }
  /** Android app: Google sign-in comes back as ke.dantesras.app://auth-callback?code=… */
  private async listenForAppLinks() {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) return;
    const { App } = await import('@capacitor/app');
    await App.addListener('appUrlOpen', async ({ url }) => {
      if (!url.startsWith(APP_AUTH_CALLBACK)) return;
      const code = new URL(url.replace(/^[a-z.]+:\/\//, 'https://x/')).searchParams.get('code');
      const { Browser } = await import('@capacitor/browser');
      await Browser.close().catch(() => undefined);
      if (code) void this.router.navigate(['/portal/sign-in'], { queryParams: { code } });
    });
  }
  async signOut() {
    await this.auth.logout();
    void this.router.navigateByUrl('/staff/sign-in', { replaceUrl: true });
  }
}
