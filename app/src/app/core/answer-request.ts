import { DataService } from './data.service';
import { Booking } from './models';
import { Ui } from './ui';

/** Accept a client's online request (the same as on the Desk). True when it was accepted. */
export async function acceptRequest(data: DataService, ui: Ui, b: Booking): Promise<boolean> {
  const note = await ui.prompt('Accept booking', 'Message to the client (optional)');
  if (note === null) return false;
  try {
    const st = await data.confirmBooking(b.id, note || null);
    ui.toast(st === 'booked' ? 'Booking accepted' : 'Accepted – waiting for the deposit');
    return true;
  } catch (e) {
    ui.error(e);
    return false;
  }
}

/** Decline a client's online request; the client is told why. True when it was declined. */
export async function declineRequest(data: DataService, ui: Ui, b: Booking): Promise<boolean> {
  const reason = await ui.prompt('Decline request', 'Reason / suggest another time (required)');
  if (!reason) return false;
  try {
    await data.declineBooking(b.id, reason);
    ui.toast('Declined – the client has been told');
    return true;
  } catch (e) {
    ui.error(e);
    return false;
  }
}
