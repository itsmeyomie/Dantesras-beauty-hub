import { inject } from '@angular/core';
import { CanActivateFn, Router, Routes } from '@angular/router';
import { StaffAuthService } from './core/staff-auth.service';
import { PortalService } from './portal/portal.service';

/** Client-app pages that need a signed-in client. */
const signedIn: CanActivateFn = (_route, state) => {
  const p = inject(PortalService);
  return p.signedIn() ? true : inject(Router).createUrlTree(['/portal/sign-in'], { queryParams: { returnUrl: state.url } });
};

/** Staff pages: approved account + the role may open this area (route data.area). */
const staff: CanActivateFn = async (route, state) => {
  const auth = inject(StaffAuthService);
  const router = inject(Router);
  if (!(await auth.ensureMe())) {
    // paused by the developer: still signed in – stay on this page (the paused screen covers it)
    if (auth.token() && auth.pausedOut) return true;
    return router.createUrlTree(['/staff/sign-in'], { queryParams: { returnUrl: state.url } });
  }
  const area = route.data['area'] as string | undefined;
  if (area === 'dev') await auth.checkDev();
  return !area || auth.can(area) ? true : router.parseUrl(auth.home());
};

const s = (path: string, area: string, load: () => Promise<unknown>) =>
  ({ path, canActivate: [staff], data: { area }, loadComponent: load }) as Routes[number];

export const routes: Routes = [
  // ----- client app (what clients and students see) -----
  { path: '', redirectTo: 'portal', pathMatch: 'full' },
  { path: 'portal', loadComponent: () => import('./portal/home.page').then((m) => m.PortalHomePage) },
  { path: 'portal/sign-in', loadComponent: () => import('./portal/sign-in.page').then((m) => m.PortalSignInPage) },
  { path: 'portal/privacy', loadComponent: () => import('./portal/privacy.page').then((m) => m.PortalPrivacyPage) },
  { path: 'portal/book', loadComponent: () => import('./portal/book.page').then((m) => m.PortalBookPage) },
  { path: 'portal/bookings', canActivate: [signedIn], loadComponent: () => import('./portal/bookings.page').then((m) => m.PortalBookingsPage) },
  { path: 'portal/notifications', canActivate: [signedIn], loadComponent: () => import('./portal/notifications.page').then((m) => m.PortalNotificationsPage) },
  { path: 'portal/account', loadComponent: () => import('./portal/account.page').then((m) => m.PortalAccountPage) },
  { path: 'portal/school', loadComponent: () => import('./portal/school.page').then((m) => m.PortalSchoolPage) },

  // ----- staff app (owner, manager, receptionist, stylist) -----
  { path: 'staff', redirectTo: 'staff/sign-in', pathMatch: 'full' },
  { path: 'staff/sign-in', loadComponent: () => import('./staff/staff-sign-in.page').then((m) => m.StaffSignInPage) },
  s('notifications', 'me', () => import('./staff/notifications.page').then((m) => m.StaffNotificationsPage)),
  s('more', 'more', () => import('./staff/more.page').then((m) => m.MorePage)),
  s('me', 'me', () => import('./staff/me.page').then((m) => m.MePage)),
  s('my-day', 'my-day', () => import('./staff/my-day.page').then((m) => m.MyDayPage)),
  s('my-calendar', 'my-day', () => import('./staff/my-calendar.page').then((m) => m.MyCalendarPage)),
  s('my-earnings', 'my-day', () => import('./staff/my-earnings.page').then((m) => m.MyEarningsPage)),
  s('roles', 'roles', () => import('./staff/roles.page').then((m) => m.RolesPage)),
  s('dev', 'dev', () => import('./staff/dev.page').then((m) => m.DevPage)),
  s('staff-requests', 'staff-requests', () => import('./staff/staff-requests.page').then((m) => m.StaffRequestsPage)),
  s('dashboard', 'dashboard', () => import('./staff/home.page').then((m) => m.StaffHomePage)),
  s('dashboard-classic', 'dashboard', () => import('./pages/dashboard.page').then((m) => m.DashboardPage)),
  s('desk', 'desk', () => import('./staff/desk.page').then((m) => m.DeskPage)),
  s('bookings', 'bookings', () => import('./pages/bookings.page').then((m) => m.BookingsPage)),
  s('checkout', 'checkout', () => import('./pages/checkout.page').then((m) => m.CheckoutPage)),
  s('sales', 'sales', () => import('./pages/sales.page').then((m) => m.SalesPage)),
  s('clients', 'clients', () => import('./pages/clients.page').then((m) => m.ClientsPage)),
  s('clients/:id', 'clients', () => import('./pages/client-detail.page').then((m) => m.ClientDetailPage)),
  s('debts', 'debts', () => import('./pages/debts.page').then((m) => m.DebtsPage)),
  s('outside', 'outside', () => import('./pages/outside.page').then((m) => m.OutsidePage)),
  s('services', 'services', () => import('./pages/services.page').then((m) => m.ServicesPage)),
  s('products', 'products', () => import('./pages/products.page').then((m) => m.ProductsPage)),
  s('staff-list', 'team', () => import('./pages/staff.page').then((m) => m.StaffPage)),
  { path: 'staff/list', redirectTo: 'staff-list' },
  s('school', 'school', () => import('./pages/school.page').then((m) => m.SchoolPage)),
  s('reports', 'reports', () => import('./pages/reports.page').then((m) => m.ReportsPage)),
  s('settings', 'settings', () => import('./pages/settings.page').then((m) => m.SettingsPage)),
  { path: '**', redirectTo: 'portal' },
];
