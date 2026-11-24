import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { IonContent, IonIcon, IonRefresher, IonRefresherContent, ViewWillEnter } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  brushOutline, chevronForwardOutline, colorPaletteOutline, happyOutline, leafOutline, locationOutline, logoWhatsapp,
  sparklesOutline, timeOutline, callOutline, searchOutline, notificationsOutline,
} from 'ionicons/icons';
import { Ui, ksh } from '../core/ui';
import { MyBooking, PortalService, STATUS_TEXT } from './portal.service';
import { PortalTabsComponent } from './portal-tabs.component';
import { NotifyService } from '../core/notify.service';

const CAT_ICONS: Record<string, string> = {
  'Nails': 'color-palette-outline', 'Kids Hair': 'happy-outline', 'Adult Hair': 'brush-outline',
  'Treatments & Care': 'leaf-outline', 'Locs & Undo': 'sparkles-outline',
};

@Component({
  selector: 'app-portal-home',
  host: { class: 'portal' },
  imports: [IonContent, IonIcon, IonRefresher, IonRefresherContent, RouterLink, DatePipe, PortalTabsComponent],
  template: `
    <ion-content>
      <ion-refresher slot="fixed" (ionRefresh)="refresh($event)"><ion-refresher-content></ion-refresher-content></ion-refresher>
      <div class="p-wrap">
        <div class="p-top">
          <a class="p-avatar" [routerLink]="p.signedIn() ? '/portal/account' : '/portal/sign-in'" aria-label="Account"><span>{{ initial() }}</span></a>
          <div class="p-icons">
            <a class="p-glass-btn" routerLink="/portal/book" aria-label="Find a service"><ion-icon name="search-outline"></ion-icon></a>
            <a class="p-glass-btn" [routerLink]="p.signedIn() ? '/portal/notifications' : '/portal/sign-in'" aria-label="Notifications" data-testid="bell"><ion-icon name="notifications-outline"></ion-icon>
              @if (notify.unread()) { <span class="dot-badge" data-testid="bell-count">{{ notify.unread() }}</span> }</a>
          </div>
        </div>
        <p class="p-hey">Hey <b>{{ p.firstName() || 'beautiful' }}</b>,</p>
        <h1 class="p-display" data-testid="brand-title">Bo<span class="p-oo tint"></span>k your <strong class="blk">beauty moment</strong></h1>

        <div class="p-chips" style="margin-top:16px">
          <button class="p-chip on">All</button>
          @for (cat of p.catalog()?.categories ?? []; track cat.id) {
            <button class="p-chip" (click)="openCategory(cat.id)">{{ cat.name }}</button>
          }
        </div>

        @if (featured(); as s) {
          <section class="p-feature" data-testid="featured">
            <div class="art">@if (s.photo) { <img [src]="s.photo" [alt]="s.name" /> } @else { {{ s.name.charAt(0) }} }</div>
            <div class="meta">
              <div class="role">{{ s.specialty || 'Dantesras stylist' }}</div>
              <div class="name">{{ s.name }}</div>
              <div class="row">
                <button class="p-pill-white" (click)="bookWith(s.id)">Bo<span class="p-oo sm"></span>k now</button>
                <button class="p-round ink" style="margin-left:auto" (click)="nextFeatured()" aria-label="Next stylist"><ion-icon name="chevron-forward-outline"></ion-icon></button>
              </div>
            </div>
          </section>
          <div class="p-feature-dots">
            @for (st of p.catalog()?.stylists ?? []; track st.id; let i = $index) {
              <i [class.on]="i === featuredIndex()" (click)="featuredIndex.set(i)"></i>
            }
          </div>
        } @else {
          <div class="p-skeleton" style="height:290px;border-radius:32px;margin-top:18px"></div>
        }

        @if (next(); as b) {
          <div class="p-h2">Your next visit <a routerLink="/portal/bookings">All</a></div>
          <div class="p-card tap" routerLink="/portal/bookings">
            <div class="p-appt">
              <div class="cal"><div class="n">{{ b.scheduled_at | date: 'd' }}</div><div class="m">{{ b.scheduled_at | date: 'MMM' }}</div></div>
              <div class="body">
                <div class="when">{{ b.scheduled_at | date: 'EEEE, HH:mm' }}</div>
                <div class="what">{{ names(b) }}</div>
                <span class="p-badge {{ status(b).tone }}">{{ status(b).label }}</span>
              </div>
            </div>
          </div>
        }

        <div class="p-h2">Our services <a routerLink="/portal/book">See all</a></div>
        @if (p.catalog(); as c) {
          <div class="p-cats">
            @for (cat of c.categories; track cat.id) {
              <div class="p-cat" (click)="openCategory(cat.id)" role="button" [attr.aria-label]="cat.name">
                <div class="ic"><ion-icon [name]="icon(cat.name)"></ion-icon></div>
                <div class="t">{{ cat.name }}</div>
                <div class="s">{{ cat.services.length }} styles</div>
                <div class="f">from <strong>{{ fromPrice(cat.services) }}</strong></div>
              </div>
            }
          </div>
        } @else {
          <div class="p-cats">@for (i of [1, 2, 3, 4]; track i) { <div class="p-skeleton" style="height:112px"></div> }</div>
        }

        <div class="p-h2">Visit us</div>
        <div class="p-card">
          <div class="p-row" style="align-items:flex-start">
            <ion-icon name="location-outline" style="font-size:22px;color:var(--p-maroon);margin-top:2px"></ion-icon>
            <div class="p-spacer">
              <div style="font-weight:600">Dantesras Beauty Hub</div>
              <div class="p-muted p-small">{{ location() }}</div>
            </div>
            <a class="p-btn small ghost" [href]="mapUrl()" target="_blank" rel="noopener">Directions</a>
          </div>
          <div class="p-divider"></div>
          <div class="p-row" style="align-items:flex-start">
            <ion-icon name="time-outline" style="font-size:22px;color:var(--p-maroon);margin-top:2px"></ion-icon>
            <div>
              <div class="p-small"><strong>Mon – Sat</strong> {{ hours().mon_sat }}</div>
              <div class="p-small"><strong>Sunday</strong> {{ hours().sun }}</div>
            </div>
          </div>
          @if (phone()) {
            <div class="p-divider"></div>
            <div class="p-row">
              <a class="p-btn small ghost" [href]="'tel:' + phone()"><ion-icon name="call-outline"></ion-icon>Call</a>
              <a class="p-btn small ghost" [href]="waUrl()" target="_blank" rel="noopener"><ion-icon name="logo-whatsapp"></ion-icon>WhatsApp</a>
            </div>
          }
        </div>

        <div class="p-card tap" routerLink="/portal/school" style="background:#141414;color:#fff">
          <div class="p-row">
            <img src="assets/school-logo.png" alt="" style="width:56px;height:56px;border-radius:14px;object-fit:cover;background:#fff" />
            <div class="p-spacer">
              <div class="p-kicker">Dantesras Hair and Beauty School</div>
              <div style="font-weight:600;margin-top:4px">Learn hairdressing, nails or make-up</div>
            </div>
            <ion-icon name="chevron-forward-outline" style="color:var(--p-gold)"></ion-icon>
          </div>
        </div>

        <a class="p-staff-link" routerLink="/staff/sign-in">Staff sign-in</a>
      </div>
    </ion-content>
    <app-portal-tabs />
  `,
})
export class PortalHomePage implements ViewWillEnter {
  readonly p = inject(PortalService);
  readonly notify = inject(NotifyService);
  private ui = inject(Ui);
  private router = inject(Router);
  readonly bookings = signal<MyBooking[]>([]);
  readonly featuredIndex = signal(0);
  readonly featured = computed(() => {
    const list = this.p.catalog()?.stylists ?? [];
    return list.length ? list[this.featuredIndex() % list.length] : null;
  });
  readonly upcoming = computed(() => this.bookings().filter((b) => ['requested', 'pending', 'booked'].includes(b.status) && new Date(b.scheduled_at).getTime() > Date.now()));
  readonly initial = computed(() => (this.p.me()?.name ?? 'D').charAt(0).toUpperCase());
  readonly next = computed(() =>
    this.bookings().filter((b) => ['requested', 'pending', 'booked'].includes(b.status) && new Date(b.scheduled_at).getTime() > Date.now() - 3600_000)
      .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))[0] ?? null,
  );
  readonly hours = computed(() => {
    const h = this.p.setting<{ mon_sat?: { open: string; close: string }; sun?: { open: string; close: string } }>('salon_hours', {});
    const f = (x?: { open: string; close: string }) => (x ? `${x.open} – ${x.close}` : 'Closed');
    return { mon_sat: f(h.mon_sat), sun: f(h.sun) };
  });
  readonly location = computed(() => this.p.setting('salon_location', 'Karuguru junction, Kamakis, Ruiru'));
  readonly phone = computed(() => this.p.setting<string>('salon_phone', ''));

  constructor() {
    addIcons({ colorPaletteOutline, happyOutline, brushOutline, leafOutline, sparklesOutline, locationOutline, timeOutline, chevronForwardOutline, logoWhatsapp, callOutline, searchOutline, notificationsOutline });
  }

  ionViewWillEnter() {
    void this.load();
  }
  async load() {
    try {
      await this.p.loadCatalog();
      if (this.p.signedIn()) {
        if (!this.p.me()) await this.p.loadMe();
        this.bookings.set(await this.p.bookings());
        void this.notify.refresh('client', this.p.token());
      } else this.bookings.set([]);
    } catch (e) {
      this.ui.error(e);
    }
  }
  async refresh(ev: CustomEvent) {
    await this.p.loadCatalog(true).catch(() => undefined);
    await this.load();
    (ev.target as HTMLIonRefresherElement).complete();
  }

  nextFeatured() {
    const n = this.p.catalog()?.stylists.length ?? 1;
    this.featuredIndex.update((i) => (i + 1) % n);
  }
  bookWith(staffId: string) {
    this.p.updateDraft((d) => ({ ...d, staff_id: staffId }));
    void this.router.navigate(['/portal/book']);
  }
  icon(name: string) {
    return CAT_ICONS[name] ?? 'sparkles-outline';
  }
  fromPrice(services: { price: number }[]) {
    return services.length ? ksh(Math.min(...services.map((s) => Number(s.price)))) : '–';
  }
  openCategory(id: string) {
    void this.router.navigate(['/portal/book'], { queryParams: { category: id } });
  }
  names(b: MyBooking) {
    return b.services.map((s) => s.name).join(', ');
  }
  status(b: MyBooking) {
    return STATUS_TEXT[b.status] ?? { label: b.status, tone: 'info' };
  }
  mapUrl() {
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('Karuguru junction, Kamakis, Ruiru, Kenya');
  }
  waUrl() {
    const d = this.phone().replace(/\D/g, '').replace(/^0/, '254');
    return `https://wa.me/${d}`;
  }
}
