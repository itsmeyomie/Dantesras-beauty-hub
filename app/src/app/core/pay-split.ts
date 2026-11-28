import { Service } from './models';

/**
 * Staff pay in shillings: per service a salon fee, a finisher amount and a main-stylist amount;
 * the owner keeps the rest. A service without its own amount uses the Settings default.
 * Same sums as apply_fee_split in the database. Only the owner sees these figures.
 */
export interface PayDefaults { salonFee: number; finisherFee: number; stylistFee: number; }
export interface PaySplit { services: number; salonFee: number; finisherFee: number; stylist: number; ownerKeeps: number; salonKeeps: number; }
/** amounts the owner sets for one job: the salon fee and each person's own amount */
export interface PayChoice { salon_fee: number; people: Record<string, number | null>; }

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * lines: service lines of the bill; factor: (subtotal − discount) / subtotal.
 * choice: what the owner typed (finishers / mains say which people are which).
 */
export function feeSplit(
  lines: { service_id: string | null; qty: number; unit_price: number }[],
  services: Service[], d: PayDefaults, factor: number, hasFinisher: boolean,
  choice?: PayChoice | null, mains: string[] = [], finishers: string[] = [],
): PaySplit {
  let net = 0, salon = 0, fin = 0, sty = 0;
  for (const l of lines) {
    const sv = services.find((s) => s.id === l.service_id);
    const n = l.unit_price * l.qty * factor;
    const s = Math.min((sv?.salon_fee ?? d.salonFee) * l.qty, n);
    const f = hasFinisher ? Math.min((sv?.finisher_fee ?? d.finisherFee) * l.qty, n - s) : 0;
    const t = Math.min(Number(sv?.stylist_fee ?? d.stylistFee) * l.qty, n - s - f);
    net += n; salon += s; fin += f; sty += t;
  }
  if (choice) {
    const amt = (id: string) => Number(choice.people[id] ?? 0);
    salon = Number(choice.salon_fee);
    fin = hasFinisher ? finishers.reduce((a, id) => a + amt(id), 0) : 0;
    sty = mains.reduce((a, id) => a + amt(id), 0);
  }
  sty = r2(sty); fin = r2(fin); salon = r2(salon); net = r2(net);
  return { services: net, salonFee: salon, finisherFee: fin, stylist: sty, ownerKeeps: r2(net - salon - fin - sty), salonKeeps: r2(net - fin - sty) };
}
