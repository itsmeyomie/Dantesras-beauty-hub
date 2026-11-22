import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonInput, IonItem, IonMenuButton, IonModal, IonSelect,
  IonSelectOption, IonTitle, IonToolbar,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { addOutline } from 'ionicons/icons';
import { DataService } from '../core/data.service';
import { Product } from '../core/models';
import { NotConfiguredComponent } from '../core/not-configured.component';
import { KshPipe, Ui } from '../core/ui';

@Component({
  selector: 'app-products',
  imports: [FormsModule, KshPipe, IonHeader, IonToolbar, IonButtons, IonMenuButton, IonTitle, IonContent, IonButton, IonIcon, IonModal, IonItem, IonInput, IonSelect, IonSelectOption, NotConfiguredComponent],
  template: `
    <ion-header><ion-toolbar>
      <ion-buttons slot="start"><ion-menu-button></ion-menu-button></ion-buttons>
      <ion-title>Products</ion-title>
      <ion-buttons slot="end"><ion-button (click)="edit(null)"><ion-icon slot="start" name="add-outline"></ion-icon>New</ion-button></ion-buttons>
    </ion-toolbar></ion-header>
    <ion-content>
      <div class="page-wrap">
        <app-not-configured />
        @if (pending().length) {
          <div class="notice"><strong>{{ pending().length }} product(s) waiting for owner approval.</strong> They can't be sold until approved.</div>
        }
        @if (low().length) {
          <div class="notice" style="background:#fdeeee;border-color:#e3a0a0"><strong class="maroon">Low stock:</strong> {{ lowNames() }}</div>
        }
        <div class="card">
          @if (!data.products().length) { <div class="empty">No products yet. Add extension hair, oils, nail products…</div> }
          <table class="t">
            @if (data.products().length) {
              <thead><tr><th>Product</th><th class="num">Price</th><th class="num">In stock</th><th class="num">Comm.</th><th></th></tr></thead>
            }
            <tbody>
              @for (p of data.products(); track p.id) {
                <tr (click)="edit(p)" style="cursor:pointer" [style.opacity]="p.status === 'inactive' ? 0.45 : 1">
                  <td><strong>{{ p.name }}</strong><br /><span class="muted small">{{ p.category }}</span></td>
                  <td class="num">{{ p.price | ksh }}</td>
                  <td class="num" [class.down]="p.stock_qty <= p.low_stock">{{ p.stock_qty }} {{ p.unit }}</td>
                  <td class="num">{{ p.commission_pct }}%</td>
                  <td class="num">
                    @if (p.status === 'pending') {
                      <ion-button size="small" color="secondary" (click)="approve(p); $event.stopPropagation()">Approve</ion-button>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </div>

      <ion-modal [isOpen]="!!form()" (didDismiss)="form.set(null)" class="wide">
        <ng-template>
          <ion-header><ion-toolbar><ion-title>{{ form()?.id ? 'Edit product' : 'New product' }}</ion-title></ion-toolbar></ion-header>
          <ion-content class="ion-padding">
            @if (form(); as f) {
              <div class="form-grid">
                <ion-item lines="none" class="field"><ion-input label="Name" labelPlacement="stacked" [(ngModel)]="f.name"></ion-input></ion-item>
                <ion-item lines="none" class="field"><ion-input label="Category (e.g. Extension hair)" labelPlacement="stacked" [(ngModel)]="f.category"></ion-input></ion-item>
                <ion-item lines="none" class="field"><ion-input label="Unit (piece, pack, bottle)" labelPlacement="stacked" [(ngModel)]="f.unit"></ion-input></ion-item>
                <ion-item lines="none" class="field"><ion-input label="Selling price (KSh)" labelPlacement="stacked" type="number" [(ngModel)]="f.price"></ion-input></ion-item>
                <ion-item lines="none" class="field"><ion-input label="Buying cost (KSh)" labelPlacement="stacked" type="number" [(ngModel)]="f.cost"></ion-input></ion-item>
                <ion-item lines="none" class="field"><ion-input label="Quantity in stock" labelPlacement="stacked" type="number" [(ngModel)]="f.stock_qty"></ion-input></ion-item>
                <ion-item lines="none" class="field"><ion-input label="Low-stock alert at" labelPlacement="stacked" type="number" [(ngModel)]="f.low_stock"></ion-input></ion-item>
                <ion-item lines="none" class="field"><ion-input label="Commission % (0–50)" labelPlacement="stacked" type="number" [(ngModel)]="f.commission_pct"></ion-input></ion-item>
                <ion-item lines="none" class="field">
                  <ion-select label="Status" labelPlacement="stacked" interface="popover" [(ngModel)]="f.status">
                    <ion-select-option value="active">Active</ion-select-option>
                    <ion-select-option value="pending">Pending owner approval</ion-select-option>
                    <ion-select-option value="inactive">Inactive</ion-select-option>
                  </ion-select>
                </ion-item>
              </div>
              <div class="row" style="margin-top:12px">
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
})
export class ProductsPage {
  readonly data = inject(DataService);
  private ui = inject(Ui);
  readonly form = signal<Partial<Product> | null>(null);
  readonly busy = signal(false);
  readonly pending = computed(() => this.data.products().filter((p) => p.status === 'pending'));
  readonly low = computed(() => this.data.products().filter((p) => p.status === 'active' && Number(p.stock_qty) <= Number(p.low_stock)));

  constructor() {
    addIcons({ addOutline });
  }
  lowNames() {
    return this.low().map((p) => `${p.name} (${p.stock_qty})`).join(', ');
  }
  edit(p: Product | null) {
    // New products added by staff start as "pending" until the owner approves (login will enforce this later).
    this.form.set(p ? { ...p } : { unit: 'piece', price: 0, cost: 0, stock_qty: 0, low_stock: 0, commission_pct: 0, status: 'pending' });
  }
  async save(f: Partial<Product>) {
    if (!f.name?.trim()) return this.ui.toast('Enter a product name', 'danger');
    const pct = Number(f.commission_pct ?? 0);
    if (pct < 0 || pct > 50) return this.ui.toast('Commission must be between 0 and 50%', 'danger');
    this.busy.set(true);
    try {
      await this.data.saveProduct({
        ...f, name: f.name.trim(), price: Number(f.price), cost: Number(f.cost), stock_qty: Number(f.stock_qty),
        low_stock: Number(f.low_stock), commission_pct: pct,
      });
      this.ui.toast('Product saved');
      this.form.set(null);
    } catch (e) {
      this.ui.error(e);
    } finally {
      this.busy.set(false);
    }
  }
  async approve(p: Product) {
    try {
      await this.data.saveProduct({ id: p.id, status: 'active' });
      this.ui.toast(`${p.name} approved`);
    } catch (e) {
      this.ui.error(e);
    }
  }
}
