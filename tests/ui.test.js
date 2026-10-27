// Parcours complet dans un vrai navigateur (Chromium), écran de téléphone,
// avec le vrai doGet/api de Code.gs branché sur les services simulés.
'use strict';
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { createEnv } = require('./gas-mock');
const { messages } = require('./fixtures/emails');
const { AIRBNB_URL, BOOKING_URL, airbnbIcs, bookingIcs } = require('./fixtures/ical');

const OUT = process.env.SHOTS || path.join(__dirname, 'screenshots');
fs.mkdirSync(OUT, { recursive: true });
const INVOICE = fs.readFileSync(__dirname + '/fixtures/booking-invoice-layout.txt', 'utf8')
  .replace('9900000001', '1670000001').replace('01/07/2026 - 31/07/2026', '01/11/2026 - 30/11/2026')
  .replace('EUR 2 500,00', 'EUR 1 000,00').replace('EUR 425,00', 'EUR 170,00').replace('EUR 37,50', 'EUR 15,00');

const SHIM = `<script>
(function(){
  function runner(ok, ko){
    return new Proxy({}, { get: function(_, name){
      if (name === 'withSuccessHandler') return function(f){ return runner(f, ko); };
      if (name === 'withFailureHandler') return function(f){ return runner(ok, f); };
      return function(){
        var args = Array.prototype.slice.call(arguments);
        window.__gas(name, JSON.stringify(args)).then(function(r){
          var o = JSON.parse(r);
          setTimeout(function(){ if (o.error) { ko && ko(new Error(o.error)); } else { ok && ok(o.value); } }, 30);
        });
      };
    }});
  }
  window.google = { script: { run: runner(null, null) } };
})();
</script>`;

async function main() {
  const env = createEnv({ messages: JSON.parse(JSON.stringify(messages)).concat([{ id: 'inv1', from: 'noreply@booking.com',
    date: '2026-12-03T12:04:21Z', subject: 'Booking.com Invoice 1670000001', body: '', attachment: INVOICE }]) });
  env.fetchMap[AIRBNB_URL] = { body: airbnbIcs() };
  env.fetchMap[BOOKING_URL] = { body: bookingIcs() };
  const browser = await chromium.launch();
  const errors = [];
  const ctxB = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'fr-FR', timezoneId: 'Europe/Paris' });

  async function open(k, name) {
    const page = await ctxB.newPage();
    page.on('pageerror', e => errors.push(name + ': ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(name + ' console: ' + m.text()); });
    await page.exposeFunction('__gas', (fn, argsJson) => {
      const args = JSON.parse(argsJson);
      try {
        const v = fn === 'install' ? env.install() : env.api.apply(null, args);
        return JSON.stringify({ value: v === undefined ? null : v });
      } catch (e) { return JSON.stringify({ error: e.message }); }
    });
    const html = env.ctx.doGet({ parameter: k ? { k } : {} }).getContent().replace('<head>', '<head>' + SHIM);
    await page.setContent(html);
    return page;
  }
  const shot = (page, n) => page.screenshot({ path: path.join(OUT, n + '.png'), fullPage: true });
  const toast = async (page, re) => {
    try {
      await page.waitForFunction(src => new RegExp(src).test((document.querySelector('#toast .t') || {}).textContent || ''), re.source, { timeout: 5000 });
    } catch (e) { throw new Error('toast attendu ' + re + ', vu : ' + await page.textContent('#toast')); }
  };

  // 1. Installation
  let page = await open(null, 'install');
  await page.click('#go');
  await page.waitForSelector('text=C\'est installé', { timeout: 10000 });
  const ownerUrl = await page.textContent('.linkbox');
  assert.match(ownerUrl, /\?k=[0-9a-f]{64}$/);
  await shot(page, '01-installation');
  const owner = ownerUrl.split('k=')[1];

  // 2. Propriétaire : planning (bannière calendriers, données issues des e-mails)
  page = await open(owner, 'owner');
  await page.waitForSelector('.cal');
  assert.ok(await page.isVisible('text=Pour des dates toujours à jour'));
  await shot(page, '02-planning-avant-calendriers');

  // 3. Réglages : ajouter les liens iCal → synchro auto
  await page.click('nav.tabs button[data-tab=reglages]');
  await page.fill('input[name=icalAirbnb]', AIRBNB_URL);
  await page.fill('input[name=icalBooking]', BOOKING_URL);
  await page.click('#setSave');
  await page.waitForFunction(() => /Synchronisé/.test((document.querySelector('#toast') || {}).textContent || ''), null, { timeout: 8000 });
  await shot(page, '03-reglages');

  // 4. Planning d'octobre 2026 : arrivée de Jean le 25
  await page.click('nav.tabs button[data-tab=planning]');
  await page.waitForSelector('[data-day="2026-10-25"]');
  assert.match(await page.textContent('[data-day="2026-10-25"]'), /▸ Jean/);
  assert.ok(!(await page.isVisible('text=Pour des dates toujours à jour')));
  await shot(page, '04-planning');
  await page.click('#calNext'); await page.click('#calNext');
  assert.match(await page.textContent('[data-day="2026-12-20"]'), /bloqué/);
  await shot(page, '04b-decembre-dates-fermees');
  await page.click('#calToday');
  // Détail d'un jour + ajout d'une note visible gestionnaire
  await page.click('[data-day="2026-10-29"]');
  await page.waitForSelector('.modal');
  assert.match(await page.textContent('.modal'), /Départ/);
  await page.click('[data-addnote]');
  await page.fill('textarea[name=text]', 'Changer les draps + lit bébé');
  await page.click('#noteSave');
  await toast(page, /Note ajoutée/);
  assert.ok(await page.isVisible('[data-day="2026-10-29"] .dot'));

  // 5. Revenus
  await page.click('nav.tabs button[data-tab=revenus]');
  await page.waitForSelector('.kpi');
  const rev = await page.textContent('.wrap');
  assert.match(rev, /Booking : factures lues/);
  assert.match(rev, /novembre/);
  assert.match(rev, /18,5 %/);
  await shot(page, '05-revenus');

  // 6. Réservations : recherche, modification, montant
  await page.click('nav.tabs button[data-tab=resas]');
  await page.fill('#resQ', 'jean');
  await page.waitForFunction(() => document.querySelectorAll('.item').length === 1);
  await page.fill('#resQ', '');
  await page.click('[data-view=all]');
  await shot(page, '06-reservations');
  const item = await page.$('.item:has-text("Jean Dupont")');
  await item.click();
  await page.waitForSelector('#resForm');
  await page.fill('textarea[name=sharedNote]', 'Arrivée tardive vers 22h');
  await page.click('#resSave');
  await toast(page, /Réservation enregistrée/);
  // Réservation directe : ajout puis suppression avec confirmation
  await page.click('#addRes2');
  await page.fill('input[name=guest]', 'Cousin Paul');
  await page.fill('input[name=checkin]', '2027-02-10');
  await page.fill('input[name=checkout]', '2027-02-12');
  await page.fill('input[name=amountGross]', '150');
  await shot(page, '07-nouvelle-reservation');
  await page.click('#resSave');
  await toast(page, /Réservation ajoutée/);
  await page.click('.item:has-text("Cousin Paul")');
  await page.click('[data-del]');
  await page.click('[data-a=yes]');
  await toast(page, /Réservation supprimée/);
  assert.ok(!(await page.isVisible('.item:has-text("Cousin Paul")')));
  // Erreur visible : départ avant arrivée
  await page.click('#addRes2');
  await page.fill('input[name=checkin]', '2027-02-10');
  await page.fill('input[name=checkout]', '2027-02-09');
  await page.click('#resSave');
  await toast(page, /départ doit être après/);
  await page.click('[data-close]');

  // 7. Lien gestionnaire
  await page.click('nav.tabs button[data-tab=reglages]');
  const mgrUrl = await page.textContent('#mgrLink');
  const manager = mgrUrl.split('k=')[1];

  // 8. Page gestionnaire : planning sans montants
  const mp = await open(manager, 'manager');
  await mp.waitForSelector('.cal');
  const mtext = await mp.innerText('#app');
  for (const bad of ['€', 'Revenus', 'HMTEST', 'Dupont', 'Réglages', 'facture']) assert.ok(!mtext.includes(bad), 'gestionnaire voit : ' + bad);
  assert.match(mtext, /Changer les draps/);
  assert.match(mtext, /Arrivée tardive vers 22h/);
  assert.match(mtext, /Ménage/);
  await shot(mp, '08-gestionnaire');
  await mp.click('#mAddNote');
  await mp.fill('textarea[name=text]', 'Plus de café');
  await mp.click('#noteSave');
  await toast(mp, /Note ajoutée/);
  await shot(mp, '09-gestionnaire-note');

  // 9. Le propriétaire voit la note de la gestionnaire
  const p2 = await open(owner, 'owner2');
  await p2.waitForSelector('.cal');
  await p2.click('nav.tabs button[data-tab=notes]');
  await p2.click('[data-nview=manager]');
  assert.match(await p2.textContent('.wrap'), /Plus de café/);

  // 10. Lien invalide
  const inv = await open('faux', 'invalid');
  assert.match(await inv.textContent('body'), /Lien invalide/);

  // Débordement horizontal sur téléphone ?
  for (const pg of [p2, mp]) {
    const w = await pg.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(w <= 390, 'débordement horizontal : ' + w);
  }
  await browser.close();
  assert.deepEqual(errors, []);
  console.log('UI OK — captures dans ' + OUT);
}
main().catch(e => { console.error(e); process.exit(1); });
