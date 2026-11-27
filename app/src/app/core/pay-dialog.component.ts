import { Component, inject, input, output, signal } from '@angular/core';
import { IonButton, IonLabel, IonSegment, IonSegmentButton } from '@ionic/angular';
import { StkPurpose } from './mpesa.service';
import { PaymentInput } from './models';
import { PaymentEntryComponent, paymentError } from './payment-entry.component';
import { StkPushComponent } from './stk-push.component';
import { KshPipe, Ui } from './ui';

export interface StkTarget { purpose: StkPurpose; booking_id?: string; sale_id?: string; student_id?: string; phone?: string | null;
  /** a number is saved for this client (staff don't see it; the prompt can still go to it) */
  saved?: boolean; }

/**
 * Generic "receive a payment" box – used for debts, deposits and school fees.
 * Two ways: record a payment already made (cash / M-Pesa code), or send an M-Pesa prompt (STK push).
 */
@Component({
  selector: 'app-pay-dialog',
  imports: [PaymentEntryComponent, StkPushComponent, IonButton, IonSegment, IonSegmentButton, IonLabel, KshPipe],
  template: `
    @if (due() !== null) { <p>Balance due: <strong>{{ due() | ksh }}</strong></p> }
    @if (stk()) {
      <ion-segment [value]="mode()" (ionChange)="mode.set($any($event.detail.value))" class="mode">
        <ion-segment-button value="stk"><ion-label>M-Pesa prompt</ion-label></ion-segment-button>
        <ion-segment-button value="record"><ion-label>Record payment</ion-label></ion-segment-button>
      </ion-segment>
    }
    @if (stk() && mode() === 'stk') {
      <app-stk-push [purpose]="stk()!.purpose" [bookingId]="stk()!.booking_id" [saleId]="stk()!.sale_id" [studentId]="stk()!.student_id"
        [phone]="stk()!.phone ?? null" [savedNumber]="!!stk()!.saved" [amount]="due()" [maxAmount]="due()" (paid)="done.emit()" (cancelled)="cancelled.emit()" />
    } @else {
      <app-payment-entry [p]="p" />
      <div class="row">
        <span class="spacer"></span>
        <ion-button fill="clear" color="medium" (click)="cancelled.emit()">Cancel</ion-button>
        <ion-button (click)="submit()" [disabled]="busy()">{{ okText() }}</ion-button>
      </div>
    }
  `,
  styles: `.mode { margin-bottom: 14px; }`,
})
export class PayDialogComponent {
  private ui = inject(Ui);
  readonly due = input<number | null>(null);
  readonly okText = input('Record payment');
  readonly pay = input.required<(p: PaymentInput) => Promise<unknown>>();
  /** When set, offers "M-Pesa prompt" (STK push) for this booking / sale / student. */
  readonly stk = input<StkTarget | null>(null);
  readonly done = output<void>();
  readonly cancelled = output<void>();
  readonly busy = signal(false);
  readonly mode = signal<'stk' | 'record'>('stk');
  p: PaymentInput = { method: 'cash', amount: null };

  async submit() {
    if (!this.p.amount || this.p.amount <= 0) return this.ui.toast('Enter the amount', 'danger');
    const due = this.due();
    if (due !== null && this.p.amount > due + 0.001) return this.ui.toast('Amount is more than the balance', 'danger');
    const err = paymentError(this.p);
    if (err) return this.ui.toast(err, 'danger');
    this.busy.set(true);
    try {
      await this.pay()(this.p);
      this.ui.toast('Payment recorded');
      this.p = { method: 'cash', amount: null };
      this.done.emit();
    } catch (e) {
      this.ui.error(e);
    } finally {
      this.busy.set(false);
    }
  }
}
