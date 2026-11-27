import { Service } from './models';

/** Staff pay rule "salon fee + finisher fee, then split the rest" (same sums as apply_fee_split in the database). */
export interface PayDefaults { salonFee: number; finisherFee: number; stylistPct: number; }
export interface PaySplit { services: number; salonFee: number; finisherFee: number; stylist: number; salonKeeps: number; }
export interface PayChoice { salon_fee: number; finisher_fee: number; stylist_pct: number; }

const r2 = (n: number) => Math.round(n * 100) / 100;

/** lines: service lines of the bill; factor: (subtotal − discount) / subtotal; choice: amounts set for this job. */
export function feeSplit(
  lines: { service_id: string | null; qty: number; unit_price: number }[],
  services: Service[], d: PayDefaults, factor: number, hasFinisher: boolean, choice?: PayChoice | null,
): PaySplit {
  let net = 0, salon = 0, fin = 0, sty = 0;
  for (const l of lines) {
    const sv = services.find((s) => s.id === l.service_id);
    const n = l.unit_price * l.qty * factor;
    const s = Math.min((sv?.salon_fee ?? d.salonFee) * l.qty, n);
    const f = hasFinisher ? Math.min((sv?.finisher_fee ?? d.finisherFee) * l.qty, n - s) : 0;
    net += n; salon += s; fin += f;
    sty += ((n - s - f) * (sv?.stylist_pct ?? d.stylistPct)) / 100;
  }
  if (choice) {
    salon = Number(choice.salon_fee);
    fin = hasFinisher ? Number(choice.finisher_fee) : 0;
    sty = ((net - salon - fin) * Number(choice.stylist_pct)) / 100;
  }
  sty = r2(sty); fin = r2(fin); salon = r2(salon); net = r2(net);
  return { services: net, salonFee: salon, finisherFee: fin, stylist: sty, salonKeeps: r2(net - fin - sty) };
}
