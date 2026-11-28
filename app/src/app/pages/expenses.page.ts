import { DatePipe, NgTemplateOutlet, TitleCasePipe } from '@angular/common';
import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonButton, IonButtons, IonContent, IonHeader, IonInput, IonItem, IonLabel, IonMenuButton, IonModal, IonSearchbar, IonSegment,
  IonSegmentButton, IonSelect, IonSelectOption, IonSpinner, IonTextarea, IonTitle, IonToggle, IonToolbar, ViewWillEnter,
} from '@ionic/angular';
import { DataService } from '../core/data.service';
import {
  AuditRow, ExpCategory, Expense, ExpensesService, METHODS, MySummary, PERIODS, Period, ReimbPayment, Reimbursement,
  expState, expTotals, methodLabel, periodRange, reimbLabel, weekOf, ymdOf,
} from '../core/expenses.service';
import { ReportTable, excelCsv, pdfReport, saveFile } from '../core/export';
import { NotConfiguredComponent } from '../core/not-configured.component';
import { StaffAuthService } from '../core/staff-auth.service';
import { KshPipe, Ui, ksh } from '../core/ui';

type OwnerTab = 'dashboard' | 'all' | 'approvals' | 'reimb' | 'categories' | 'reports';
type StaffTab = 'mine' | 'add';
interface Form { id?: string; description: string; amount: number | null; category_id: string | null; expense_date: string; notes: string;
  payment_source: 'SALON_FUNDS' | 'STAFF_PERSONAL'; paid_by_staff: string | null; salon_method: string; }
interface PayForm { r: Reimbursement; e: Expense; amount: number | null; method: string; reference: string; paid_on: string; notes: string; key: string; }
const PAGE = 20;

/**
 * Expenses. Staff: submit what they paid with their own money and follow it until paid back.
 * Owner: dashboard, all expenses, approvals, reimbursements (in parts), categories, reports.
 * The database decides what each person may see and do (exp_* functions).
 */
@Component({
  selector: 'app-expenses',
  imports: [
    DatePipe, NgTemplateOutlet, TitleCasePipe, FormsModule, KshPipe, NotConfiguredComponent, IonHeader, IonToolbar, IonButtons, IonMenuButton, IonTitle, IonContent,
    IonButton, IonModal, IonItem, IonInput, IonTextarea, IonSelect, IonSelectOption, IonSegment, IonSegmentButton, IonLabel,
    IonSearchbar, IonToggle, IonSpinner,
  ],
  template: `
    <ion-header><ion-toolbar>
      <ion-buttons slot="start"><ion-menu-button></ion-menu-button></ion-buttons>
      <ion-title>Expenses</ion-title>
      @if (owner()) { <ion-buttons slot="end"><ion-button (click)="newExpense()" data-testid="exp-add-owner">+ Expense</ion-button></ion-buttons> }
    </ion-toolbar></ion-header>
    <ion-content>
      <div class="page-wrap">
        <app-not-configured />
        @if (owner()) {
          <ion-segment [scrollable]="true" [value]="tab()" (ionChange)="tab.set($any($event.detail.value))" data-testid="exp-tabs">
            <ion-segment-button value="dashboard"><ion-label>Dashboard</ion-label></ion-segment-button>
            <ion-segment-button value="all"><ion-label>All expenses</ion-label></ion-segment-button>
            <ion-segment-button value="approvals"><ion-label>Approvals ({{ pending().length }})</ion-label></ion-segment-button>
            <ion-segment-button value="reimb"><ion-label>Reimbursements</ion-label></ion-segment-button>
            <ion-segment-button value="categories"><ion-label>Categories</ion-label></ion-segment-button>
            <ion-segment-button value="reports"><ion-label>Reports</ion-label></ion-segment-button>
          </ion-segment>
        } @else {
          <ion-segment [value]="stab()" (ionChange)="stab.set($any($event.detail.value))" data-testid="exp-tabs">
            <ion-segment-button value="mine"><ion-label>My expenses</ion-label></ion-segment-button>
            <ion-segment-button value="add"><ion-label>Add expense</ion-label></ion-segment-button>
          </ion-segment>
        }

        @if (loading()) { <div class="center" style="padding:30px"><ion-spinner></ion-spinner></div> }
        @else if (error()) { <div class="card"><p class="down">{{ error() }}</p><ion-button size="small" (click)="load()">Try again</ion-button></div> }
        @else if (!owner()) {
          <!-- ================= STAFF ================= -->
          @if (stab() === 'mine') {
            @if (my(); as m) {
              <div class="grid" style="margin-top:12px" data-testid="my-summary">
                <div class="card stat"><div class="label">Submitted</div><div class="value">{{ m.summary.submitted | ksh }}</div></div>
                <div class="card stat"><div class="label">Pending</div><div class="value">{{ m.summary.pending | ksh }}</div></div>
                <div class="card stat"><div class="label">Approved</div><div class="value">{{ m.summary.approved | ksh }}</div></div>
                <div class="card stat"><div class="label">Rejected</div><div class="value">{{ m.summary.rejected | ksh }}</div></div>
                <div class="card stat"><div class="label">Owed to me</div><div class="value">{{ m.summary.owed | ksh }}</div></div>
                <div class="card stat"><div class="label">Paid back</div><div class="value">{{ m.summary.reimbursed | ksh }}</div></div>
                <div class="card stat"><div class="label">Still owed to me</div><div class="value maroon" data-testid="my-outstanding">{{ m.summary.outstanding | ksh }}</div></div>
              </div>
              <div class="section-title">My expenses</div>
              @for (e of m.expenses; track e.id) {
                <div class="card exp" data-testid="my-expense">
                  <div class="row"><strong>{{ e.description }}</strong><span class="spacer"></span><strong>{{ e.amount | ksh }}</strong></div>
                  <div class="small muted">{{ e.expense_date | date: 'EEE d MMM y' }} · {{ e.category_name }} · sent {{ e.created_at | date: 'd MMM, HH:mm' }}</div>
                  <div class="row" style="margin-top:6px;gap:6px;flex-wrap:wrap">
                    <span class="pill {{ state(e).cls }}" data-testid="my-status">{{ state(e).label }}</span>
                    @if (e.reimbursement; as r) { <span class="small">Paid back {{ r.amount_paid | ksh }} · still owed <strong>{{ r.outstanding | ksh }}</strong></span> }
                  </div>
                  @if (e.rejection_reason) { <div class="small down" style="margin-top:4px">Owner: {{ e.rejection_reason }}</div> }
                  @if (e.notes) { <div class="small muted">My note: {{ e.notes }}</div> }
                  @if (e.reimbursement?.payments?.length) {
                    <table class="t small" style="margin-top:6px"><tbody>
                      @for (p of e.reimbursement!.payments; track p.id) {
                        <tr><td>{{ p.paid_on | date: 'd MMM y' }}</td><td>{{ method(p.method) }}@if (p.reference) { · {{ p.reference }} }</td><td class="num">{{ p.amount | ksh }}</td></tr>
                      }
                    </tbody></table>
                  }
                </div>
              } @empty { <div class="card"><div class="empty">No expenses yet. If you pay for something for the salon with your own money, add it here.</div></div> }
            }
          } @else {
            <div class="card" style="margin-top:12px" data-testid="exp-form">
              <h3>Add an expense you paid</h3>
              <p class="small muted">For money you spent on the salon from your own pocket. The owner approves it and pays you back.</p>
              <ng-container *ngTemplateOutlet="formFields" />
              <ion-button expand="block" (click)="submitMine()" [disabled]="busy()" data-testid="exp-submit">Send for approval</ion-button>
            </div>
          }
        } @else {
          <!-- ================= OWNER ================= -->
          @switch (tab()) {
            @case ('dashboard') {
              <ng-container *ngTemplateOutlet="periodPick" />
              @let t = totals();
              <div class="grid" style="margin-top:8px" data-testid="exp-dashboard">
                <div class="card stat"><div class="label">Total salon expenses</div><div class="value maroon" data-testid="tot-expenses">{{ t.total | ksh }}</div></div>
                <div class="card stat"><div class="label">Paid by staff</div><div class="value" data-testid="tot-staff">{{ t.staffPaid | ksh }}</div></div>
                <div class="card stat"><div class="label">Paid from salon funds</div><div class="value" data-testid="tot-salon">{{ t.salonPaid | ksh }}</div></div>
                <div class="card stat"><div class="label">Reimbursements paid</div><div class="value" data-testid="tot-reimbursed">{{ t.reimbursedInPeriod | ksh }}</div></div>
                <div class="card stat"><div class="label">Still owed to staff (all time)</div><div class="value down" data-testid="tot-outstanding">{{ t.outstanding | ksh }}</div></div>
                <div class="card stat"><div class="label">Waiting for approval</div><div class="value" data-testid="tot-pending">{{ t.pendingCount }} · {{ t.pendingSum | ksh }}</div></div>
              </div>
              <p class="small muted">Paying staff back settles what is owed; it is never counted as another expense.</p>
              <div class="two">
                <div class="card"><h3>By category</h3><ng-container *ngTemplateOutlet="bars; context: { $implicit: byCategory() }" /></div>
                <div class="card"><h3>Trend</h3><ng-container *ngTemplateOutlet="bars; context: { $implicit: trend() }" /></div>
              </div>
              <div class="section-title">Latest</div>
              <ng-container *ngTemplateOutlet="table; context: { $implicit: t.approved.slice(0, 8) }" />
            }
            @case ('all') {
              <div class="filters">
                <ion-searchbar placeholder="Search description, category, person" [debounce]="150" [value]="q()" (ionInput)="q.set($any($event).detail.value ?? ''); page.set(0)" data-testid="exp-search"></ion-searchbar>
                <div class="form-grid">
                  <ion-item lines="none" class="field"><ion-select label="Status" labelPlacement="stacked" interface="popover" [value]="fStatus()" (ionChange)="fStatus.set($event.detail.value); page.set(0)">
                    <ion-select-option value="">All</ion-select-option><ion-select-option value="PENDING">Pending</ion-select-option>
                    <ion-select-option value="APPROVED">Approved</ion-select-option><ion-select-option value="REJECTED">Rejected</ion-select-option></ion-select></ion-item>
                  <ion-item lines="none" class="field"><ion-select label="Paid from" labelPlacement="stacked" interface="popover" [value]="fSource()" (ionChange)="fSource.set($event.detail.value); page.set(0)">
                    <ion-select-option value="">All</ion-select-option><ion-select-option value="STAFF_PERSONAL">Staff's own money</ion-select-option>
                    <ion-select-option value="SALON_FUNDS">Salon funds</ion-select-option></ion-select></ion-item>
                  <ion-item lines="none" class="field"><ion-select label="Category" labelPlacement="stacked" interface="popover" [value]="fCat()" (ionChange)="fCat.set($event.detail.value); page.set(0)">
                    <ion-select-option value="">All</ion-select-option>
                    @for (c of cats(); track c.id) { <ion-select-option [value]="c.id">{{ c.name }}</ion-select-option> }</ion-select></ion-item>
                  <ion-item lines="none" class="field"><ion-select label="Sort" labelPlacement="stacked" interface="popover" [value]="sort()" (ionChange)="sort.set($event.detail.value)">
                    <ion-select-option value="date_desc">Newest first</ion-select-option><ion-select-option value="date_asc">Oldest first</ion-select-option>
                    <ion-select-option value="amount_desc">Largest first</ion-select-option><ion-select-option value="amount_asc">Smallest first</ion-select-option></ion-select></ion-item>
                </div>
                <ng-container *ngTemplateOutlet="periodPick" />
              </div>
              <p class="small muted">{{ filtered().length }} expense{{ filtered().length === 1 ? '' : 's' }} · approved total {{ filteredApproved() | ksh }}</p>
              <ng-container *ngTemplateOutlet="table; context: { $implicit: paged() }" />
              @if (pages() > 1) {
                <div class="row" style="justify-content:center;gap:8px">
                  <ion-button size="small" fill="outline" [disabled]="page() === 0" (click)="page.set(page() - 1)">Previous</ion-button>
                  <span class="small">Page {{ page() + 1 }} of {{ pages() }}</span>
                  <ion-button size="small" fill="outline" [disabled]="page() >= pages() - 1" (click)="page.set(page() + 1)">Next</ion-button>
                </div>
              }
            }
            @case ('approvals') {
              @for (e of pending(); track e.id) {
                <div class="card exp" data-testid="approval">
                  <div class="row"><strong>{{ e.paid_by_name }}</strong><span class="spacer"></span><strong class="maroon">{{ e.amount | ksh }}</strong></div>
                  <div>{{ e.description }}</div>
                  <div class="small muted">{{ e.category_name }} · spent {{ e.expense_date | date: 'EEE d MMM y' }} · sent {{ e.created_at | date: 'd MMM, HH:mm' }}</div>
                  @if (e.notes) { <div class="small">Note: {{ e.notes }}</div> }
                  <div class="small muted">Receipt: none uploaded · <span class="pill pending">Pending</span></div>
                  <div class="row" style="margin-top:8px;gap:8px">
                    <ion-button size="small" (click)="approve(e)" [disabled]="busy()" data-testid="approve">Approve</ion-button>
                    <ion-button size="small" fill="outline" color="danger" (click)="reject(e)" [disabled]="busy()" data-testid="reject">Reject</ion-button>
                    <span class="spacer"></span>
                    <ion-button size="small" fill="clear" (click)="open(e)">Details</ion-button>
                  </div>
                </div>
              } @empty { <div class="card" style="margin-top:12px"><div class="empty">Nothing waiting for approval. 🎉</div></div> }
            }
            @case ('reimb') {
              @let t = totals();
              <div class="grid" style="margin-top:12px" data-testid="reimb-summary">
                <div class="card stat"><div class="label">Owed to staff (all)</div><div class="value">{{ t.owedAllTime | ksh }}</div></div>
                <div class="card stat"><div class="label">Already paid back</div><div class="value">{{ t.reimbursedAllTime | ksh }}</div></div>
                <div class="card stat"><div class="label">Still owed</div><div class="value down" data-testid="reimb-outstanding">{{ t.outstanding | ksh }}</div></div>
                <div class="card stat"><div class="label">Not yet paid · part paid · done</div><div class="value">{{ reimbCount('PENDING') }} · {{ reimbCount('PARTIALLY_REIMBURSED') }} · {{ reimbCount('FULLY_REIMBURSED') }}</div></div>
              </div>
              @if (owedByStaff().length) {
                <div class="section-title">Who is still owed</div>
                <div class="card"><table class="t"><tbody>
                  @for (o of owedByStaff(); track o.name) { <tr data-testid="owed-row"><td><strong>{{ o.name }}</strong></td><td class="num down">{{ o.amount | ksh }}</td></tr> }
                </tbody></table></div>
              }
              <div class="form-grid" style="margin-top:10px">
                <ion-item lines="none" class="field"><ion-select label="Staff member" labelPlacement="stacked" interface="popover" [value]="rStaff()" (ionChange)="rStaff.set($event.detail.value)">
                  <ion-select-option value="">Everyone</ion-select-option>
                  @for (n of reimbStaff(); track n) { <ion-select-option [value]="n">{{ n }}</ion-select-option> }</ion-select></ion-item>
                <ion-item lines="none" class="field"><ion-select label="Status" labelPlacement="stacked" interface="popover" [value]="rStatus()" (ionChange)="rStatus.set($event.detail.value)">
                  <ion-select-option value="open">Still owed</ion-select-option><ion-select-option value="">All</ion-select-option>
                  <ion-select-option value="PENDING">Not yet paid</ion-select-option><ion-select-option value="PARTIALLY_REIMBURSED">Partially reimbursed</ion-select-option>
                  <ion-select-option value="FULLY_REIMBURSED">Fully reimbursed</ion-select-option></ion-select></ion-item>
              </div>
              <ng-container *ngTemplateOutlet="periodPick" />
              <div class="card" style="overflow-x:auto"><table class="t">
                <thead><tr><th>Staff</th><th>Expense</th><th class="num">Amount</th><th class="num">Paid back</th><th class="num">Still owed</th><th>Status</th><th>Last payment</th><th></th></tr></thead>
                <tbody>
                  @for (e of reimbRows(); track e.id) {
                    @let r = e.reimbursement!;
                    <tr data-testid="reimb-row">
                      <td><strong>{{ r.staff_name }}</strong></td>
                      <td>{{ e.description }}<br /><span class="small muted">{{ e.expense_date | date: 'd MMM y' }}</span></td>
                      <td class="num">{{ r.amount_owed | ksh }}</td><td class="num">{{ r.amount_paid | ksh }}</td>
                      <td class="num"><strong [class.down]="r.outstanding > 0" data-testid="reimb-left">{{ r.outstanding | ksh }}</strong></td>
                      <td><span class="pill {{ state(e).cls }}" data-testid="reimb-status">{{ reimbText(r.status) }}</span></td>
                      <td class="small">{{ r.last_paid_at ? (r.last_paid_at | date: 'd MMM y') : '—' }}</td>
                      <td class="num" style="white-space:nowrap">
                        @if (r.outstanding > 0) { <ion-button size="small" (click)="openPay(e)" data-testid="reimb-pay">Pay back</ion-button> }
                        <ion-button size="small" fill="clear" (click)="open(e)">Details</ion-button>
                      </td>
                    </tr>
                  } @empty { <tr><td class="empty">Nothing here.</td></tr> }
                </tbody>
              </table></div>
            }
            @case ('categories') {
              <div class="card" style="margin-top:12px">
                <div class="row"><h3 style="margin:0">Expense categories</h3><span class="spacer"></span><ion-button size="small" (click)="addCategory()" data-testid="cat-add">+ Category</ion-button></div>
                <p class="small muted">Switching a category off hides it from new expenses; past expenses keep their category.</p>
                <table class="t"><tbody>
                  @for (c of cats(); track c.id) {
                    <tr [style.opacity]="c.active ? 1 : 0.5" data-testid="exp-cat">
                      <td><strong>{{ c.name }}</strong></td>
                      <td class="num"><ion-toggle [checked]="c.active" (ionChange)="setActive(c, $event.detail.checked)" aria-label="In use"></ion-toggle></td>
                      <td class="num"><ion-button size="small" fill="clear" (click)="rename(c)">Rename</ion-button></td>
                    </tr>
                  }
                </tbody></table>
              </div>
            }
            @case ('reports') {
              <ng-container *ngTemplateOutlet="periodPick" />
              <div class="row" style="gap:8px;margin:6px 0 10px;flex-wrap:wrap">
                <ion-button size="small" (click)="export('xlsx')" [disabled]="busy()" data-testid="export-excel">Export Excel</ion-button>
                <ion-button size="small" fill="outline" (click)="export('pdf')" [disabled]="busy()" data-testid="export-pdf">Export PDF</ion-button>
              </div>
              @for (tb of reportTables(); track tb.heading) {
                <div class="section-title">{{ tb.heading }}</div>
                <div class="card" style="overflow-x:auto" data-testid="report-table"><table class="t">
                  <thead><tr>@for (h of tb.head; track $index) { <th [class.num]="$index > 0">{{ h }}</th> }</tr></thead>
                  <tbody>@for (r of tb.body; track $index) { <tr>@for (c of r; track $index) { <td [class.num]="$index > 0">{{ c }}</td> }</tr> }
                    @empty { <tr><td class="empty">Nothing in this period.</td></tr> }</tbody>
                </table></div>
              }
              <div class="two">
                <div class="card"><h3>By category</h3><ng-container *ngTemplateOutlet="bars; context: { $implicit: byCategory() }" /></div>
                <div class="card"><h3>Trend</h3><ng-container *ngTemplateOutlet="bars; context: { $implicit: trend() }" /></div>
              </div>
            }
          }
        }
      </div>

      <!-- ---------- shared pieces ---------- -->
      <ng-template #periodPick>
        <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:10px" data-testid="period">
          @for (p of periods; track p.value) {
            <button class="chip" type="button" [class.on]="period() === p.value" (click)="period.set(p.value); page.set(0)">{{ p.label }}</button>
          }
        </div>
        @if (period() === 'custom') {
          <div class="form-grid">
            <ion-item lines="none" class="field"><ion-input label="From" labelPlacement="stacked" type="date" [value]="from()" (ionChange)="from.set($any($event.detail.value))"></ion-input></ion-item>
            <ion-item lines="none" class="field"><ion-input label="To" labelPlacement="stacked" type="date" [value]="to()" (ionChange)="to.set($any($event.detail.value))"></ion-input></ion-item>
          </div>
        }
      </ng-template>

      <ng-template #bars let-rows>
        @for (b of rows; track b.label) {
          <div class="bar-row"><span class="bar-label">{{ b.label }}</span>
            <span class="bar"><i [style.width.%]="b.pct"></i></span><span class="bar-val">{{ b.value | ksh }}</span></div>
        } @empty { <div class="empty">No approved expenses in this period.</div> }
      </ng-template>

      <ng-template #table let-rows>
        <div class="card" style="overflow-x:auto"><table class="t">
          <thead><tr><th>Date</th><th>Description</th><th>Category</th><th class="num">Amount</th><th>Paid by</th><th>Paid from</th><th>Status</th><th>Paid back</th><th></th></tr></thead>
          <tbody>
            @for (e of rows; track e.id) {
              <tr data-testid="exp-row" (click)="open(e)" style="cursor:pointer">
                <td class="small">{{ e.expense_date | date: 'd MMM y' }}</td>
                <td>{{ e.description }}</td><td class="small">{{ e.category_name }}</td>
                <td class="num"><strong>{{ e.amount | ksh }}</strong></td>
                <td class="small">{{ e.paid_by_name }}</td>
                <td class="small">{{ e.payment_source === 'STAFF_PERSONAL' ? "Staff's own" : 'Salon' + (e.salon_method ? ' · ' + method(e.salon_method) : '') }}</td>
                <td><span class="pill {{ e.approval_status === 'APPROVED' ? 'booked' : e.approval_status === 'PENDING' ? 'pending' : 'cancelled' }}">{{ e.approval_status | titlecase }}</span></td>
                <td class="small">{{ e.reimbursement ? reimbText(e.reimbursement.status) : '—' }}</td>
                <td class="num"><ion-button size="small" fill="clear">Details</ion-button></td>
              </tr>
            } @empty { <tr><td class="empty">No expenses here.</td></tr> }
          </tbody>
        </table></div>
      </ng-template>

      <ng-template #formFields>
        @if (form(); as f) {
          <div class="form-grid">
            <ion-item lines="none" class="field"><ion-input label="What was it for? *" labelPlacement="stacked" [(ngModel)]="f.description" placeholder="e.g. Electricity tokens" data-testid="f-desc"></ion-input></ion-item>
            <ion-item lines="none" class="field"><ion-input label="Amount (KSh) *" labelPlacement="stacked" type="number" min="1" [(ngModel)]="f.amount" data-testid="f-amount"></ion-input></ion-item>
            <ion-item lines="none" class="field"><ion-select label="Category *" labelPlacement="stacked" interface="popover" [(ngModel)]="f.category_id" placeholder="Choose" data-testid="f-cat">
              @for (c of activeCats(); track c.id) { <ion-select-option [value]="c.id">{{ c.name }}</ion-select-option> }</ion-select></ion-item>
            <ion-item lines="none" class="field"><ion-input label="Date spent *" labelPlacement="stacked" type="date" [max]="today" [(ngModel)]="f.expense_date" data-testid="f-date"></ion-input></ion-item>
            @if (owner() && !f.id) {
              <ion-item lines="none" class="field"><ion-select label="Who paid?" labelPlacement="stacked" interface="popover" [(ngModel)]="f.paid_by_staff" (ionChange)="f.payment_source = f.paid_by_staff ? 'STAFF_PERSONAL' : 'SALON_FUNDS'" data-testid="f-paidby">
                <ion-select-option [value]="null">Salon funds (paid by me / the salon)</ion-select-option>
                @for (s of payers(); track s.id) { <ion-select-option [value]="s.id">{{ s.name }} – own money (to pay back)</ion-select-option> }</ion-select></ion-item>
              @if (!f.paid_by_staff) {
                <ion-item lines="none" class="field"><ion-select label="Paid with" labelPlacement="stacked" interface="popover" [(ngModel)]="f.salon_method">
                  @for (m of salonMethods; track m.value) { <ion-select-option [value]="m.value">{{ m.label }}</ion-select-option> }</ion-select></ion-item>
              }
            }
          </div>
          <ion-item lines="none" class="field"><ion-textarea label="Notes (optional)" labelPlacement="stacked" autoGrow="true" [(ngModel)]="f.notes"></ion-textarea></ion-item>
          <p class="small muted">Receipt upload: not available yet – keep the paper receipt or M-Pesa message.</p>
        }
      </ng-template>

      <!-- owner: add / edit -->
      <ion-modal [isOpen]="owner() && !!form() && formOpen()" (didDismiss)="formOpen.set(false)" [initialBreakpoint]="0.95" [breakpoints]="[0, 0.95]">
        <ng-template>
          <ion-content class="ion-padding">
            <h3>{{ form()?.id ? 'Change expense' : 'Add expense' }}</h3>
            <ng-container *ngTemplateOutlet="formFields" />
            <div class="row" style="margin-top:12px"><ion-button fill="clear" color="medium" (click)="formOpen.set(false)">Cancel</ion-button><span class="spacer"></span>
              <ion-button (click)="saveOwner()" [disabled]="busy()" data-testid="f-save">Save</ion-button></div>
          </ion-content>
        </ng-template>
      </ion-modal>

      <!-- owner: details, history -->
      <ion-modal [isOpen]="!!detail()" (didDismiss)="detail.set(null)" [initialBreakpoint]="0.95" [breakpoints]="[0, 0.95]">
        <ng-template>
          <ion-content class="ion-padding">
            @if (detail(); as e) {
              <h3>{{ e.description }}</h3>
              <div class="form-grid small" data-testid="exp-detail">
                <div><span class="muted">Amount</span><br /><strong>{{ e.amount | ksh }}</strong></div>
                <div><span class="muted">Category</span><br />{{ e.category_name }}</div>
                <div><span class="muted">Date spent</span><br />{{ e.expense_date | date: 'EEE d MMM y' }}</div>
                <div><span class="muted">Paid by</span><br />{{ e.paid_by_name }} · {{ e.payment_source === 'STAFF_PERSONAL' ? 'own money' : 'salon funds' }}</div>
                <div><span class="muted">Recorded</span><br />{{ e.created_at | date: 'd MMM y, HH:mm' }}</div>
                <div><span class="muted">Status</span><br /><span class="pill {{ state(e).cls }}">{{ state(e).label }}</span></div>
                @if (e.approved_by_name) { <div><span class="muted">{{ e.approval_status === 'REJECTED' ? 'Rejected' : 'Approved' }} by</span><br />{{ e.approved_by_name }} · {{ e.approved_at | date: 'd MMM, HH:mm' }}</div> }
              </div>
              @if (e.notes) { <p class="small">Notes: {{ e.notes }}</p> }
              @if (e.rejection_reason) { <p class="small down">Reason: {{ e.rejection_reason }}</p> }
              @if (e.reimbursement; as r) {
                <div class="section-title">Paying {{ r.staff_name }} back</div>
                <table class="t"><tbody>
                  <tr><td>Salon expense</td><td class="num">{{ e.amount | ksh }}</td></tr>
                  <tr><td>Paid back</td><td class="num">{{ r.amount_paid | ksh }}</td></tr>
                  <tr><td><strong>Still owed</strong></td><td class="num"><strong class="down" data-testid="detail-left">{{ r.outstanding | ksh }}</strong></td></tr>
                </tbody></table>
                @if (r.payments.length) {
                  <table class="t small" style="margin-top:6px" data-testid="pay-history"><thead><tr><th>Date</th><th>How</th><th class="num">Amount</th></tr></thead><tbody>
                    @for (p of r.payments; track p.id) { <tr><td>{{ p.paid_on | date: 'd MMM y' }}</td><td>{{ method(p.method) }}@if (p.reference) { · {{ p.reference }} }@if (p.notes) { · {{ p.notes }} }</td><td class="num">{{ p.amount | ksh }}</td></tr> }
                  </tbody></table>
                }
              }
              <div class="row" style="gap:8px;margin-top:12px;flex-wrap:wrap">
                @if (e.approval_status === 'PENDING') {
                  <ion-button size="small" (click)="approve(e)" [disabled]="busy()">Approve</ion-button>
                  <ion-button size="small" fill="outline" color="danger" (click)="reject(e)" [disabled]="busy()">Reject</ion-button>
                }
                @if (e.reimbursement && e.reimbursement.outstanding > 0) { <ion-button size="small" (click)="openPay(e)" data-testid="detail-pay">Pay back</ion-button> }
                @if (!e.outside_buy_id) { <ion-button size="small" fill="outline" (click)="editExpense(e)">Change details</ion-button> }
              </div>
              @if (history().length) {
                <div class="section-title">History</div>
                <table class="t small" data-testid="audit"><tbody>
                  @for (a of history(); track a.id) { <tr><td>{{ a.at | date: 'd MMM, HH:mm' }}</td><td>{{ actionText(a.action) }}</td><td>{{ a.performed_by_name ?? '' }}</td></tr> }
                </tbody></table>
              }
            }
          </ion-content>
        </ng-template>
      </ion-modal>

      <!-- owner: pay back -->
      <ion-modal [isOpen]="!!payForm()" (didDismiss)="payForm.set(null)" [initialBreakpoint]="0.85" [breakpoints]="[0, 0.85]">
        <ng-template>
          <ion-content class="ion-padding">
            @if (payForm(); as pf) {
              <h3>Pay {{ pf.r.staff_name }} back</h3>
              <p class="small">{{ pf.e.description }} · expense {{ pf.e.amount | ksh }} · already paid {{ pf.r.amount_paid | ksh }} · <strong>still owed {{ pf.r.outstanding | ksh }}</strong></p>
              <div class="form-grid">
                <ion-item lines="none" class="field"><ion-input label="Paying now (KSh)" labelPlacement="stacked" type="number" min="1" [max]="pf.r.outstanding" [(ngModel)]="pf.amount" data-testid="pay-amount"></ion-input></ion-item>
                <ion-item lines="none" class="field"><ion-select label="How" labelPlacement="stacked" interface="popover" [(ngModel)]="pf.method" data-testid="pay-how">
                  @for (m of methods; track m.value) { <ion-select-option [value]="m.value">{{ m.label }}</ion-select-option> }</ion-select></ion-item>
                <ion-item lines="none" class="field"><ion-input label="Reference (optional)" labelPlacement="stacked" [(ngModel)]="pf.reference" placeholder="M-Pesa code"></ion-input></ion-item>
                <ion-item lines="none" class="field"><ion-input label="Date paid" labelPlacement="stacked" type="date" [max]="today" [(ngModel)]="pf.paid_on"></ion-input></ion-item>
              </div>
              <ion-item lines="none" class="field"><ion-textarea label="Notes (optional)" labelPlacement="stacked" autoGrow="true" [(ngModel)]="pf.notes"></ion-textarea></ion-item>
              <div class="row" style="margin-top:12px"><ion-button fill="clear" color="medium" (click)="payForm.set(null)">Cancel</ion-button><span class="spacer"></span>
                <ion-button (click)="pay(pf)" [disabled]="busy()" data-testid="pay-save">Record payment</ion-button></div>
            }
          </ion-content>
        </ng-template>
      </ion-modal>
    </ion-content>
  `,
  styles: [`
    .chip { border: 1px solid var(--line, #ddd); background: transparent; border-radius: 999px; padding: 5px 12px; font: inherit; font-size: .85rem; color: inherit; cursor: pointer; }
    .chip.on { background: var(--app-maroon, #7b1e2e); border-color: var(--app-maroon, #7b1e2e); color: #fff; }
    .card.exp { margin-bottom: 10px; }
    .two { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); margin-top: 12px; }
    .bar-row { display: grid; grid-template-columns: minmax(90px, 32%) 1fr auto; gap: 8px; align-items: center; margin: 6px 0; font-size: .85rem; }
    .bar-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bar { height: 10px; background: rgba(123, 30, 46, .08); border-radius: 6px; overflow: hidden; }
    .bar i { display: block; height: 100%; background: var(--app-maroon, #7b1e2e); border-radius: 6px; }
    .bar-val { font-variant-numeric: tabular-nums; }
    .center { text-align: center; }
  `],
})
export class ExpensesPage implements ViewWillEnter {
  private data = inject(DataService);
  private auth = inject(StaffAuthService);
  private exp = inject(ExpensesService);
  private ui = inject(Ui);
  /** /expenses?tab=approvals (from a notification) */
  readonly tabParam = input<string>('', { alias: 'tab' });

  readonly owner = this.data.owner;
  readonly tab = signal<OwnerTab>('dashboard');
  readonly stab = signal<StaffTab>('mine');
  readonly loading = signal(true);
  readonly error = signal('');
  readonly busy = signal(false);
  readonly cats = signal<ExpCategory[]>([]);
  readonly activeCats = computed(() => this.cats().filter((c) => c.active));
  readonly my = signal<{ expenses: Expense[]; summary: MySummary } | null>(null);
  readonly list = signal<Expense[]>([]);
  readonly payments = signal<ReimbPayment[]>([]);
  readonly form = signal<Form | null>(null);
  readonly formOpen = signal(false);
  readonly detail = signal<Expense | null>(null);
  readonly history = signal<AuditRow[]>([]);
  readonly payForm = signal<PayForm | null>(null);

  readonly periods = PERIODS;
  readonly methods = METHODS;
  readonly salonMethods = [...METHODS.slice(0, 3), { value: 'card', label: 'Card' }, METHODS[3]];
  readonly today = ymdOf(new Date());
  readonly period = signal<Period>('month');
  readonly from = signal('');
  readonly to = signal('');
  readonly range = computed(() => periodRange(this.period(), this.from(), this.to()));
  readonly totals = computed(() => expTotals(this.list(), this.payments(), ...this.range()));
  readonly pending = computed(() => this.list().filter((e) => e.approval_status === 'PENDING'));
  readonly payers = computed(() => this.data.staff().filter((s) => s.active && !s.roles.includes('owner')));

  // all expenses: search / filter / sort / pages
  readonly q = signal('');
  readonly fStatus = signal('');
  readonly fSource = signal('');
  readonly fCat = signal('');
  readonly sort = signal('date_desc');
  readonly page = signal(0);
  readonly filtered = computed(() => {
    const [a, b] = this.range();
    const t = this.q().trim().toLowerCase();
    const l = this.list().filter((e) => e.expense_date >= a && e.expense_date <= b
      && (!this.fStatus() || e.approval_status === this.fStatus()) && (!this.fSource() || e.payment_source === this.fSource())
      && (!this.fCat() || e.category_id === this.fCat())
      && (!t || [e.description, e.category_name, e.paid_by_name, e.notes ?? ''].some((x) => x.toLowerCase().includes(t))));
    const s = this.sort();
    return [...l].sort((x, y) => s === 'amount_desc' ? y.amount - x.amount : s === 'amount_asc' ? x.amount - y.amount
      : s === 'date_asc' ? x.expense_date.localeCompare(y.expense_date) || x.created_at.localeCompare(y.created_at)
      : y.expense_date.localeCompare(x.expense_date) || y.created_at.localeCompare(x.created_at));
  });
  readonly filteredApproved = computed(() => this.filtered().filter((e) => e.approval_status === 'APPROVED').reduce((a, e) => a + Number(e.amount), 0));
  readonly pages = computed(() => Math.max(1, Math.ceil(this.filtered().length / PAGE)));
  readonly paged = computed(() => this.filtered().slice(this.page() * PAGE, this.page() * PAGE + PAGE));

  // reimbursements
  readonly rStaff = signal('');
  readonly rStatus = signal('open');
  readonly withReimb = computed(() => this.list().filter((e) => !!e.reimbursement));
  readonly reimbStaff = computed(() => [...new Set(this.withReimb().map((e) => e.reimbursement!.staff_name))].sort());
  readonly reimbRows = computed(() => {
    const [a, b] = this.range();
    return this.withReimb().filter((e) => {
      const r = e.reimbursement!;
      return e.expense_date >= a && e.expense_date <= b && (!this.rStaff() || r.staff_name === this.rStaff())
        && (this.rStatus() === '' || (this.rStatus() === 'open' ? r.outstanding > 0 : r.status === this.rStatus()));
    });
  });
  readonly owedByStaff = computed(() => {
    const m = new Map<string, number>();
    for (const e of this.withReimb()) if (e.reimbursement!.outstanding > 0) m.set(e.reimbursement!.staff_name, (m.get(e.reimbursement!.staff_name) ?? 0) + Number(e.reimbursement!.outstanding));
    return [...m.entries()].map(([name, amount]) => ({ name, amount })).sort((x, y) => y.amount - x.amount);
  });

  // charts and reports (approved expenses in the period)
  readonly byCategory = computed(() => this.bars(this.groupSum(this.totals().approved, (e) => e.category_name)));
  readonly trend = computed(() => {
    const [a, b] = this.range();
    const days = (new Date(b).getTime() - new Date(a).getTime()) / 86400000;
    const key = (e: Expense) => (this.period() === 'all' || days > 92) ? e.expense_date.slice(0, 7) : days > 31 ? 'wk ' + weekOf(e.expense_date) : e.expense_date;
    return this.bars(this.groupSum(this.totals().approved, key).sort((x, y) => x[0].localeCompare(y[0])), false);
  });
  readonly reportTables = computed<ReportTable[]>(() => {
    const t = this.totals();
    const fmt = (n: number) => ksh(n);
    const appr = t.approved;
    const staffPaid = appr.filter((e) => e.payment_source === 'STAFF_PERSONAL');
    const reimbs = this.withReimb().map((e) => ({ e, r: e.reimbursement! }));
    const count = (s: string) => reimbs.filter((x) => x.r.status === s);
    const [a, b] = this.range();
    return [
      { heading: 'Summary', head: ['Figure', 'Amount'], body: [
        ['Total salon expenses (approved)', fmt(t.total)], ['Paid by staff (own money)', fmt(t.staffPaid)],
        ['Paid from salon funds', fmt(t.salonPaid)], ['Reimbursement payments made', fmt(t.reimbursedInPeriod)],
        ['Still owed to staff (all time)', fmt(t.outstanding)], ['Waiting for approval', `${t.pendingCount} · ${fmt(t.pendingSum)}`],
        ['Not yet paid back', `${count('PENDING').length} · ${fmt(count('PENDING').reduce((x, y) => x + Number(y.r.outstanding), 0))}`],
        ['Partly paid back', `${count('PARTIALLY_REIMBURSED').length} · ${fmt(count('PARTIALLY_REIMBURSED').reduce((x, y) => x + Number(y.r.outstanding), 0))} still owed`],
        ['Fully paid back', `${count('FULLY_REIMBURSED').length} · ${fmt(count('FULLY_REIMBURSED').reduce((x, y) => x + Number(y.r.amount_owed), 0))}`],
      ] },
      { heading: 'By day', head: ['Day', 'Expenses'], body: this.groupSum(appr, (e) => e.expense_date).sort((x, y) => y[0].localeCompare(x[0])).map(([k, v]) => [k, fmt(v)]) },
      { heading: 'By week (from Monday)', head: ['Week of', 'Expenses'], body: this.groupSum(appr, (e) => weekOf(e.expense_date)).sort((x, y) => y[0].localeCompare(x[0])).map(([k, v]) => [k, fmt(v)]) },
      { heading: 'By month', head: ['Month', 'Expenses'], body: this.groupSum(appr, (e) => e.expense_date.slice(0, 7)).sort((x, y) => y[0].localeCompare(x[0])).map(([k, v]) => [k, fmt(v)]) },
      { heading: 'By category', head: ['Category', 'Expenses'], body: this.groupSum(appr, (e) => e.category_name).map(([k, v]) => [k, fmt(v)]) },
      { heading: 'Paid by staff, per person', head: ['Staff member', 'Expenses'], body: this.groupSum(staffPaid, (e) => e.paid_by_name).map(([k, v]) => [k, fmt(v)]) },
      { heading: 'Reimbursement payments', head: ['Date', 'Staff', 'How', 'Amount'], body: this.payments().filter((p) => p.paid_on >= a && p.paid_on <= b)
          .map((p) => [p.paid_on, reimbs.find((x) => x.r.id === p.reimbursement_id)?.r.staff_name ?? '', methodLabel(p.method), fmt(p.amount)]) },
      { heading: 'Approved expenses', head: ['Date', 'Description', 'Category', 'Paid by', 'Amount'], body: [...appr]
          .sort((x, y) => y.expense_date.localeCompare(x.expense_date)).map((e) => [e.expense_date, e.description, e.category_name,
            e.paid_by_name + (e.payment_source === 'STAFF_PERSONAL' ? ' (own money)' : ''), fmt(e.amount)]) },
    ];
  });

  state = expState;
  method = methodLabel;
  reimbText = reimbLabel;

  async ionViewWillEnter() {
    const t = this.tabParam();
    if (t === 'approvals' || t === 'reimb') this.tab.set(t);
    await this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set('');
    try {
      this.cats.set(await this.exp.categories());
      if (this.owner()) {
        const all = await this.exp.all();
        this.list.set(all.expenses);
        this.payments.set(all.payments);
      } else {
        this.my.set(await this.exp.mine());
      }
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.loading.set(false);
    }
    if (!this.form()) this.resetForm();
  }

  resetForm() {
    this.form.set({ description: '', amount: null, category_id: null, expense_date: this.today, notes: '', payment_source: 'SALON_FUNDS', paid_by_staff: null, salon_method: 'cash' });
  }
  private check(f: Form): string | null {
    if (!f.description.trim()) return 'Enter what the money was spent on';
    if (!(Number(f.amount) > 0)) return 'Enter an amount above 0';
    if (!f.category_id) return 'Choose a category';
    if (!f.expense_date) return 'Enter the date of the expense';
    if (f.expense_date > this.today) return 'The date cannot be in the future';
    return null;
  }

  // ----- staff -----
  async submitMine() {
    const f = this.form()!;
    const err = this.check(f);
    if (err) return this.ui.toast(err, 'danger');
    this.busy.set(true);
    try {
      await this.exp.submit({ description: f.description.trim(), amount: Number(f.amount), category_id: f.category_id!, expense_date: f.expense_date, notes: f.notes.trim() || null });
      this.ui.toast('Sent to the owner for approval');
      this.resetForm();
      this.stab.set('mine');
      await this.load();
    } catch (e) {
      this.ui.error(e);
    } finally {
      this.busy.set(false);
    }
  }

  // ----- owner -----
  newExpense() {
    this.resetForm();
    this.formOpen.set(true);
  }
  editExpense(e: Expense) {
    this.form.set({ id: e.id, description: e.description, amount: Number(e.amount), category_id: e.category_id, expense_date: e.expense_date,
      notes: e.notes ?? '', payment_source: e.payment_source, paid_by_staff: e.paid_by_staff, salon_method: e.salon_method ?? 'cash' });
    this.detail.set(null);
    this.formOpen.set(true);
  }
  async saveOwner() {
    const f = this.form()!;
    const err = this.check(f);
    if (err) return this.ui.toast(err, 'danger');
    this.busy.set(true);
    try {
      if (f.id) {
        await this.exp.edit({ id: f.id, description: f.description.trim(), amount: Number(f.amount), category_id: f.category_id!, expense_date: f.expense_date, notes: f.notes.trim() || null });
        this.ui.toast('Expense changed');
      } else {
        await this.exp.add({ description: f.description.trim(), amount: Number(f.amount), category_id: f.category_id!, expense_date: f.expense_date,
          notes: f.notes.trim() || null, payment_source: f.paid_by_staff ? 'STAFF_PERSONAL' : 'SALON_FUNDS', paid_by_staff: f.paid_by_staff, salon_method: f.salon_method });
        this.ui.toast(f.paid_by_staff ? 'Expense added – the salon owes them this' : 'Expense added');
      }
      this.formOpen.set(false);
      this.resetForm();
      await this.load();
    } catch (e) {
      this.ui.error(e);
    } finally {
      this.busy.set(false);
    }
  }
  async open(e: Expense) {
    this.detail.set(e);
    this.history.set([]);
    try { this.history.set(await this.exp.audit(e.id)); } catch { /* history is extra */ }
  }
  async approve(e: Expense) {
    if (!(await this.ui.confirm('Approve?', `${e.paid_by_name}: ${e.description} – ${ksh(e.amount)}. It becomes a salon expense and the salon owes ${e.paid_by_name} this amount.`, 'Approve'))) return;
    await this.act(async () => { await this.exp.decide(e.id, true); this.ui.toast('Approved'); });
  }
  async reject(e: Expense) {
    const why = await this.ui.prompt('Reject – reason', 'e.g. No receipt, not a salon expense', `${e.paid_by_name}: ${e.description} – ${ksh(e.amount)}`);
    if (why === null) return;
    if (!why.trim()) return this.ui.toast('Give a reason for rejecting', 'danger');
    await this.act(async () => { await this.exp.decide(e.id, false, why.trim()); this.ui.toast('Rejected'); });
  }
  openPay(e: Expense) {
    const r = e.reimbursement!;
    this.detail.set(null);
    this.payForm.set({ r, e, amount: Number(r.outstanding), method: 'mpesa', reference: '', paid_on: this.today, notes: '', key: crypto.randomUUID() });
  }
  async pay(pf: PayForm) {
    const amt = Number(pf.amount);
    if (!(amt > 0)) return this.ui.toast('Enter an amount above 0', 'danger');
    if (amt > Number(pf.r.outstanding)) return this.ui.toast(`That is more than what is still owed (${ksh(pf.r.outstanding)})`, 'danger');
    if (!(await this.ui.confirm('Record payment?', `Pay ${pf.r.staff_name} ${ksh(amt)} by ${methodLabel(pf.method)}. Still owed after this: ${ksh(Number(pf.r.outstanding) - amt)}.`, 'Record'))) return;
    await this.act(async () => {
      await this.exp.reimburse({ reimbursement_id: pf.r.id, amount: amt, method: pf.method, reference: pf.reference.trim() || null, paid_on: pf.paid_on, notes: pf.notes.trim() || null, request_key: pf.key });
      this.ui.toast(amt >= Number(pf.r.outstanding) ? `${pf.r.staff_name} is paid back in full` : `Recorded – ${ksh(Number(pf.r.outstanding) - amt)} still owed`);
      this.payForm.set(null);
    });
  }
  reimbCount(s: string) {
    return this.withReimb().filter((e) => e.reimbursement!.status === s).length;
  }
  async addCategory() {
    const name = await this.ui.prompt('New category', 'e.g. Security');
    if (!name?.trim()) return;
    await this.act(async () => { await this.exp.saveCategory({ name: name.trim() }); this.ui.toast('Category added'); });
  }
  async rename(c: ExpCategory) {
    const name = await this.ui.prompt('Rename category', c.name);
    if (!name?.trim() || name.trim() === c.name) return;
    await this.act(async () => { await this.exp.saveCategory({ id: c.id, name: name.trim(), active: c.active }); this.ui.toast('Renamed'); });
  }
  async setActive(c: ExpCategory, on: boolean) {
    if (c.active === on) return;
    await this.act(async () => { await this.exp.saveCategory({ id: c.id, name: c.name, active: on }); this.ui.toast(on ? `${c.name} back in use` : `${c.name} switched off`); });
  }
  private async act(fn: () => Promise<void>) {
    this.busy.set(true);
    try {
      await fn();
      await this.load();
    } catch (e) {
      this.ui.error(e);
    } finally {
      this.busy.set(false);
    }
  }

  async export(kind: 'xlsx' | 'pdf') {
    const [a, b] = this.range();
    const label = PERIODS.find((p) => p.value === this.period())?.label ?? '';
    const title = 'Dantesras Beauty Hub – expenses';
    const sub = `${label}${this.period() === 'all' ? '' : ` (${a} to ${b})`} · made ${new Date().toLocaleString('en-GB')}`;
    this.busy.set(true);
    try {
      const name = `dantesras-expenses-${this.period() === 'all' ? 'all' : a + '_' + b}`;
      if (kind === 'xlsx') await saveFile(name + '.csv', excelCsv(`${title} – ${sub}`, this.reportTables()));
      else await saveFile(name + '.pdf', await pdfReport(title, sub, this.reportTables()));
    } catch (e) {
      this.ui.error(e);
    } finally {
      this.busy.set(false);
    }
  }
  actionText(a: string) {
    return ({ EXPENSE_CREATED: 'Recorded', EXPENSE_APPROVED: 'Approved', EXPENSE_REJECTED: 'Rejected', EXPENSE_EDITED: 'Details changed',
      REIMBURSEMENT_OWED: 'Owed to staff', PARTIAL_REIMBURSEMENT: 'Part paid back', FULL_REIMBURSEMENT: 'Paid back in full' } as Record<string, string>)[a] ?? a;
  }

  private groupSum(l: Expense[], key: (e: Expense) => string): [string, number][] {
    const m = new Map<string, number>();
    for (const e of l) m.set(key(e), (m.get(key(e)) ?? 0) + Number(e.amount));
    return [...m.entries()].sort((x, y) => y[1] - x[1]);
  }
  private bars(rows: [string, number][], keepOrder = true) {
    const max = Math.max(1, ...rows.map((r) => r[1]));
    void keepOrder;
    return rows.map(([label, value]) => ({ label, value, pct: Math.max(2, (value / max) * 100) }));
  }
}
