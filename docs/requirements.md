# Dantesras Beauty Hub – Salon & School Management System
## Software Requirements Specification (SRS) – Draft v1.0

| | |
|---|---|
| **Client** | Dantesras Beauty Hub & Dantesras Hair and Beauty School |
| **Location** | Karuguru Junction, Kamakis, Ruiru (Kiambu County), Kenya |
| **Phase** | Requirements – complete, ready for owner review and sign-off |
| **Date** | 20 November 2026 |

---

## 1. Background

Dantesras Beauty Hub is a growing salon (10 staff and expanding) that also runs **Dantesras Hair and Beauty School**. All bookings, sales, staff records and student records are currently kept **manually**. This causes difficulty tracking sales, debts, staff performance and commissions.

## 2. Goals

1. One system that manages **both the salon and the school**.
2. Record every booking, walk-in and home-service job digitally.
3. Track **sales** (services + products) and **debts** accurately.
4. Measure **staff performance** and calculate **commissions** automatically.
5. Control **staff attendance**, allowing clock-in only at the salon.
6. Send automatic **WhatsApp and SMS** reminders.

## 3. Guiding principle: flexibility

Business rules are **configured by the owner in Settings**, not hard-coded. This applies to courses, fees, commission rates, roles and permissions, home-service pricing, rating methods, attendance radius, stock alert levels and reminder messages.

## 4. Users and roles

| Role | Typical access |
|---|---|
| **Owner / Admin** | Everything, including settings, reports, commissions and permissions |
| **Manager** | Daily operations, approvals, reports (as allowed by owner) |
| **Receptionist** | Bookings, walk-in queue, checkout and payments, client records |
| **Stylist** | Own schedule, own clients, own performance and earnings |
| **Tutor** | Own classes, student attendance and marks |
| **Student** *(optional)* | Own attendance, marks, fee balance |

- A staff member can hold more than one role (for example stylist and tutor).
- The owner can customise what each role can see and do.
- **Current setup (Nov 2026):** there is **no manager** and **no dedicated receptionist**. The **owner and all stylists have receptionist functions**: creating bookings, running the walk-in queue, checkout and payments, and adding clients.
- The **Manager** and **Receptionist** roles stay in the system, unused, so they can be switched on later without changes.
- The **owner can override anything a manager does**, for example reversing an approval or editing a record.
- Because stylists take bookings, every stylist sees **all stylists' availability** in the calendar. **Earnings and performance stay private** to each stylist (and the owner).
- Every sale records **who entered it**. The owner gets a **daily list of sales by who entered them** to check.
- Everyone has their **own account** (phone number + password/PIN). Accounts are never shared.
- The owner can **deactivate** an account immediately. Past records are kept.
- Every important action (sales, refunds, voids, price and commission changes, attendance edits) is logged with who did it and when.
- Staff use the system on their **own smartphones**, so the system must be mobile-first.

---

## 5. Functional requirements – Salon

### 5.1 Clients
- **CL-01** Register clients with name, phone number (Kenyan format), optional WhatsApp number, notes and preferences.
- **CL-02** Keep full visit history: services, stylist, amount paid, rating.
- **CL-03** Record a client's **preferred stylist(s)**. Repeat requests are counted for staff performance.
- **CL-04** Show any outstanding **debt** on the client's profile.
- **CL-05 Guest clients:** a client who doesn't want to be saved can book or be served as a **guest** with just a **name** (phone optional). The booking and sale are still fully recorded and counted in sales, commission and reports. Limits: no visit history or reminders without a phone number, and **no debt** is allowed for a guest. A guest can be turned into a full client later.
- **CL-06** Optional fields: WhatsApp number, date of birth/age (0–12 = kids' prices), gender, area/estate, how they found the salon (Instagram, TikTok, Facebook, referral, walk-by).
- **CL-07** Children can be linked to a parent's phone number. One parent can have several children.
- **CL-08** Client summary: total visits, total spent, last visit date.
- **CL-09** Fast search by name or phone. All staff see client phone numbers; **only the owner can export** the client list.
- **CL-10** **Loyalty rewards** and **birthday messages** are optional features the owner can switch on later in Settings.

### 5.2 Services and products catalogue
- **SV-01** The owner manages the service menu: name, category, price (fixed or price range), estimated duration, commission %. The current menu is in **Appendix A**.
- **SV-03** Services are grouped in categories (Nails, Kids Hair, Adult Hair, Treatments & Care, Locs & Undo) with a **client type** (kids / adults).
- **SV-04** A service can have **variants with their own price**, for example *with extensions*, *with lines*, *arted*, *small size*. The receptionist picks the variant at booking or checkout.
- **SV-05** Some services have **no fixed price** (for example dye, chemical application) or a **price range** (for example Sisterlocs KSh 2,000–2,500). The final price is entered at checkout within the allowed range.
- **SV-06** Price changes keep history. Past sales keep the price they were charged at.
- **SV-08 Discounts:** stylists **can give discounts** at checkout, up to a **maximum set by the owner** (default 10%). A bigger discount needs the owner. Every discount records who gave it and why, and appears in reports. The owner can give any discount.
- **SV-09 Product commission:** stylists **earn commission on products they sell**, including extension hair, at the % set per product.
- **SV-10** Only the **owner** can add or edit services, products, prices and commission %. Stylists pick from the menu.
- **SV-11** Products used on clients can be recorded as **salon use** (reduces stock, not a sale).
- **SV-07** For "extended" services, the receptionist records whether the client **brought their own hair** or **bought it at the salon**. If bought, the hair is added to the same sale as a product and stock is reduced.
- **SV-02** The owner manages products for sale: name, price, cost, stock quantity, commission %.

### 5.3 Bookings (three channels)
Clients book by **phone call or social media message** (staff enter the booking), **or book themselves online** in the client app (BK-15).

- **BK-01 Salon booking:** date, time, service(s), assigned stylist(s), client.
- **BK-02 Home-service booking:** as BK-01 plus client location/address, number of stylists, and a **flexible** transport/call-out fee agreed per job.
- **BK-03 Walk-in:** added to a live **queue** and assigned to the next available stylist.
- **BK-04** Calendar view per day and week, per stylist, showing salon, home and walk-in jobs.
- **BK-05** Prevent double-booking a stylist. A stylist on a home service is shown as unavailable at the salon.
- **BK-06** Booking status: Booked → Confirmed → In progress → Completed / Cancelled / No-show.
- **BK-07** Record when a job is done by a **student under supervision**.
- **BK-08 Securing a booking:** a booking is only confirmed (slot held) once the client pays **either the full amount or a minimum deposit of KSh 500** (owner can change the minimum). Unpaid bookings stay "pending".
- **BK-09 Lateness:** a client **more than 20 minutes late** is **rescheduled** (the 20 minutes is an owner setting). The deposit moves to the new slot.
- **BK-10 No-show:** payments for a booking are **non-refundable** if the client fails to show up. The deposit is kept as salon income and shown separately in reports ("forfeited deposits").
- **BK-11** Booking source is recorded: call, WhatsApp, Instagram, Facebook, TikTok, in person, **online (client app)**.
- **BK-15 Online self-booking (added 22 Nov 2026):** clients open the client app, pick service(s), salon or home service, a day on a month calendar and **any time they like (to the minute)** within opening hours, and (optionally) a stylist – if that time is taken the app suggests the nearest free times – and submit a **booking request**. The request arrives as **"Requested"** and the salon (any stylist with receptionist duties, or the owner) **confirms, proposes another time, or declines**. The client is notified of the outcome. The deposit rule (BK-08) still applies: right after sending the request the client is offered an **M-Pesa prompt (STK push)** for the deposit (or can pay later from My bookings). Confirming a request with the deposit paid makes it *Booked*; without it, *Pending*. A declined request with a deposit is shown to the owner for refund. A requested time is held so no one else can take it.
- **BK-16 Client sign-in:** clients identify themselves with **phone number, email or WhatsApp** (one-time code sent to whichever they choose). Client sign-in is **not** location-restricted (AT-00 applies to staff only).
- **BK-17 Client view:** a signed-in client sees their upcoming and past bookings, can cancel or ask to reschedule, and sees any balance owed.
- **BK-12** Walk-in queue shows arrival order and waiting time. Any free stylist takes the next client, or the client waits for a chosen stylist.
- **BK-13** Reschedules and stylist changes keep a history. Cancellations need a reason.
- **BK-14** Bookings can only be made **within opening hours** (section 5.10).

### 5.10 Opening hours
| Business | Days | Hours |
|---|---|---|
| **Salon** | Monday – Saturday | From 8:00 am (closing time to confirm) |
| **Salon** | Sunday | 12:00 pm – 8:00 pm |
| **School** | Monday – Friday | From 9:00 am (closing time to confirm) |

Hours are owner settings and can be changed (for example for holidays).

### 5.4 Sales, checkout and payments
- **PY-01** Checkout combines services, products and any home-service fee into one sale.
- **PY-02** Payment methods: **Cash, M-Pesa Till, M-Pesa Paybill, M-Pesa Send Money**. **Card** is to be added later, so the design must allow new payment methods.
- **PY-03** For M-Pesa payments, staff record the **last 3 characters of the transaction code** and the **transaction time**.
- **PY-04** Split payments are allowed (for example part cash, part M-Pesa).
- **PY-05** Partial payment creates a **debt** linked to the client.
- **PY-06** Receipts sent by SMS/WhatsApp, with an optional printable receipt.
- **PY-07** Daily cash-up: expected vs. counted cash and M-Pesa totals per method.
- **PY-08 Who does the cash-up:** the **cash** count can be done by the **owner or any staff member** (for example the last to leave), and the system records who did it.
- **PY-09 M-Pesa reconciliation is owner-only:** only the owner confirms M-Pesa totals (Till, Paybill, Send Money) against her M-Pesa statements. M-Pesa Send Money is received on the **owner's number**.
- **PY-10** Only the **owner** can void a sale or approve a refund. Voids need a reason.
- **PY-11** At checkout any **deposit already paid** is deducted automatically, and **transport fees** for home services and **products** (for example extension hair) are added to the same bill.

### 5.5 Debts
- **DB-01** Record debts for **clients** (unpaid services/products) and **students** (unpaid fees) in the same system.
- **DB-02** Record debt repayments, in full or in part, with the payment method.
- **DB-03** Debt list with ageing (under 7 days, 7–30 days, over 30 days), plus automatic reminders on an owner-set schedule.
- **DB-04** Debts are created **only at checkout** (paid less than the total). Guests cannot hold debt.
- **DB-05** Optional **maximum debt per client**, set by the owner.
- **DB-06** An outstanding debt **pops up** when the client next books or arrives.
- **DB-07** Only the owner can **write off** a debt, with a reason. Write-offs appear in reports.
- **DB-08 Commission on unpaid work:** stylists earn **full commission on the job straight away**, whether or not the client has finished paying.
- *Note: debts are rare in this business, but the module is included.*

### 5.6 Stock / inventory
- **ST-01** Track stock for products sold and products **used during services**.
- **ST-02** Low-stock alert at an owner-defined level per item.
- **ST-03** Record stock received, adjustments and losses.
- **ST-04 Staff can add products**, but a new product stays **pending until the owner approves** it (including its price and commission %). Pending products cannot be sold.
- **ST-05 Recording use:** staff can record **every product used** on a client (for example 1 bottle of gel), linked to the job and stylist. This is switchable per product in Settings, so the owner can turn detailed tracking on or off.
- **ST-06 Suppliers:** a supplier list with name, contact, products supplied, purchase history and **amount owed to each supplier** (supplier payments recorded).
- **ST-07** Stock received is recorded against a supplier with quantity, cost and date.
- **ST-08** Only the owner can make stock adjustments (damaged, expired, missing), with a reason.
- **ST-09** Monthly stock count: counted vs. expected, with differences shown to the owner.
- **ST-10** Stock value (at cost) and product profit are visible to the owner only.

### 5.7 Staff, commission and performance
- **SF-01** Staff profiles: name, phone, roles, shifts and working days.
- **SF-02** Commission from **0% to 50%**, set per service or product, with an optional **per-staff override**.
- **SF-03** Automatic earnings statement per staff member for any period.
- **SF-07 Payout schedule:** the owner chooses **daily, weekly, every 2 weeks or monthly** (can differ per staff member). The system produces a payout statement per period.
- **SF-08 Discounts:** commission is calculated on the **price after discount**. This is fair to the salon (it only shares what it received) and discourages unnecessary discounts.
- **SF-09 Transport fee (home services):** recorded **separately from service sales** and **not commissioned**. By default it goes **in full to the stylist(s) who travelled**, split equally, to cover their fare. The owner can change this per job or in Settings (all to salon, or a set share).
- **SF-10 Basic salary (optional):** any staff member can have an optional **fixed salary** in addition to commission (default KSh 0). Payout = basic salary + commission + transport fees − advances.
- **SF-11** Commission rates have **history**: a rate change only affects new work. Commission on a **voided sale is removed** automatically.
- **SF-12 Advances:** the owner can record advances, deducted from the next payout. Payouts are recorded (amount, date, cash/M-Pesa) and unpaid balances shown.
- **SF-13** The **owner earns and is tracked for commission** when she works as a stylist.
- **SF-06 Joint work:** when two or more stylists share a job, the commission is **split between them**. The default is an equal split, and the receptionist or manager can adjust the shares per job (for example 60/40).
- **SF-04** Performance dashboard per staff member, based on:
  1. Number of clients served
  2. Sales value brought in
  3. Repeat clients who request them by name
  4. Punctuality and attendance
  5. Client ratings and complaints
- **SF-05** The owner can set the weighting of each performance measure. Default: sales 30%, clients served 20%, repeat requests 20%, punctuality 15%, ratings 15%. The result is a **score out of 100** per stylist.
- **SF-14 Leaderboard is owner-only.** Stylists see **only their own** score, breakdown and trend.
- **SF-15** Owner view: all scores, trends vs. last week/month, and warnings (for example repeated lateness or complaints).
- **SF-16 Targets (optional):** the owner can set monthly targets per stylist (sales, clients) with progress shown to that stylist.
- **SF-17 Rewards (optional):** "Stylist of the Month" and score-based bonuses can be switched on in Settings. A bonus is added to the payout statement.

### 5.8 Attendance and location-restricted login
The salon and the school share **one location** (Karuguru Junction, Kamakis), so one allowed area covers both.

- **AT-00** **All logins** for staff, tutors and students are allowed **only within the salon/school location**, not just attendance clock-in.
- **AT-00a** The **owner can log in from anywhere**.
- **AT-00b** The owner also works as a stylist, so her **work is tracked like everyone else's**: jobs, sales, clients, commission, performance and attendance clock-in (clock-in still happens at the salon).
- **AT-00c** A stylist at a **client's home** can log in there **with the owner's approval**. The approval covers that home-service job only, and the location is recorded.
- **AT-01** Staff clock in and out from their phones **only when at the salon's location**, within an owner-set radius (for example 100 m) of Karuguru Junction.
- **AT-02** **Relaxed at launch:** location (GPS) only, with a generous radius. The extra check (salon Wi-Fi and/or QR code) is **built but switched off** until the system stabilises. The owner turns it on in Settings when ready. Attempts that look suspicious are still logged for the owner, but they are not blocked.
- **AT-07** Shifts and working days per staff member, plus off days and leave (not counted as absent).
- **AT-08 Grace period:** late = clock-in after shift start plus an owner-set grace period (default **10 minutes**).
- **AT-09 Lateness** affects the performance score. An optional **pay deduction per late arrival** exists in Settings, **off by default**.
- **AT-10 Forgotten clock-out:** closed automatically at salon closing time and flagged for the owner.
- **AT-11** Attendance report per staff member: days present, late or absent, hours worked, monthly calendar view.
- **AT-03** Every attempt is logged with time, location and device. Attempts from outside the allowed area are flagged.
- **AT-04** Home-service exception: a stylist starting a home job records their GPS at the client's location, subject to the **owner's approval** (see AT-00c).
- **AT-05** Clock-in time is compared with the shift to measure lateness.
- **AT-06** The admin can correct attendance records, and every correction is logged.

### 5.9 Ratings and complaints
- **RT-01** A rating (1–5) and comment can be recorded at checkout by the receptionist **and/or** collected by an SMS/WhatsApp link after the visit. The owner chooses which.
- **RT-02** Complaints are logged against the visit and the staff member.

---

## 6. Functional requirements – School

- **SC-01 Courses:** the owner creates courses with name, duration, fee, intake dates and syllabus/units.
- **SC-02 Students:** enrolment with personal details, guardian/next of kin, course and intake.
- **SC-03 Fees:** payment plan per student (full, instalments or monthly). Fee balances are tracked, and payments use the same methods as the salon.
- **SC-04 Fee reminders:** automatic WhatsApp/SMS reminders before and after due dates.
- **SC-05 Attendance:** class attendance per student, marked by the tutor.
- **SC-06 Assessment:** marks, exams and practical assessments. Each can be switched on or off per course.
- **SC-07 Certificates:** record completion and certificate issue.
- **SC-08 Practicals:** link salon jobs done by students (BK-07) to the student's practical record.
- **SC-09 Tutors:** any staff member can be assigned as a tutor.
- **SC-10 Online school booking (added 22 Nov 2026):** students (and prospective students) use the same client app, signing in with phone, email or WhatsApp (BK-16), to **book the school**: choose a course and intake and submit a request. The school **confirms or declines**; on confirmation the student record and fee plan (SC-02, SC-03) are created. Enrolled students see their fee balance and pay by M-Pesa prompt. Booking class/practical slots is not included yet (to be confirmed).

---

## 7. Notifications (WhatsApp and SMS)

- **NT-01** Booking confirmation and reminder before the appointment.
- **NT-02** Receipt after payment.
- **NT-03** Debt and fee-balance reminders.
- **NT-04** Rating request after a visit, if enabled.
- **NT-05** The owner can edit message templates and turn each reminder on or off.
- **NT-06 Channel:** **WhatsApp first**, falling back to **SMS** if WhatsApp fails or the client has no WhatsApp.
- **NT-07** Appointment reminders the day before and 2 hours before. A notice is sent when a late client is rescheduled.
- **NT-08** Every message is logged with delivery status. The owner sees the monthly message count (messaging costs are separate from hosting).
- **NT-09** Guests without a phone number receive no messages.
- **RT-03** Ratings are collected **both ways** by default: entered at checkout, and a link sent after the visit (each can be switched off).
- **RT-04** A 1–2 star rating alerts the owner immediately. Complaints stay open until marked resolved.

## 8. Sales tracking, analysis and reports (high priority)

The owner has said sales tracking, analysis and reporting must be **"on point"**, so this is a core part of the system, not an extra.

### 8.1 Sales tracking
- **RP-01** Every sale is recorded with date and time, client, items (service/variant/product), staff member(s), channel (salon / home / walk-in), discount, amount, payment method(s) and M-Pesa reference. Nothing is sold outside the system.
- **RP-02** Sales cannot be deleted. Voids and refunds need a reason and a manager or owner, and they are shown in reports.
- **RP-03** A live **owner dashboard** shows today's sales so far, cash vs. M-Pesa, number of clients, walk-ins in the queue, and debts collected.

### 8.2 Analysis
- **RP-04** Compare any period with the previous one (today vs. yesterday, this week vs. last week, this month vs. last month), showing growth or decline in % and KSh.
- **RP-05** Best and worst sellers: top services, top products, top categories (Nails, Kids, Adults, and so on).
- **RP-06** Sales by **channel** (salon booking / home service / walk-in) and by **client type** (kids / adults).
- **RP-07** **Peak times**: busiest days of the week and hours of the day, to help plan staff shifts.
- **RP-08** Client analysis: new vs. returning clients, top-spending clients, and clients who haven't returned in a set number of days.
- **RP-09** Staff ranking by sales value, clients served and commission earned.
- **RP-10** Profit view: sales minus product cost and commission paid, so the owner sees what the business actually keeps.

### 8.3 Reports
- Sales by day, week or month, by service vs. product, by payment method, by staff member.
- **Daily close-out report:** totals per payment method vs. cash counted and M-Pesa received, plus differences.
- Charts (trend lines, bar charts) as well as tables, readable on a phone.

### 8.4 Additional reporting decisions
- **RP-11 Owner live dashboard** opens first on owner login: today's sales, cash vs. M-Pesa by method, clients served, average spend, walk-in queue, next bookings, who is clocked in or on a home service, and alerts (low stock, low ratings, lateness, cash-up differences, pending product approvals).
- **RP-12** Further analysis: booking source (Instagram, WhatsApp, TikTok, calls), kids vs. adults, no-shows and forfeited deposits, discounts given and by whom.
- **RP-13 Expenses (optional module):** the owner can record expenses (rent, utilities, Wi-Fi, cleaning, salaries) so the profit report can show **true profit**. If unused, profit = sales − product cost − commission − transport fees.
- **RP-14** Optional **daily WhatsApp summary** to the owner at closing time.
- **RP-15** Any date range; Excel/PDF export is owner-only.
- Debts outstanding (clients and students).
- Staff performance, attendance and commission/earnings.
- Booking statistics: salon vs. home vs. walk-in, cancellations, no-shows.
- Stock levels and stock movement.
- School: enrolments, fee collection, fee balances, attendance.
- Export to Excel/PDF.

---

## 9. Non-functional requirements

| ID | Requirement |
|---|---|
| NF-01 | **Mobile-first** web app that works well on staff smartphones. It is also usable on a computer at the front desk. |
| NF-02 | Online system. The salon has reliable internet, so offline mode is not required in version 1. |
| NF-03 | Secure login per user; passwords stored securely; access controlled by role. |
| NF-04 | Audit trail of edits and deletions to sales, payments, debts and attendance. |
| NF-05 | Daily automatic backups. |
| NF-06 | Hosting budget: **about KSh 2,500 per month**. |
| NF-07 | Currency KSh; Kenyan date, time and phone number formats; English interface. |
| NF-08 | Supports more branches in future (multi-branch ready). |
| NF-09 | Can add card payments and other payment methods later without a redesign. |
| NF-10 | **Brand colours: maroon, black and gold.** Used throughout the app, receipts, reports and messages, with the Dantesras logo. Text must stay easy to read (good contrast), including on phones in bright light. |
| NF-11 | **School logo:** `assets/branding/school-logo.png` ("Dantesras Hair and Beauty School": gold crowned D with a **purple** profile, on black). The school's screens and documents (fee receipts, certificates) use this logo. |

---

## 10. Constraints and risks

1. **M-Pesa verification (PY-03).** The last 3 characters plus the time are a weak check, and two payments can look alike. **Mitigation:** a daily reconciliation screen to compare against the M-Pesa statement. Automatic confirmation through Safaricom's Daraja API can be added later.
2. **Messaging costs.** SMS (for example through Africa's Talking) and the WhatsApp Business API charge per message. These costs are **separate from the KSh 2,500 hosting budget** and depend on volume.
3. **GPS reliability (AT-01).** Indoor GPS can be inaccurate and can be faked. The radius setting and the Wi-Fi/QR check mitigate this.

## 11. Out of scope for version 1

- Card payments (planned later)
- Offline mode

## 12. Decisions on earlier open questions

| # | Topic | Decision |
|---|---|---|
| 1 | Location restriction | Applies to **all logins**, not just clock-in (AT-00). |
| 2 | School location | **Same place as the salon**, so one allowed area. |
| 3 | Existing paper records | **Flexible:** the system offers an **import** (Excel template or manual entry of clients, students and debts) **or** a fresh start. The owner decides per record type. |
| 4 | Target launch | **About one week**, around 27 November 2026. See section 14. |
| 5 | Joint work | Commission is **split** between the stylists (SF-06). |

| 6 | Owner login | The owner logs in **from anywhere**. She also works as a stylist and is tracked like the others (AT-00a, AT-00b). |
| 7 | Home-service login | Allowed at the client's home **with the owner's approval** (AT-00c). |

All requirement questions are answered. The document is ready for owner review and sign-off.

---

## Appendix A – Service menu (as supplied, November 2026)

Prices in KSh. **"Ex" = extended** (with extensions), confirmed by the owner.

### A.1 Nails
| Service | Base price | Variant |
|---|---|---|
| Gel | 500 | |
| Builder gel | 1,200 | |
| Gum gel | 1,500 | With extensions: 1,700 |
| Pedi gel | 1,300 | |
| Plain pedicure | 800 | |
| Refill | 1,000 | |
| Tips gel | 1,000 | Arted (with nail art): 1,400 |

### A.2 Kids hair (ages 0–12)
| Service | Base price | Variant |
|---|---|---|
| 2 strands | 1,200 | With lines: 1,400 |
| Pussycats | 800 | With extensions: 1,200 |
| Updo | 700 | With extensions: 1,000 |
| Half – normal braids | 1,300 | |
| Half – knotless | 1,500 | |
| Half – plain hair | 800 | |
| 3 strands (own hair) | 800 | |
| Selfies | 1,200 | |
| Knotless – full head | 1,500 | |
| Knotless twists | 1,700 | |
| Goddess | 1,800 | |

### A.3 Adult hair
| Service | Base price | Variant |
|---|---|---|
| Knotless | 1,700 | |
| Half | 1,600 | With extensions: 1,800 · Goddess: 2,000 · Double extension: 2,400 |
| Backdo | 1,200 | With extensions: 1,500 |
| Updo | 1,500 | With extensions: 1,700 |
| Stitch lines | 1,800 | Updo: 2,000 · Half: 2,000 |
| Gel application | 1,000 | |
| Knotless twists | 1,800 | |
| Lines with crochets | 1,500 | |
| Loose braids | 1,800 | |
| Boho | 1,800 | |
| Marley twists | 1,800 (normal size) | Small size: from 2,500, flexible top-up (no maximum) |
| Mini braids | 2,500 | |
| Mini twists | 3,000 | |

### A.4 Treatments and care
| Service | Price |
|---|---|
| Deep treatment (client brings own product) | 500 |
| Leave-in treatment (client brings own product) | 200 |
| Wig wash | 700 |
| Chemical application | 2,500 |
| Dye | 3,000 |

### A.5 Locs and undo
| Service | Price |
|---|---|
| Retie – micro locs | 1,200 |
| Sisterlocks | 2,000 – 2,500 (flexible; final price set at checkout) |
| Locs undo | 1,500 |
| Undo – micro | 700 |
| Undo – mini (hair) | 500 |

### A.6 Owner decisions on the menu
| # | Topic | Decision |
|---|---|---|
| 1 | "Ex" | Means **extended** (with extensions). |
| 2 | Chemical application / Dye | KSh 2,500 / KSh 3,000. |
| 3 | Own treatment | The client brings their own products. |
| 4 | Sisterlocks | **Flexible**: the price is chosen within 2,000–2,500 at checkout. |
| 5 | Small Marley twists | **Flexible top-up** from 2,500, no maximum. |
| 6 | Kids pricing | Ages **0–12**. A client's age or birth date decides kids vs adult prices. |
| 7 | New services / home-service pricing | **Flexible**: the owner adds services and sets home-service prices in Settings. |
| 8 | Service duration | **Flexible**: no fixed duration. The receptionist sets the expected time per booking. An optional default per service can be added later. |
| 9 | Commission % | **Flexible**: set per service in Settings (0–50%). |

| 10 | Extension hair | **Not included** in the service price. The client either **brings their own** or **buys it at the salon**. A salon purchase is a product sale that reduces stock. |

---

## 14. Delivery plan (proposed)

The full scope (salon, school, stock, ratings, WhatsApp/SMS and reports) is too large to build **and test properly** in one week. Proposed phases:

| Phase | Target | Contents |
|---|---|---|
| **1 – Go-live** | ~1 week | Logins and roles with location restriction; clients; service and product menu with variants; bookings (salon, home, walk-in queue); checkout with cash and M-Pesa; debts; commission (including joint work); attendance clock-in; **owner sales dashboard, daily close-out, and sales reports by period, staff, service, payment method and channel (RP-01 to RP-06, RP-09)** |
| **2 – School** | +1–2 weeks | Courses, students, fee plans and balances, class attendance, marks, certificates, student practicals |
| **3 – Growth** | +1–2 weeks | WhatsApp/SMS reminders; ratings and complaints; full staff performance scores; stock alerts; peak times, client analysis and profit view (RP-07, RP-08, RP-10); Excel/PDF export; import of paper records |

The owner may reorder phases, for example if the school is needed first.

---

## Appendix B – School courses (as supplied, November 2026)

| Course | Fee (KSh) | Duration | Fee structure |
|---|---|---|---|
| Hairdressing | 8,000 per month | 3 months | Monthly, 24,000 total |
| Nail technology | 20,000 | 10 weeks | Total course fee (payment plan flexible) |
| Make-up | 18,000 | 7 weeks | Total course fee (payment plan flexible) |

Classes run **Monday – Friday from 9:00 am**. Courses, fees and durations are owner settings.

---

## 13. Sign-off

| Name | Role | Signature | Date |
|---|---|---|---|
| | Owner | | |
| | Developer | | |
