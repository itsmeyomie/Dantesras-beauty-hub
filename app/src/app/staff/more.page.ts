import { Component, computed, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Ui } from '../core/ui';
import { IonContent, IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  barChartOutline, calendarOutline, cashOutline, checkmarkDoneOutline, constructOutline, cutOutline, peopleOutline, personCircleOutline,
  phonePortraitOutline, pricetagsOutline, receiptOutline, schoolOutline, settingsOutline, speedometerOutline, sunnyOutline,
  walletOutline, mailOutline, storefrontOutline, keyOutline, logOutOutline, bagHandleOutline,
} from 'ionicons/icons';
import { StaffAuthService } from '../core/staff-auth.service';
import { StaffHeaderComponent } from './staff-header.component';

export interface Module { title: string; sub: string; url: string; icon: string; area: string; group: 'Salon' | 'School & owner' | 'Me'; query?: Record<string, string>; }

/** Every staff section in one place – each role only sees what it may open. */
// icons used by the menu, sidebar and tiles
addIcons({
  constructOutline, speedometerOutline, storefrontOutline, sunnyOutline, calendarOutline, mailOutline, cashOutline, receiptOutline, peopleOutline,
  walletOutline, bagHandleOutline, cutOutline, pricetagsOutline, personCircleOutline, schoolOutline, checkmarkDoneOutline, barChartOutline,
  settingsOutline, phonePortraitOutline, keyOutline, logOutOutline,
});

export const MODULES: Module[] = [
  { title: 'Dashboard', sub: 'today', url: '/dashboard', icon: 'speedometer-outline', area: 'dashboard', group: 'Salon' },
  { title: 'Front desk', sub: 'requests, queue', url: '/desk', icon: 'storefront-outline', area: 'desk', group: 'Salon' },
  { title: 'My day', sub: 'my clients', url: '/my-day', icon: 'sunny-outline', area: 'my-day', group: 'Salon' },
  { title: 'Bookings', sub: '& walk-ins', url: '/bookings', icon: 'calendar-outline', area: 'bookings', group: 'Salon' },
  { title: 'Online', sub: 'requests', url: '/bookings', icon: 'mail-outline', area: 'desk', group: 'Salon', query: { tab: 'requests' } },
  { title: 'Checkout', sub: 'quick sale', url: '/checkout', icon: 'cash-outline', area: 'checkout', group: 'Salon' },
  { title: 'Sales', sub: 'void, history', url: '/sales', icon: 'receipt-outline', area: 'sales', group: 'Salon' },
  { title: 'Clients', sub: '& history', url: '/clients', icon: 'people-outline', area: 'clients', group: 'Salon' },
  { title: 'Debts', sub: 'who owes', url: '/debts', icon: 'wallet-outline', area: 'debts', group: 'Salon' },
  { title: 'Bought outside', sub: 'pay shops', url: '/outside', icon: 'bag-handle-outline', area: 'outside', group: 'Salon' },
  { title: 'Service menu', sub: 'prices', url: '/services', icon: 'cut-outline', area: 'services', group: 'Salon' },
  { title: 'Products', sub: '& stock', url: '/products', icon: 'pricetags-outline', area: 'products', group: 'Salon' },
  { title: 'Team', sub: 'commission', url: '/staff-list', icon: 'person-circle-outline', area: 'team', group: 'Salon' },
  { title: 'Students', sub: '& fees', url: '/school', icon: 'school-outline', area: 'school', group: 'School & owner' },
  { title: 'Staff', sub: 'requests', url: '/staff-requests', icon: 'checkmark-done-outline', area: 'staff-requests', group: 'School & owner' },
  { title: 'Roles', sub: '& screens', url: '/roles', icon: 'key-outline', area: 'roles', group: 'School & owner' },
  { title: 'Reports', sub: 'all', url: '/reports', icon: 'bar-chart-outline', area: 'reports', group: 'School & owner' },
  { title: 'Settings', sub: 'rules, hours', url: '/settings', icon: 'settings-outline', area: 'settings', group: 'School & owner' },
  { title: 'Developer', sub: 'panel', url: '/dev', icon: 'construct-outline', area: 'dev', group: 'School & owner' },
  { title: 'Client app', sub: 'preview', url: '/portal', icon: 'phone-portrait-outline', area: 'me', group: 'School & owner' },
  { title: 'My profile', sub: 'photo, password', url: '/me', icon: 'person-circle-outline', area: 'me', group: 'Me' },
];

@Component({
  selector: 'app-more',
  host: { class: 'portal' },
  imports: [RouterLink, IonContent, IonIcon, StaffHeaderComponent],
  template: `
    <ion-content>
      <div class="p-wrap">
        <app-staff-header />
        <h1 class="p-display" style="margin-top:14px">Every<strong>thing</strong></h1>
        @for (g of groups(); track g.name) {
          <div class="p-kicker" style="margin:16px 2px 8px">{{ g.name }}</div>
          <div class="p-tiles">
            @for (m of g.items; track m.title) {
              <a class="p-tile" [routerLink]="m.url" [queryParams]="m.query ?? null" [attr.data-module]="m.title">
                <i><ion-icon [name]="m.icon"></ion-icon></i><b>{{ m.title }}</b><small>{{ m.sub }}</small>
              </a>
            }
          </div>
        }
        <button class="p-btn block ghost" style="margin-top:22px;color:#9b1c1c" (click)="signOut()" data-testid="more-signout">
          <ion-icon name="log-out-outline"></ion-icon>Sign out{{ name() ? ' (' + name() + ')' : '' }}</button>
      </div>
    </ion-content>
  `,
})
export class MorePage {
  private auth = inject(StaffAuthService);
  private ui = inject(Ui);
  private router = inject(Router);
  readonly name = computed(() => this.auth.firstName());
  async signOut() {
    if (!(await this.ui.confirm('Sign out', 'Sign out of the staff app on this phone?', 'Sign out'))) return;
    await this.auth.logout();
    this.ui.toast('Signed out', 'medium');
    void this.router.navigateByUrl('/staff/sign-in', { replaceUrl: true });
  }
  readonly groups = computed(() => {
    this.auth.me();
    const visible = MODULES.filter((m) => this.auth.can(m.area));
    return (['Salon', 'School & owner', 'Me'] as const)
      .map((name) => ({ name, items: visible.filter((m) => m.group === name) }))
      .filter((g) => g.items.length);
  });
}
