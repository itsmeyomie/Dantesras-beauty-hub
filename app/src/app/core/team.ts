import { Booking, Staff, StaffRoleDef } from './models';

/** Who is free and who is occupied – for the owner, manager and front desk when giving out work. */
export type TeamState = 'chair' | 'busy' | 'free';
export interface TeamMember {
  staff: Staff;
  state: TeamState;
  /** the booking that makes them busy (now, or at the time being checked) */
  with: Booking | null;
  /** their next booking later on */
  next: Booking | null;
  /** today's work, in time order */
  day: Booking[];
  label: string;
  /** finishes other stylists' work (and is not a main stylist) */
  finisher: boolean;
}

const HOLDS = ['requested', 'pending', 'booked', 'waiting', 'in_progress'];
const hhmm = (ms: number) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
export const clientName = (b: Booking) => b.clients?.name ?? b.guest_name ?? 'Client';

const has = (s: Staff, roles: StaffRoleDef[], flag: 'serves' | 'finishes') =>
  roles.length ? roles.some((r) => r[flag] && s.roles.includes(r.key)) : flag === 'serves' && s.roles.includes('stylist');
/** Everyone active who works on clients: main stylists and finishers. */
export function serving(staff: Staff[], roles: StaffRoleDef[] = []): Staff[] {
  return staff.filter((s) => s.active && (has(s, roles, 'serves') || has(s, roles, 'finishes')));
}
/** Can be the main stylist on a booking. */
export const isMain = (s: Staff, roles: StaffRoleDef[]) => has(s, roles, 'serves');
/** Finishes the main stylist's work. */
export const isFinisher = (s: Staff, roles: StaffRoleDef[]) => has(s, roles, 'finishes');

/** Start and end (ms) of a booking; a client in the chair keeps the stylist busy until checkout. */
export function span(b: Booking, now = Date.now()): [number, number] | null {
  const from = b.status === 'in_progress' ? (b.started_at ?? b.scheduled_at) : b.status === 'waiting' ? null : b.scheduled_at;
  if (!from) return null;
  const s = new Date(from).getTime();
  let e = s + (b.duration_min ?? 60) * 60000;
  if (b.status === 'in_progress') e = Math.max(e, now + 5 * 60000);
  return [s, e];
}

function mine(bookings: Booking[], id: string) {
  return bookings.filter((b) => HOLDS.includes(b.status) && (b.booking_staff ?? []).some((x) => x.staff_id === id));
}
const sortByTime = (list: Booking[]) =>
  [...list].sort((a, b) => (span(a)?.[0] ?? 0) - (span(b)?.[0] ?? 0));
const ORDER: Record<TeamState, number> = { free: 0, busy: 1, chair: 2 };

/** The team right now: in the chair, booked at this moment, or free (with their next client). */
export function teamNow(staff: Staff[], bookings: Booking[], now = Date.now(), roles: StaffRoleDef[] = []): TeamMember[] {
  return serving(staff, roles).map((s) => {
    const list = sortByTime(mine(bookings, s.id));
    const chair = list.find((b) => b.status === 'in_progress') ?? null;
    const busy = chair ?? list.find((b) => { const t = span(b, now); return !!t && t[0] <= now && t[1] > now; }) ?? null;
    const next = list.find((b) => b !== busy && (span(b, now)?.[0] ?? 0) > now) ?? null;
    const state: TeamState = chair ? 'chair' : busy ? 'busy' : 'free';
    const until = busy ? span(busy, now)?.[1] : null;
    const label = chair ? `With ${clientName(chair).split(' ')[0]}${until ? ' till ' + hhmm(until) : ''}`
      : busy ? `Booked till ${hhmm(until!)}`
      : next ? `Free · next ${hhmm(span(next, now)![0])}` : 'Free';
    return { staff: s, state, with: busy, next, day: list, label, finisher: isFinisher(s, roles) && !isMain(s, roles) };
  }).sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.staff.name.localeCompare(b.staff.name));
}

/** The team at a given time slot: who is free for [start, start + minutes). */
export function teamAt(staff: Staff[], bookings: Booking[], start: number, minutes: number, ignoreId?: string, now = Date.now(), roles: StaffRoleDef[] = []): TeamMember[] {
  const end = start + minutes * 60000;
  return serving(staff, roles).map((s) => {
    const list = sortByTime(mine(bookings, s.id).filter((b) => b.id !== ignoreId));
    const clash = list.find((b) => { const t = span(b, now); return !!t && t[0] < end && t[1] > start; }) ?? null;
    const state: TeamState = !clash ? 'free' : clash.status === 'in_progress' ? 'chair' : 'busy';
    let label = 'Free then';
    if (clash) {
      const t = span(clash, now)!;
      label = clash.status === 'in_progress' ? `In chair with ${clientName(clash).split(' ')[0]} till ${hhmm(t[1])}`
        : `Busy: ${clientName(clash).split(' ')[0]} ${hhmm(t[0])}–${hhmm(t[1])}`;
    }
    return { staff: s, state, with: clash, next: null, day: list, label, finisher: isFinisher(s, roles) && !isMain(s, roles) };
  }).sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.staff.name.localeCompare(b.staff.name));
}

/** "Esther & Mercy + finisher Faith" – who works on a booking. */
export function crewNames(b: Booking, firstOnly = false): string {
  const n = (s: { staff?: { name: string } }) => (firstOnly ? s.staff?.name?.split(' ')[0] : s.staff?.name);
  const st = b.booking_staff ?? [];
  const main = st.filter((s) => s.part !== 'finisher').map(n).filter(Boolean).join(' & ');
  const fin = st.filter((s) => s.part === 'finisher').map(n).filter(Boolean).join(' & ');
  return [main, fin ? 'finisher ' + fin : ''].filter(Boolean).join(' + ');
}
/** Main stylist ids only (not the finisher). */
export const mainIds = (b: Booking) => (b.booking_staff ?? []).filter((s) => s.part !== 'finisher').map((s) => s.staff_id);
