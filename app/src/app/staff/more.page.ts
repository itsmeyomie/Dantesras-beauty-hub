import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonContent, IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  barChartOutline, calendarOutline, cashOutline, checkmarkDoneOutline, cutOutline, peopleOutline, personCircleOutline,
  phonePortraitOutline, pricetagsOutline, receiptOutline, schoolOutline, settingsOutline, speedometerOutline, sunnyOutline,
  walletOutline, mailOutline, storefrontOutline,
} from 'ionicons/icons';
import { StaffAuthService } from '../core/staff-auth.service';
import { StaffHeaderComponent } from './staff-header.component';

export interface Module { title: string; sub: string; url: string; icon: string; area: string; group: 'Salon' | 'School & owner' | 'Me'; query?: Record<string, string>; }

/** Every staff section in one place – each role only sees what it may open. */
// icons used by the menu, sidebar and tiles
addIcons({
  speedometerOutline, storefrontOutline, sunnyOutline, calendarOutline, mailOutline, cashOutline, receiptOutline, peopleOutline,
  walletOutline, cutOutline, pricetagsOutline, personCircleOutline, schoolOutline, checkmarkDoneOutline, barChartOutline,
  settingsOutline, phonePortraitOutline,
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
  { title: 'Service menu', sub: 'prices', url: '/services', icon: 'cut-outline', area: 'services', group: 'Salon' },
  { title: 'Products', sub: '& stock', url: '/products', icon: 'pricetags-outline', area: 'products', group: 'Salon' },
  { title: 'Team', sub: 'commission', url: '/staff-list', icon: 'person-circle-outline', area: 'team', group: 'Salon' },
  { title: 'Students', sub: '& fees', url: '/school', icon: 'school-outline', area: 'school', group: 'School & owner' },
  { title: 'Staff', sub: 'requests', url: '/staff-requests', icon: 'checkmark-done-outline', area: 'staff-requests', group: 'School & owner' },
  { title: 'Reports', sub: 'all', url: '/reports', icon: 'bar-chart-outline', area: 'reports', group: 'School & owner' },
  { title: 'Settings', sub: 'rules, hours', url: '/settings', icon: 'settings-outline', area: 'settings', group: 'School & owner' },
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
      </div>
    </ion-content>
  `,
})
export class MorePage {
  private auth = inject(StaffAuthService);
  readonly groups = computed(() => {
    this.auth.me();
    const visible = MODULES.filter((m) => this.auth.can(m.area));
    return (['Salon', 'School & owner', 'Me'] as const)
      .map((name) => ({ name, items: visible.filter((m) => m.group === name) }))
      .filter((g) => g.items.length);
  });
}
