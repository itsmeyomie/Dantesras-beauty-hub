import { Component, OnDestroy, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonButton, IonIcon, IonInput, IonItem, IonSpinner } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { alertCircle, checkmarkCircle, phonePortraitOutline } from 'ionicons/icons';
import { MpesaService, SimOutcome, StkPurpose, StkStarted, StkStatus, stkMessage, validPhone } from './mpesa.service';
import { KshPipe, ksh } from './ui';

type Step = 'form' | 'sending' | 'waiting' | 'done' | 'failed';

/** "Pay with M-Pesa": sends the PIN prompt to a phone and waits for the answer. */
@Component({
  selector: 'app-stk-push',
  imports: [FormsModule, IonItem, IonInput, IonButton, IonIcon, IonSpinner, KshPipe],
  template: `
    <div class="stk">
      @switch (step()) {
        @case ('done') {
          <div class="result ok">
            <ion-icon name="checkmark-circle"></ion-icon>
            <div class="big">{{ status()?.amount | ksh }} received</div>
            <div class="code">M-Pesa code <strong>{{ status()?.receipt }}</strong></div>
            @if (status()?.needs_attention) { <p class="warn small">{{ message() }}</p> }
            @if (status()?.simulated) { <p class="muted small">Simulation – no real money moved.</p> }
            <ion-button expand="block" (click)="paid.emit(status()!)">Done</ion-button>
          </div>
        }
        @case ('failed') {
          <div class="result bad">
            <ion-icon name="alert-circle"></ion-icon>
            <div class="big">Not paid</div>
            <p>{{ message() }}</p>
            <ion-button expand="block" (click)="step.set('form')">Try again</ion-button>
            <ion-button expand="block" fill="clear" color="medium" (click)="cancelled.emit()">Close</ion-button>
          </div>
        }
        @case ('waiting') {
          <div class="waiting">
            <div class="pulse"><ion-icon name="phone-portrait-outline"></ion-icon></div>
            <div class="big">Prompt sent to {{ localPhone(started()?.phone) }}</div>
            <p class="muted">{{ audience() === 'client' ? 'Enter your M-Pesa PIN on your phone to pay' : 'Ask the client to enter their M-Pesa PIN' }}
              <strong>{{ amount | ksh }}</strong>.</p>
            <div class="count">{{ secondsLeft() }}s</div>
          </div>
          @if (started()?.simulated) {
            <div class="sim-phone" data-testid="sim-phone">
              <div class="sim-label">Simulation · what the phone shows</div>
              <div class="sim-screen">
                <p>Do you want to pay <strong>{{ amount | ksh }}</strong> to <strong>{{ business() }}</strong>?</p>
                <p class="small">Enter M-PESA PIN:</p>
                <input class="pin" type="password" inputmode="numeric" maxlength="4" [(ngModel)]="pin" aria-label="M-Pesa PIN" placeholder="••••" />
                <div class="sim-actions">
                  <button type="button" (click)="answer('cancel')">Cancel</button>
                  <button type="button" class="send" [disabled]="pin.length !== 4" (click)="answer('pay')">Send</button>
                </div>
              </div>
              <div class="sim-more small">Test other answers:
                <a (click)="answer('insufficient')">not enough money</a> ·
                <a (click)="answer('timeout')">phone off / no answer</a>
              </div>
            </div>
          }
          <ion-button expand="block" fill="clear" color="medium" (click)="stopWaiting()">Stop waiting</ion-button>
        }
        @default {
          <div class="head">
            <div class="badge">M-PESA</div>
            <div>
              <div class="title">Pay with M-Pesa prompt</div>
              <div class="muted small">{{ audience() === 'client' ? 'A PIN prompt will pop up on your phone' : 'A PIN prompt pops up on the client\\'s phone' }}</div>
            </div>
          </div>
          <ion-item lines="none" class="field">
            <ion-input label="M-Pesa phone number" labelPlacement="stacked" type="tel" inputmode="tel" placeholder="07XX XXX XXX"
              [(ngModel)]="phone" data-testid="stk-phone"></ion-input>
          </ion-item>
          @if (editableAmount()) {
            <ion-item lines="none" class="field">
              <ion-input [label]="'Amount (KSh)' + (maxAmount() ? ' – up to ' + fmt(maxAmount()!) : '')" labelPlacement="stacked"
                type="number" inputmode="numeric" [(ngModel)]="amount" data-testid="stk-amount"></ion-input>
            </ion-item>
          }
          @if (error()) { <p class="err small">{{ error() }}</p> }
          <ion-button expand="block" class="pay-btn" (click)="send()" [disabled]="step() === 'sending'" data-testid="stk-send">
            @if (step() === 'sending') { <ion-spinner name="dots"></ion-spinner> } @else { Send prompt · {{ amount | ksh }} }
          </ion-button>
          @if (mpesa.simulation) { <p class="muted small center">Test mode – prompts are simulated on screen, no money moves.</p> }
        }
      }
    </div>
  `,
  styles: `
    .stk { --mp: #1f8f3a; }
    .head { display: flex; gap: 12px; align-items: center; margin-bottom: 12px; }
    .badge { white-space: nowrap; flex: 0 0 auto; background: var(--mp); color: #fff; font-weight: 800; letter-spacing: .06em; font-size: .78rem; padding: 8px 10px; border-radius: 8px; }
    .title { font-weight: 700; font-size: 1.02rem; }
    .pay-btn { --background: var(--mp); --background-activated: #187330; margin-top: 6px; font-weight: 700; text-transform: none; letter-spacing: 0; --border-radius: 12px; min-height: 46px; }
    .err { color: var(--ion-color-danger); margin: 4px 2px; }
    .warn { color: #8a5a00; }
    .center { text-align: center; }
    .waiting { text-align: center; padding: 8px 0 4px; }
    .pulse { width: 74px; height: 74px; margin: 6px auto 10px; border-radius: 50%; display: grid; place-items: center;
      background: #e8f5ec; color: var(--mp); font-size: 34px; animation: pulse 1.6s ease-out infinite; }
    @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(31,143,58,.45); } 100% { box-shadow: 0 0 0 22px rgba(31,143,58,0); } }
    .big { font-size: 1.15rem; font-weight: 700; }
    .count { font-variant-numeric: tabular-nums; color: var(--app-muted); font-size: .85rem; }
    .result { text-align: center; padding: 10px 0; }
    .result ion-icon { font-size: 64px; }
    .result.ok ion-icon { color: var(--mp); }
    .result.bad ion-icon { color: var(--ion-color-danger); }
    .code { margin: 6px 0 14px; letter-spacing: .03em; }
    .sim-phone { margin: 14px auto 4px; max-width: 300px; background: #1b1b1b; border-radius: 22px; padding: 12px 12px 10px; box-shadow: 0 10px 30px rgba(0,0,0,.25); }
    .sim-label { color: #c9a227; font-size: .68rem; text-transform: uppercase; letter-spacing: .08em; text-align: center; margin-bottom: 8px; }
    .sim-screen { background: #f4f4f4; border-radius: 12px; padding: 12px; color: #111; font-size: .9rem; }
    .sim-screen p { margin: 0 0 8px; }
    .pin { width: 100%; box-sizing: border-box; font-size: 1.3rem; letter-spacing: .5em; text-align: center; padding: 8px; border: 1px solid #bbb; border-radius: 8px; background: #fff; }
    .sim-actions { display: flex; gap: 8px; margin-top: 10px; }
    .sim-actions button { flex: 1; padding: 9px; border-radius: 8px; border: 1px solid #bbb; background: #fff; font-weight: 600; cursor: pointer; }
    .sim-actions .send { background: var(--mp); border-color: var(--mp); color: #fff; }
    .sim-actions .send:disabled { opacity: .45; }
    .sim-more { color: #aaa; text-align: center; margin-top: 8px; }
    .sim-more a { color: #e2bd4f; cursor: pointer; text-decoration: underline; }
  `,
})
export class StkPushComponent implements OnInit, OnDestroy {
  readonly mpesa = inject(MpesaService);
  readonly purpose = input.required<StkPurpose>();
  readonly initialAmount = input<number | null>(null, { alias: 'amount' });
  readonly maxAmount = input<number | null>(null);
  readonly editableAmount = input(true);
  readonly initialPhone = input<string | null>(null, { alias: 'phone' });
  readonly bookingId = input<string>();
  readonly saleId = input<string>();
  readonly studentId = input<string>();
  readonly audience = input<'staff' | 'client'>('staff');
  readonly business = input('DANTESRAS BEAUTY HUB');
  readonly paid = output<StkStatus>();
  readonly cancelled = output<void>();

  readonly step = signal<Step>('form');
  readonly started = signal<StkStarted | null>(null);
  readonly status = signal<StkStatus | null>(null);
  readonly error = signal('');
  readonly now = signal(Date.now());
  readonly message = computed(() => (this.status() ? stkMessage(this.status()!) : ''));
  readonly secondsLeft = computed(() => Math.max(0, Math.round((this.deadline - this.now()) / 1000)));

  phone = '';
  amount: number | null = null;
  pin = '';
  private deadline = 0;
  private timer?: ReturnType<typeof setInterval>;
  private poll = { stop: false };

  constructor() {
    addIcons({ checkmarkCircle, alertCircle, phonePortraitOutline });
  }
  ngOnInit() {
    this.phone = this.initialPhone() ?? '';
    this.amount = this.initialAmount();
  }
  ngOnDestroy() {
    this.poll.stop = true;
    clearInterval(this.timer);
  }

  fmt = ksh;
  localPhone(p?: string | null) {
    const d = (p ?? '').replace(/\D/g, '');
    return d.startsWith('254') ? `0${d.slice(3, 6)} ${d.slice(6, 9)} ${d.slice(9)}` : p;
  }

  async send() {
    this.error.set('');
    const amount = Math.round(Number(this.amount));
    if (!validPhone(this.phone)) return this.error.set('Enter a Safaricom number, e.g. 0712 345 678');
    if (!amount || amount < 1) return this.error.set('Enter the amount');
    const max = this.maxAmount();
    if (max && amount > Math.ceil(max)) return this.error.set(`The most you can pay here is ${ksh(max)}`);
    this.amount = amount;
    this.step.set('sending');
    try {
      const s = await this.mpesa.start({
        purpose: this.purpose(), phone: this.phone, amount,
        booking_id: this.bookingId(), sale_id: this.saleId(), student_id: this.studentId(),
      });
      this.started.set(s);
      this.pin = '';
      this.step.set('waiting');
      this.deadline = Date.now() + 120_000;
      clearInterval(this.timer);
      this.timer = setInterval(() => this.now.set(Date.now()), 1000);
      this.poll = { stop: false };
      const final = await this.mpesa.wait(s.id, (st) => this.status.set(st), this.poll);
      clearInterval(this.timer);
      if (this.poll.stop) return;
      this.status.set(final);
      this.step.set(final.status === 'success' ? 'done' : final.status === 'pending' ? 'failed' : 'failed');
    } catch (e) {
      clearInterval(this.timer);
      this.step.set('form');
      this.error.set(e instanceof Error ? e.message : String(e));
    }
  }

  async answer(outcome: SimOutcome) {
    const s = this.started();
    if (!s) return;
    try {
      await this.mpesa.simulate(s.checkout_request_id, outcome);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    }
  }

  stopWaiting() {
    this.poll.stop = true;
    clearInterval(this.timer);
    this.step.set('form');
  }
}
