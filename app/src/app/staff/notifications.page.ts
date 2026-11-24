import { Component, inject, signal } from '@angular/core';
import { IonContent, IonRefresher, IonRefresherContent, ViewWillEnter } from '@ionic/angular';
import { NotificationsListComponent } from '../core/notifications-list.component';
import { AppNotification, NotifyService } from '../core/notify.service';
import { StaffAuthService } from '../core/staff-auth.service';
import { Ui } from '../core/ui';
import { StaffHeaderComponent } from './staff-header.component';

/** Staff: new requests, clients given to me, accounts to approve … */
@Component({
  selector: 'app-staff-notifications',
  host: { class: 'portal' },
  imports: [IonContent, IonRefresher, IonRefresherContent, StaffHeaderComponent, NotificationsListComponent],
  template: `
    <ion-content>
      <ion-refresher slot="fixed" (ionRefresh)="refresh($event)"><ion-refresher-content></ion-refresher-content></ion-refresher>
      <div class="p-wrap" data-testid="notifications">
        <app-staff-header />
        <h1 class="p-display" style="margin:14px 0">Notifi<strong>cations</strong></h1>
        <app-notifications-list [items]="items()" />
      </div>
    </ion-content>
  `,
})
export class StaffNotificationsPage implements ViewWillEnter {
  private auth = inject(StaffAuthService);
  private notify = inject(NotifyService);
  private ui = inject(Ui);
  readonly items = signal<AppNotification[] | null>(null);

  ionViewWillEnter() {
    void this.load();
  }
  async load() {
    const t = this.auth.token();
    if (!t) return;
    try {
      this.items.set(await this.notify.list('staff', t));
      await this.notify.markRead('staff', t);
    } catch (e) {
      this.ui.error(e);
    }
  }
  async refresh(ev: CustomEvent) {
    await this.load();
    (ev.target as HTMLIonRefresherElement).complete();
  }
}
