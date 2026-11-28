import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonInput, IonItem, IonMenuButton, IonModal, IonSelect,
  IonSearchbar, IonSelectOption, IonTitle, IonToggle, IonToolbar,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { addOutline, arrowDownOutline, arrowUpOutline, trashOutline } from 'ionicons/icons';
import { DataService } from '../core/data.service';
import { Category, Service, Variant } from '../core/models';
import { NotConfiguredComponent } from '../core/not-configured.component';
import { KshPipe, Ui } from '../core/ui';

@Component({
  selector: 'app-services',
  imports: [FormsModule, KshPipe, IonHeader, IonToolbar, IonButtons, IonMenuButton, IonTitle, IonContent, IonButton, IonIcon, IonModal, IonItem, IonInput, IonSelect, IonSelectOption, IonToggle, IonSearchbar, NotConfiguredComponent],
  template: `
    <ion-header><ion-toolbar>
      <ion-buttons slot="start"><ion-menu-button></ion-menu-button></ion-buttons>
      <ion-title>Service menu</ion-title>
      <ion-buttons slot="end">
        <ion-button (click)="newCategory()">+ Category</ion-button>
        <ion-button (click)="edit(null)"><ion-icon slot="start" name="add-outline"></ion-icon>Service</ion-button>
      </ion-buttons>
    </ion-toolbar></ion-header>
    <ion-content>
      <div class="page-wrap">
        <app-not-configured />
        <ion-searchbar placeholder="Search services" [debounce]="150" [value]="q()" (ionInput)="q.set($any($event).detail.value ?? '')" data-testid="menu-search"></ion-searchbar>
        <p class="muted small">Prices in KSh. "Extended" and other options are variants with their own price. Commission is set per service (0–50%).</p>
        @for (g of grouped(); track g.cat.id; let i = $index, last = $last) {
          <div class="cat-head" data-testid="cat-head">
            <div class="section-title" style="margin:0">{{ g.cat.name }} @if (g.cat.client_type === 'kids') { <span>(ages 0–12)</span> }
              @if (g.cat.staff_only) { <span class="pill cancelled" data-testid="staff-only-pill">staff only</span> }</div>
            <span class="spacer"></span>
            <ion-toggle [checked]="!!g.cat.staff_only" (ionChange)="setStaffOnly(g.cat, $event.detail.checked)" labelPlacement="start" data-testid="cat-staff-only">Staff only</ion-toggle>
            <ion-button fill="clear" size="small" [disabled]="i === 0 || busy() || !!q().trim()" (click)="move(i, -1)" aria-label="Move up" data-testid="cat-up"><ion-icon slot="icon-only" name="arrow-up-outline"></ion-icon></ion-button>
            <ion-button fill="clear" size="small" [disabled]="last || busy() || !!q().trim()" (click)="move(i, 1)" aria-label="Move down" data-testid="cat-down"><ion-icon slot="icon-only" name="arrow-down-outline"></ion-icon></ion-button>
          </div>
          <div class="card">
            <table class="t">
              <thead><tr><th>Service</th><th class="num">Price</th><th class="num">Comm.</th></tr></thead>
              <tbody>
                @for (s of g.services; track s.id) {
                  <tr (click)="edit(s)" style="cursor:pointer" [style.opacity]="s.active ? 1 : 0.45">
                    <td><strong>{{ s.name }}</strong>
                      @for (v of s.service_variants ?? []; track v.id) { <br /><span class="muted small">{{ v.name }}: {{ v.price | ksh }}</span> }
                    </td>
                    <td class="num">{{ priceText(s) }}</td>
                    <td class="num">{{ s.commission_pct }}%</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </div>

      <ion-modal [isOpen]="!!form()" (didDismiss)="form.set(null)" class="wide">
        <ng-template>
          <ion-header><ion-toolbar><ion-title>{{ form()?.id ? 'Edit service' : 'New service' }}</ion-title></ion-toolbar></ion-header>
          <ion-content class="ion-padding">
            @if (form(); as f) {
              <div class="form-grid">
                <ion-item lines="none" class="field"><ion-input label="Name" labelPlacement="stacked" [(ngModel)]="f.name"></ion-input></ion-item>
                <ion-item lines="none" class="field">
                  <ion-select label="Category" labelPlacement="stacked" interface="popover" [(ngModel)]="f.category_id">
                    @for (c of data.categories(); track c.id) { <ion-select-option [value]="c.id">{{ c.name }}</ion-select-option> }
                  </ion-select>
                </ion-item>
                <ion-item lines="none" class="field">
                  <ion-select label="Price type" labelPlacement="stacked" interface="popover" [(ngModel)]="f.price_type">
                    <ion-select-option value="fixed">Fixed price</ion-select-option>
                    <ion-select-option value="range">Range (min – max)</ion-select-option>
                    <ion-select-option value="from">From (no maximum)</ion-select-option>
                  </ion-select>
                </ion-item>
                <ion-item lines="none" class="field"><ion-input [label]="f.price_type === 'fixed' ? 'Price (KSh)' : 'Minimum price (KSh)'" labelPlacement="stacked" type="number" [(ngModel)]="f.price"></ion-input></ion-item>
                @if (f.price_type === 'range') {
                  <ion-item lines="none" class="field"><ion-input label="Maximum price (KSh)" labelPlacement="stacked" type="number" [(ngModel)]="f.max_price"></ion-input></ion-item>
                }
                <ion-item lines="none" class="field"><ion-input label="Commission % (0–50)" labelPlacement="stacked" type="number" min="0" max="50" [(ngModel)]="f.commission_pct"></ion-input></ion-item>
                <ion-item lines="none" class="field"><ion-toggle [(ngModel)]="f.active">Active on the menu</ion-toggle></ion-item>
              </div>
              @if (feeRule()) {
                <div class="section-title">Staff pay for this service (leave blank to use Settings)</div>
                <div class="form-grid">
                  <ion-item lines="none" class="field"><ion-input label="Salon fee (KSh)" labelPlacement="stacked" type="number" min="0" [placeholder]="'Default ' + data.setting('salon_fee', 200)" [(ngModel)]="f.salon_fee" data-testid="svc-salon-fee"></ion-input></ion-item>
                  <ion-item lines="none" class="field"><ion-input label="Finisher fee (KSh)" labelPlacement="stacked" type="number" min="0" [placeholder]="'Default ' + data.setting('finisher_fee', 250)" [(ngModel)]="f.finisher_fee" data-testid="svc-finisher-fee"></ion-input></ion-item>
                  <ion-item lines="none" class="field"><ion-input label="Stylist's share of the rest (%)" labelPlacement="stacked" type="number" min="0" max="100" [placeholder]="'Default ' + data.setting('stylist_balance_pct', 50)" [(ngModel)]="f.stylist_pct" data-testid="svc-stylist-pct"></ion-input></ion-item>
                </div>
              }
              <div class="section-title">Variants (e.g. Extended, Arted, Goddess)</div>
              @for (v of variants; track $index) {
                <div class="row">
                  <ion-item lines="none" class="field" style="flex:2"><ion-input label="Variant name" labelPlacement="stacked" [(ngModel)]="v.name"></ion-input></ion-item>
                  <ion-item lines="none" class="field" style="flex:1"><ion-input label="Price" labelPlacement="stacked" type="number" [(ngModel)]="v.price"></ion-input></ion-item>
                  <ion-button fill="clear" color="medium" (click)="variants.splice($index, 1)" aria-label="Remove variant"><ion-icon slot="icon-only" name="trash-outline"></ion-icon></ion-button>
                </div>
              }
              <ion-button size="small" fill="outline" (click)="variants.push({ name: '', price: 0 })">+ Add variant</ion-button>
              <div class="row" style="margin-top:16px">
                <span class="spacer"></span>
                <ion-button fill="clear" color="medium" (click)="form.set(null)">Cancel</ion-button>
                <ion-button (click)="save(f)" [disabled]="busy()">Save</ion-button>
              </div>
            }
          </ion-content>
        </ng-template>
      </ion-modal>
    </ion-content>
  `,
  styles: [`
    .cat-head { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; margin: 18px 0 6px; }
    .cat-head ion-toggle { font-size: .85rem; margin-right: 4px; }
  `],
})
export class ServicesPage {
  readonly data = inject(DataService);
  private ui = inject(Ui);
  readonly form = signal<Partial<Service> | null>(null);
  readonly busy = signal(false);
  variants: Partial<Variant>[] = [];

  readonly q = signal('');
  readonly grouped = computed(() => {
    const t = this.q().trim().toLowerCase();
    return this.data.categories()
      .map((cat: Category) => ({ cat, services: this.data.services().filter((s) => s.category_id === cat.id
        && (!t || cat.name.toLowerCase().includes(t) || s.name.toLowerCase().includes(t)
            || (s.service_variants ?? []).some((v) => v.name.toLowerCase().includes(t)))) }))
      .filter((g) => !t || g.services.length);
  });

  constructor() {
    addIcons({ addOutline, trashOutline, arrowUpOutline, arrowDownOutline });
  }

  priceText(s: Service) {
    const k = (n: number | null) => Number(n ?? 0).toLocaleString('en-KE');
    if (s.price_type === 'range') return `${k(s.price)} – ${k(s.max_price)}`;
    if (s.price_type === 'from') return `from ${k(s.price)}`;
    return k(s.price);
  }

  /** the owner pays staff with "salon fee + finisher fee, then split" (Settings) */
  feeRule() {
    return this.data.setting<string>('pay_rule', 'percent') === 'fee_split';
  }

  edit(s: Service | null) {
    this.form.set(s ? { ...s } : { price_type: 'fixed', price: 0, commission_pct: 0, active: true, category_id: this.data.categories()[0]?.id });
    this.variants = (s?.service_variants ?? []).map((v) => ({ ...v }));
  }

  async save(f: Partial<Service>) {
    if (!f.name?.trim() || !f.category_id) return this.ui.toast('Enter a name and category', 'danger');
    const pct = Number(f.commission_pct ?? 0);
    if (pct < 0 || pct > 50) return this.ui.toast('Commission must be between 0 and 50%', 'danger');
    if (f.price_type === 'range' && Number(f.max_price) < Number(f.price)) return this.ui.toast('Maximum must be above minimum', 'danger');
    if (this.variants.some((v) => !v.name?.trim())) return this.ui.toast('Every variant needs a name', 'danger');
    // fee-split amounts: blank = the default from Settings
    const amt = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
    const fees = this.feeRule() ? { salon_fee: amt(f.salon_fee), finisher_fee: amt(f.finisher_fee), stylist_pct: amt(f.stylist_pct) } : {};
    if (Object.values(fees).some((v) => v !== null && !(v >= 0))) return this.ui.toast('Pay amounts cannot be negative', 'danger');
    if ((fees.stylist_pct ?? 0) > 100) return this.ui.toast("Stylist's share must be 100% or less", 'danger');
    this.busy.set(true);
    try {
      await this.data.saveService(
        { ...f, ...fees, name: f.name.trim(), price: Number(f.price), commission_pct: pct, max_price: f.price_type === 'range' ? Number(f.max_price) : null },
        this.variants.map((v) => ({ ...v, price: Number(v.price) })),
      );
      this.ui.toast('Service saved');
      this.form.set(null);
    } catch (e) {
      this.ui.error(e);
    } finally {
      this.busy.set(false);
    }
  }

  /** Move a category up or down the menu (clients see the same order). */
  async move(i: number, dir: -1 | 1) {
    const ids = this.data.categories().map((c) => c.id);
    [ids[i], ids[i + dir]] = [ids[i + dir], ids[i]];
    this.busy.set(true);
    try {
      await this.data.orderCategories(ids);
    } catch (e) {
      this.ui.error(e);
    } finally {
      this.busy.set(false);
    }
  }
  /** Staff only: clients don't see these services and can't book them online (e.g. Finishers). */
  async setStaffOnly(cat: Category, on: boolean) {
    if (!!cat.staff_only === on) return;
    try {
      await this.data.saveCategory({ id: cat.id, staff_only: on });
      this.ui.toast(on ? `${cat.name}: hidden from clients` : `${cat.name}: clients can see and book it`);
    } catch (e) {
      this.ui.error(e);
    }
  }

  async newCategory() {
    const name = await this.ui.prompt('New category', 'e.g. Lashes');
    if (!name) return;
    try {
      await this.data.saveCategory({ name, client_type: 'any', sort: this.data.categories().length + 1 });
      this.ui.toast('Category added');
    } catch (e) {
      this.ui.error(e);
    }
  }
}
