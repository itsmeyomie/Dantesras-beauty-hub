import { DataService } from './data.service';
import { Booking } from './models';
import { Ui, startOfDay } from './ui';

/** The booking is for a later day than today. */
export function bookedForLater(b: Booking): boolean {
  if (!b.scheduled_at) return false;
  return startOfDay(new Date(b.scheduled_at)).getTime() > startOfDay(new Date()).getTime();
}

/**
 * Check a client in (start the service).
 * Before the booking day staff must give a reason; the booking is then moved to today.
 * Returns false if staff cancelled.
 */
export async function checkIn(data: DataService, ui: Ui, b: Booking): Promise<boolean> {
  let reason: string | null = null;
  if (bookedForLater(b)) {
    const day = new Date(b.scheduled_at!).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    reason = await ui.prompt('Client came early', 'Reason (required)',
      `This booking is for ${day}. Why serve the client today? The booking will move to today.`);
    if (reason === null) return false;
    if (!reason) {
      void ui.toast('A reason is needed to serve the client before the booking day', 'danger');
      return false;
    }
  }
  const r = await data.startBooking(b.id, reason);
  void ui.toast(r.moved ? 'Checked in early – booking moved to today' : 'Started');
  return true;
}
