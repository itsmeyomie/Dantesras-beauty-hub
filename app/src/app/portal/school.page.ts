import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonContent, IonHeader, IonIcon, IonModal, IonTitle, IonToolbar, ViewWillEnter } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { checkmarkOutline, ribbonOutline, timeOutline, walletOutline } from 'ionicons/icons';
import { StkPushComponent } from '../core/stk-push.component';
import { KshPipe, Ui, ymd } from '../core/ui';
import { PCourse, PortalService, SchoolInfo, courseTotal } from './portal.service';
import { PortalTabsComponent } from './portal-tabs.component';

const APP_STATUS: Record<string, { label: string; tone: string }> = {
  requested: { label: 'Application received', tone: 'wait' },
  accepted: { label: 'Accepted – welcome!', tone: 'ok' },
  declined: { label: 'Not accepted', tone: 'bad' },
  withdrawn: { label: 'Withdrawn', tone: 'done' },
};

@Component({
  selector: 'app-portal-school',
  host: { class: 'portal' },
  imports: [FormsModule, DatePipe, KshPipe, IonHeader, IonToolbar, IonTitle, IonContent, IonIcon, IonModal, StkPushComponent, PortalTabsComponent],
  template: `
    <ion-header><ion-toolbar><ion-title>School</ion-title></ion-toolbar></ion-header>
    <ion-content>
      <div class="p-wrap">
        <section class="p-hero" style="background:linear-gradient(150deg,#1b1028 0%,#3b1d5c 55%,#7b1e2e 120%)">
          <div class="p-row" style="gap:14px;position:relative;z-index:1">
            <img src="assets/school-logo.png" alt="Dantesras Hair and Beauty School" style="width:68px;height:68px;border-radius:18px;background:#fff;object-fit:cover" />
            <div><div class="brand" style="font-size:.8rem">DANTESRAS</div><div class="p-serif" style="font-size:1.25rem;font-weight:700">Hair and Beauty School</div></div>
          </div>
          <p style="margin-top:14px">Hands-on training at the salon, Monday – Friday from 9:00 am. Practise on real clients under supervision.</p>
        </section>

        @if (info(); as s) {
          @if (s.enrolments.length) {
            <div class="p-h2">My studies</div>
            @for (e of s.enrolments; track e.id) {
              <div class="p-card" data-testid="enrolment">
                <div class="p-row"><ion-icon name="ribbon-outline" style="font-size:22px;color:var(--p-maroon)"></ion-icon>
                  <div class="p-spacer"><div style="font-weight:700">{{ e.course }}</div>
                    <div class="p-muted p-small">{{ e.name }} · started {{ e.start_date | date: 'd MMM y' }}</div></div>
                  <span class="p-badge {{ e.status === 'active' ? 'ok' : 'done' }}">{{ e.status }}</span></div>
                <div class="p-divider"></div>
                <div class="p-list-line"><span>Course fee</span><span>{{ e.total_fee | ksh }}</span></div>
                <div class="p-list-line"><span>Paid</span><span>{{ e.paid | ksh }}</span></div>
                <div class="p-list-line total"><span>Balance</span><span [style.color]="e.balance > 0 ? 'var(--p-maroon)' : ''" data-testid="balance">{{ e.balance | ksh }}</span></div>
                @if (e.balance > 0) {
                  <button class="p-btn block" style="margin-top:10px" (click)="paying.set(e)"><ion-icon name="wallet-outline"></ion-icon>Pay fees by M-Pesa</button>
                }
              </div>
            }
          }
          @if (s.applications.length) {
            <div class="p-h2">My applications</div>
            @for (a of s.applications; track a.id) {
              <div class="p-card" data-testid="application">
                <div class="p-row"><div class="p-spacer"><div style="font-weight:700">{{ a.course }}</div>
                  <div class="p-muted p-small">For {{ a.name }} · sent {{ a.created_at | date: 'd MMM' }}{{ a.preferred_start ? ' · wants to start ' + (a.preferred_start | date: 'd MMM') : '' }}</div></div></div>
                <div style="margin-top:8px"><span class="p-badge {{ appStatus(a.status).tone }}" data-testid="app-status">{{ appStatus(a.status).label }}</span></div>
                @if (a.response_note) { <div class="p-appt"><div class="msg" style="flex:1">School: {{ a.response_note }}</div></div> }
                @if (a.status === 'requested') { <button class="p-link" (click)="withdraw(a.id)">Withdraw application</button> }
              </div>
            }
          }
        }

        <div class="p-h2">Courses</div>
        @for (c of courses(); track c.id) {
          <div class="p-card" data-testid="course" [attr.data-course]="c.name">
            <div class="p-row" style="align-items:flex-start">
              <div class="p-spacer">
                <div class="p-serif" style="font-size:1.15rem;font-weight:700">{{ c.name }}</div>
                <div class="p-muted p-small" style="margin-top:4px"><ion-icon name="time-outline" style="vertical-align:-2px"></ion-icon> {{ c.duration_value }} {{ c.duration_unit }}</div>
              </div>
              <div style="text-align:right">
                <div style="font-weight:700;color:var(--p-maroon)">{{ c.fee | ksh }}{{ c.fee_type === 'monthly' ? '/month' : '' }}</div>
                @if (c.fee_type === 'monthly') { <div class="p-muted p-small">{{ total(c) | ksh }} in total</div> }
              </div>
            </div>
            <button class="p-btn block ghost" style="margin-top:12px" (click)="apply(c)">Apply</button>
          </div>
        } @empty {
          @for (i of [1, 2, 3]; track i) { <div class="p-skeleton" style="height:120px;margin-bottom:12px"></div> }
        }
        <p class="p-muted p-small p-center">Fees can be paid in instalments by M-Pesa. Bring your ID (or a parent/guardian for under-18s) on the first day.</p>
      </div>

      <!-- application form -->
      <ion-modal [isOpen]="!!applying()" (didDismiss)="closeApply()" class="portal">
        <ng-template>
          <ion-header><ion-toolbar><ion-title>Apply</ion-title>
            <button slot="end" class="p-link" style="padding:8px 14px" (click)="closeApply()">Close</button></ion-toolbar></ion-header>
          <ion-content class="portal">
            <div class="p-wrap" style="padding-top:12px">
              @if (sent()) {
                <div class="p-result">
                  <div class="icon"><ion-icon name="checkmark-outline"></ion-icon></div>
                  <h2>Application sent</h2>
                  <p class="p-muted">The school will contact you about {{ applying()?.name }}. You can follow it here under My applications.</p>
                  <button class="p-btn block" (click)="closeApply()" style="margin-top:12px">Done</button>
                </div>
              } @else if (applying(); as c) {
                <div class="p-kicker">{{ c.duration_value }} {{ c.duration_unit }} · {{ total(c) | ksh }}</div>
                <h2 class="p-h1" style="margin-top:4px">{{ c.name }}</h2>
                <label class="p-field"><span>Student's full name</span><input class="p-input" [(ngModel)]="f.name" data-testid="app-name" /></label>
                <label class="p-field"><span>Student's phone</span><input class="p-input" type="tel" inputmode="tel" [(ngModel)]="f.phone" data-testid="app-phone" /></label>
                <label class="p-field"><span>Email (optional)</span><input class="p-input" type="email" [(ngModel)]="f.email" /></label>
                <label class="p-field"><span>Parent / guardian / next of kin (optional)</span><input class="p-input" [(ngModel)]="f.guardian_name" data-testid="app-guardian" /></label>
                <label class="p-field"><span>Their phone (optional)</span><input class="p-input" type="tel" inputmode="tel" [(ngModel)]="f.guardian_phone" data-testid="app-guardian-phone" /></label>
                <label class="p-field"><span>When would you like to start?</span><input class="p-input" type="date" [min]="today" [(ngModel)]="f.preferred_start" data-testid="app-start" /></label>
                <label class="p-field"><span>Anything else? (optional)</span><textarea class="p-input" [(ngModel)]="f.notes" placeholder="e.g. experience, questions"></textarea></label>
                @if (error()) { <div class="p-error">{{ error() }}</div> }
                <button class="p-btn block" (click)="send()" [disabled]="busy()" data-testid="app-send">Send application</button>
              }
            </div>
          </ion-content>
        </ng-template>
      </ion-modal>

      <!-- pay fees -->
      <ion-modal [isOpen]="!!paying()" (didDismiss)="paying.set(null)" [initialBreakpoint]="0.92" [breakpoints]="[0, 0.92]">
        <ng-template>
          <ion-content class="ion-padding portal">
            @if (paying(); as e) {
              <h3 class="p-serif" style="margin-top:6px">{{ e.course }} fees</h3>
              <p class="p-muted p-small">Balance {{ e.balance | ksh }}. Pay any amount up to the balance.</p>
              <app-stk-push purpose="school_fee" audience="client" [studentId]="e.id" [amount]="e.balance" [maxAmount]="e.balance"
                [phone]="e.phone ?? p.me()?.phone ?? null" (paid)="paying.set(null); load()" (cancelled)="paying.set(null)" />
            }
          </ion-content>
        </ng-template>
      </ion-modal>
    </ion-content>
    <app-portal-tabs />
  `,
})
export class PortalSchoolPage implements ViewWillEnter {
  readonly p = inject(PortalService);
  private ui = inject(Ui);
  private router = inject(Router);
  readonly info = signal<SchoolInfo | null>(null);
  readonly applying = signal<PCourse | null>(null);
  readonly paying = signal<SchoolInfo['enrolments'][number] | null>(null);
  readonly sent = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly courses = computed(() => this.p.catalog()?.courses ?? []);
  readonly today = ymd(new Date());
  readonly total = courseTotal;
  f = this.blank();

  constructor() {
    addIcons({ checkmarkOutline, ribbonOutline, timeOutline, walletOutline });
  }
  ionViewWillEnter() {
    void this.load();
  }
  async load() {
    try {
      await this.p.loadCatalog();
      if (this.p.signedIn()) {
        if (!this.p.me()) await this.p.loadMe();
        this.info.set(await this.p.school());
      } else this.info.set(null);
    } catch (e) {
      this.ui.error(e);
    }
  }
  appStatus(s: string) {
    return APP_STATUS[s] ?? { label: s, tone: 'info' };
  }
  private blank() {
    return { name: '', phone: '', email: '', guardian_name: '', guardian_phone: '', preferred_start: '', notes: '' };
  }
  apply(c: PCourse) {
    if (!this.p.signedIn()) {
      this.ui.toast('Sign in first – it takes a minute', 'medium');
      void this.router.navigate(['/portal/sign-in'], { queryParams: { returnUrl: '/portal/school' } });
      return;
    }
    const me = this.p.me();
    this.f = { ...this.blank(), name: me?.name ?? '', phone: me?.phone ?? '', email: me?.email ?? '' };
    this.error.set('');
    this.sent.set(false);
    this.applying.set(c);
  }
  closeApply() {
    this.applying.set(null);
    if (this.sent()) void this.load();
    this.sent.set(false);
  }
  async send() {
    this.error.set('');
    if (this.f.name.trim().length < 3) return this.error.set("Enter the student's full name");
    if (!this.f.phone.trim()) return this.error.set("Enter the student's phone number");
    this.busy.set(true);
    try {
      await this.p.apply({ course_id: this.applying()!.id, ...this.f });
      this.sent.set(true);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy.set(false);
    }
  }
  async withdraw(id: string) {
    if (!(await this.ui.confirm('Withdraw application', 'Withdraw this application?', 'Withdraw'))) return;
    try {
      await this.p.withdraw(id);
      this.ui.toast('Application withdrawn', 'medium');
      await this.load();
    } catch (e) {
      this.ui.error(e);
    }
  }
}
