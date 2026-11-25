import { _android } from 'playwright';
const PKG = 'ke.dantesras.app.test';
const [d] = await _android.devices();
async function launch() {
  await d.shell(`am force-stop ${PKG}`);
  await d.shell(`monkey -p ${PKG} -c android.intent.category.LAUNCHER 1`);
  const wv = await d.webView({ pkg: PKG }, { timeout: 30000 });
  const p = await wv.page();
  p.on('console', (m) => console.log('   console:', m.type(), m.text().slice(0, 160)));
  await p.waitForTimeout(4000);
  return p;
}
let p = await launch();
await p.evaluate(() => { localStorage.clear(); });
await p.goto('http://localhost/staff/sign-in');
const v = () => p.locator('ion-router-outlet .ion-page:not(.ion-page-hidden)').last();
await v().getByTestId('su-email').fill('owner@dantesras.test');
await v().getByTestId('su-password').fill('test1234');
await v().getByTestId('su-submit').click();
await p.waitForTimeout(3000);
console.log('after sign in:', new URL(p.url()).pathname, '| token saved:', await p.evaluate(() => !!localStorage.getItem('dbh.staff.token')));
p = await launch();
console.log('after reopening:', new URL(p.url()).pathname, '| token saved:', await p.evaluate(() => !!localStorage.getItem('dbh.staff.token')), '| start href:', await p.evaluate(() => document.baseURI));
await d.close();
