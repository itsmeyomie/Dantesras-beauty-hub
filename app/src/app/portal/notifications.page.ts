import { Component, inject, signal } from '@angular/core';
import { IonBackButton, IonButtons, IonContent, IonHeader, IonRefresher, IonRefresherContent, IonTitle, IonToolbar, ViewWillEnter } from '@ionic/angular';
import { NotificationsListComponent } from '../core/notifications-list.component';
import { AppNotification, NotifyService } from '../core/notify.service';
import { Ui } from '../core/ui';
import { PortalService } from './portal.service';
import { PortalTabsComponent } from './portal-tabs.component';

/** Client: booking confirmations, reminders, payments, school answers. */
@Component({
  selector: 'app-portal-notifications',
  host: { class: 'portal' },
  imports: [IonHeader, IonToolbar, IonButtons, IonBackButton, IonTitle, IonContent, IonRefresher, IonRefresherContent, NotificationsListComponent, PortalTabsComponent],
  template: `
    <ion-header><ion-toolbar>
      <ion-buttons slot="start"><ion-back-button defaultHref="/portal" text=""></ion-back-button></ion-buttons>
      <ion-title>Notifications</ion-title>
    </ion-toolbar></ion-header>
    <ion-content>
      <ion-refresher slot="fixed" (ionRefresh)="refresh($event)"><ion-refresher-content></ion-refresher-content></ion-refresher>
      <div class="p-wrap" data-testid="notifications"><app-notifications-list [items]="items()" /></div>
    </ion-content>
    <app-portal-tabs />
  `,
})
export class PortalNotificationsPage implements ViewWillEnter {
  private p = inject(PortalService);
  private notify = inject(NotifyService);
  private ui = inject(Ui);
  readonly items = signal<AppNotification[] | null>(null);

  ionViewWillEnter() {
    void this.load();
  }
  async load() {
    const t = this.p.token();
    if (!t) return;
    try {
      this.items.set(await this.notify.list('client', t));
      await this.notify.markRead('client', t);
    } catch (e) {
      this.ui.error(e);
    }
  }
  async refresh(ev: CustomEvent) {
    await this.load();
    (ev.target as HTMLIonRefresherElement).complete();
  }
}
