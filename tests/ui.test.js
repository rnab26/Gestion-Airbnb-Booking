process.env.FAKE_NOW = process.env.FAKE_NOW || '2026-10-27T10:00:00Z';
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
  await page.waitForSelector('[data-bar-start="2026-10-25"]');
  assert.match((await page.$$eval('[data-bar-start="2026-10-25"]', (els) => els.map((e) => e.textContent))).join(' '), /Jean/);
  assert.ok(!(await page.isVisible('text=Pour des dates toujours à jour')));
  await shot(page, '04-planning');
  // Aller jusqu'à décembre 2026, quel que soit le mois du jour.
  for (let i = 0; i < 24 && !(await page.isVisible('[data-day="2026-12-20"]:not(.out)')); i++) {
    const t = await page.textContent('.cal-head .title');
    await page.click(/2027|2028/.test(t) ? '#calPrev' : '#calNext');
  }
  assert.ok(await page.$eval('[data-day="2026-12-20"]', (e) => e.classList.contains('blocked')));
  await shot(page, '04b-decembre-dates-fermees');
  await page.click('#calToday');
  // Novembre : l'annulation n'est plus dans la liste, elle est dans « Annulations du mois »
  await page.click('#calNext');
  await page.waitForSelector('#cancelBox');
  assert.match(await page.textContent('#cancelBox summary'), /Annulations du mois \(1\)/);
  assert.ok(!(await page.isVisible('#cancelBox .item')), 'volet replié par défaut');
  const outside = await page.$$eval('.wrap > .item', (els) => els.map((e) => e.textContent).join(' '));
  assert.ok(!/Annulée/.test(outside), 'aucune annulation dans la liste principale');
  await page.click('#cancelBox summary');
  await shot(page, '04c-annulations-du-mois');
  await page.click('#calToday');
  // Détail d'un jour + ajout d'une note visible gestionnaire
  await page.click('[data-day="2026-10-29"]', { position: { x: 12, y: 12 } });
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
  assert.match(rev, /Revenus nets par mois/);
  assert.ok(rev.indexOf('Revenus nets par mois') < rev.indexOf('Factures Booking 2026 (1)'), 'les revenus par mois avant les factures');
  assert.equal(await page.$eval('#invoices', e => e.open), false, 'factures repliées');
  assert.match(rev, /novembre/);
  assert.match(rev, /séjour\(s\) de 2026 sans montant/, 'alerte limitée à l’année affichée');
  await shot(page, '05-revenus');

  // 6. Réservations : recherche, modification, montant
  await page.click('nav.tabs button[data-tab=resas]');
  await page.click('[data-view=all]'); // « Toutes » : le séjour de Jean peut déjà être passé selon la date du jour
  await page.fill('#resQ', 'jean');
  await page.waitForFunction(() => document.querySelectorAll('.item').length === 1);
  await page.fill('#resQ', '');
  await shot(page, '06-reservations');
  const item = await page.$('.item:has-text("Jean Dupont")');
  await item.click();
  await page.waitForSelector('#resForm');
  await page.fill('textarea[name=sharedNote]', 'Arrivée tardive vers 22h');
  assert.equal(await page.isVisible('input[name=phone]'), false, 'infos repliées sous « Modifier les informations »');
  await page.click('#resEdit summary');
  await page.fill('input[name=phone]', '06 12 34 56 78');
  await page.fill('input[name=checkout]', '2026-10-30');
  assert.equal(await page.textContent('[data-dow=checkout]'), 'Ven. 30 oct. 2026', 'jour de la semaine sous la date');
  await page.fill('input[name=checkout]', '2026-10-29');
  await page.click('#resSave');
  await toast(page, /Réservation enregistrée/);
  // Téléphone complet : bouton WhatsApp (numéro français → +33), sans ouvrir la réservation.
  assert.equal(await page.getAttribute('.item:has-text("Jean Dupont") [data-wa]', 'data-wa'), 'https://wa.me/33612345678');
  assert.match(await page.textContent('.item:has-text("Jean Dupont")'), /Dim\. 25 oct\. → Jeu\. 29 oct\./);
  // Fiche : boutons WhatsApp, Appeler et Airbnb.
  await page.click('.item:has-text("Jean Dupont")');
  await page.waitForSelector('.sheet');
  assert.equal(await page.getAttribute('.sh-actions .wa-btn', 'href'), 'https://wa.me/33612345678');
  assert.equal(await page.getAttribute('.sh-actions a:has-text("Écrire sur Airbnb")', 'href'), 'https://www.airbnb.fr/hosting/reservations/details/HMTEST0001');
  assert.ok(await page.isVisible('.sh-actions a:has-text("Appeler")'));
  await shot(page, '06b-fiche-airbnb');
  await page.click('[data-close]');
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

  // 7b. Import de l'export Booking (fichier synthétique, mêmes colonnes que le vrai)
  const bx = require('./fixtures/booking-export');
  await page.setInputFiles('#bkFile', { name: 'Départ du 2025-11-22 au 2026-11-22.xls', mimeType: 'application/vnd.ms-excel', buffer: bx.xls() });
  await toast(page, /Import : 5 nouvelle\(s\), 3 mise\(s\) à jour, 0 annulée\(s\), 0 inchangée\(s\), 0 erreur\(s\)/);
  assert.match(await page.textContent('#importLast'), /Départ du 2025-11-22 au 2026-11-22\.xls/);
  await shot(page, '07b-import-booking');
  await page.setInputFiles('#bkFile', { name: 'export.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: bx.xlsx() });
  await toast(page, /Import : 0 nouvelle\(s\), 0 mise\(s\) à jour, 0 annulée\(s\), 8 inchangée\(s\), 0 erreur\(s\)/);
  await page.setInputFiles('#bkFile', { name: 'liste.csv', mimeType: 'text/csv', buffer: Buffer.from('Nom;Prénom\nA;B\n') });
  await toast(page, /pas un export des réservations Booking/);
  assert.match(await page.textContent('#importLast'), /Import impossible/);
  await page.click('nav.tabs button[data-tab=resas]');
  await page.click('[data-view=all]');
  await page.fill('#resQ', 'Lucas Bernard');
  await page.waitForFunction(() => document.querySelectorAll('.item').length === 1);
  await page.click('.item:has-text("Lucas Bernard")');
  await page.waitForSelector('#resForm');
  assert.match(await page.textContent('.modal'), /Lue dans les e-mails Booking/);
  await page.click('[data-close]');
  await page.fill('#resQ', 'David Cohen');
  await page.waitForFunction(() => document.querySelectorAll('.item').length === 1);
  await page.click('.item:has-text("David Cohen")');
  const modal = await page.textContent('.modal');
  assert.match(modal, /Importée de l'export Booking · n° 7100000106/);
  assert.match(modal, /Dim\. 20 déc\. 2026/);
  assert.match(modal, /Prix payé par le client500,00\s€/);
  assert.match(modal, /Commission \+ frais de paiement Booking \(\d+,?\d* %\)− /);
  assert.match(modal, /Net pour toi/);
  assert.match(await page.textContent('.sheet'), /🌍\s*Israël/);
  assert.match(await page.textContent('.sh-dates'), /ArrivéeDim\. 20 déc\.dès 15:003\s*nuitsDépartMer\. 23 déc\.avant 10:00/);
  assert.equal(await page.getAttribute('.sh-actions a:has-text("Écrire sur Booking")', 'href'), 'https://admin.booking.com/');
  await page.click('[data-addphone]');
  assert.ok(await page.isVisible('input[name=phone]'), '« Ajouter le numéro » ouvre le champ téléphone');
  await shot(page, '07c-fiche-reservation-booking');
  await page.click('[data-close]');
  await page.fill('#resQ', '');
  // Revenus : commissions par plateforme et détail des paiements d'octobre (déroulant).
  await page.click('nav.tabs button[data-tab=revenus]');
  assert.match(await page.textContent('.wrap'), /Commissions [\d\s,]+€ \(\d+(,\d)? % du brut/);
  await page.click('details[data-mdet="2026-10"] summary');
  const pays = await page.textContent('details[data-mdet="2026-10"]');
  assert.match(pays, /Claire Martin/);
  assert.match(pays, /Jean Dupont/);
  assert.match(pays, /[\d\s,]+€ − comm\. [\d\s,]+€/);
  await shot(page, '07d-revenus-detail-octobre');
  await page.click('details[data-mdet="2026-10"] .pay:has-text("Claire Martin")');
  await page.waitForSelector('#resForm');
  await page.click('[data-close]');
  await page.click('nav.tabs button[data-tab=reglages]');

  // 7c. Message WhatsApp de la gestionnaire (réglable) : aperçu en direct, puis enregistré.
  await page.check('input[name=managerShowPhone]');
  await page.fill('input[name=managerLabel]', 'Candy');
  await page.fill('textarea[name=arrivalGuide]', 'Boîte à clés : code 1234\nWi-Fi : Maison');
  const prev = await page.textContent('#waPreview');
  assert.match(prev, /Je suis Candy, je m'occupe de votre arrivée/);
  assert.match(prev, /Boîte à clés : code 1234\nWi-Fi : Maison/);
  assert.ok(!/\{/.test(prev), 'tous les repères remplacés');
  await page.fill('input[name=minNights]', '2');
  await page.click('#setSave');
  await toast(page, /Réglages enregistrés/);
  // 7d. « Aperçu de sa page » : sa page dans l'application, sans perdre l'accès propriétaire.
  await page.click('#previewMgr');
  await page.waitForSelector('#curCard');
  assert.match(await page.textContent('.banner.info'), /Aperçu.*Candy/);
  assert.match(await page.textContent('#curCard'), /Locataire actuel.*Jean/s);
  assert.ok(!(await page.isVisible('nav.tabs')), 'menu propriétaire caché pendant l’aperçu');
  assert.ok(!(await page.isVisible('#mAddNote')), 'lecture seule');
  await shot(page, '07e-apercu-gestionnaire');
  await page.click('#exitPreview');
  await page.waitForSelector('#setForm');
  assert.ok(await page.isVisible('nav.tabs button[data-tab=revenus]'), 'retour à l’espace propriétaire');

  // 8. Page gestionnaire : planning sans montants
  const mp = await open(manager, 'manager');
  await mp.waitForSelector('.cal');
  const mtext = await mp.innerText('#app');
  // Les seuls montants visibles sont les siens (forfait par location), jamais ceux du propriétaire.
  for (const bad of ['412', 'Revenus nets', 'HMTEST', 'Dupont', 'Réglages', 'facture', 'commission']) assert.ok(!mtext.includes(bad), 'gestionnaire voit : ' + bad);
  const outsidePay = mtext.replace(await mp.innerText('#payCard'), '');
  assert.ok(!outsidePay.includes('€'), 'aucun montant hors de « Tes revenus »');
  // « Tes revenus » en haut, au-dessus du calendrier, pour le mois affiché : octobre = 4 départs
  // (Paul 1er, Claire 4, Marco 11 : perçus ; Jean 29 : à venir) × 50 €.
  assert.ok(mtext.indexOf('Tes revenus') < mtext.indexOf('Aujourd'), 'au-dessus du calendrier');
  assert.match(await mp.textContent('#payCard'), /Tes revenus · Octobre\s*200\s€\s*4 départs × 50\s€\s*✅ Déjà perçu 150\s€\s*⏳ À venir 50\s€/);
  assert.match(mtext, /Changer les draps/);
  assert.match(mtext, /Arrivée tardive vers 22h/);
  assert.match(mtext, /Ménage/);
  // Séjour en cours (Jean, 25 → 29 oct., on est le 27) : bandeau qui scintille + case « Locataire actuel ».
  assert.ok(await mp.$eval('[data-bar-start="2026-10-25"]', e => e.classList.contains('now')), 'bandeau du séjour en cours');
  assert.match(await mp.getAttribute('[data-bar-start="2026-10-25"]', 'style'), /var\(--airbnb\)/, 'couleur Airbnb');
  const cur = await mp.textContent('#curCard');
  assert.match(cur, /Locataire actuel/);
  assert.match(cur, /Jean/);
  assert.match(cur, /06 12 34 56 78/);
  assert.ok(mtext.indexOf('Locataire actuel') < mtext.indexOf('Prochains passages'), 'au-dessus des prochains passages');
  assert.ok(!/Jean/.test((await mp.$$eval('[data-mres]:not(#curCard)', els => els.map(e => e.textContent))).join(' ')), 'pas répété dans les prochains passages');
  const wa = await mp.getAttribute('#curCard [data-wa]', 'data-wa');
  assert.ok(wa.startsWith('https://wa.me/33612345678?text='), wa);
  const msg = decodeURIComponent(wa.split('?text=')[1]);
  assert.match(msg, /^Bonjour Jean 👋\nJe suis Candy, je m'occupe de votre arrivée à l'appartement le dimanche 25 octobre \(à partir de 15:00\)\./);
  assert.match(msg, /Boîte à clés : code 1234/);
  assert.match(await mp.textContent('.legend'), /Airbnb.*Booking.*En cours.*Libre.*Fermé.*Non réservable/s);
  await shot(mp, '08-gestionnaire');
  // Toucher la case ou un séjour du calendrier : la fiche complète (téléphone, WhatsApp, Appeler).
  await mp.click('#curCard .cur-h');
  await mp.waitForSelector('.modal .sh-actions');
  assert.match(await mp.textContent('.modal'), /Locataire actuel.*Jean.*Arrivée Dim\. 25 oct\. 2026.*06 12 34 56 78/s);
  assert.ok((await mp.getAttribute('.modal .wa-btn', 'href')).startsWith('https://wa.me/33612345678?text=Bonjour%20Jean'));
  assert.ok(await mp.isVisible('.modal a:has-text("Appeler")'));
  await shot(mp, '08b-gestionnaire-fiche');
  await mp.click('[data-close]');
  await mp.click('#calNext');
  assert.match(await mp.textContent('#payCard'), /Tes revenus · Novembre\s*100\s€\s*2 départs × 50\s€\s*✅ Déjà perçu 0\s€\s*⏳ À venir 100\s€/, 'la case suit le mois du calendrier');
  assert.match(await mp.getAttribute('[data-bar-start="2026-11-04"]', 'style'), /var\(--booking\)/, 'couleur Booking');
  // Démarcation des mois : séjour de Jean (parti le 29 oct.) atténué, noms des mois sous la 1re case et sous le 1er déc.
  assert.ok(await mp.$eval('[data-bar-start="2026-10-25"]', e => e.classList.contains('away')), 'séjour du mois précédent atténué');
  assert.ok(!(await mp.$eval('[data-bar-start="2026-11-04"]', e => e.classList.contains('away'))), 'séjour du mois normal');
  assert.equal(await mp.textContent('[data-day="2026-10-26"] .mo'), 'oct.');
  assert.equal(await mp.textContent('[data-day="2026-12-01"] .mo'), 'déc.');
  assert.equal(await mp.textContent('[data-day="2026-11-01"] .mo'), 'nov.');
  assert.equal(await mp.$('[data-day="2026-11-02"] .mo'), null);
  assert.ok(await mp.$eval('[data-day="2026-11-25"]', e => e.classList.contains('blocked')), 'fermeture Airbnb en gris foncé');
  await mp.click('[data-bar-start="2026-11-04"]');
  await mp.waitForSelector('.modal .sheet');
  assert.match(await mp.textContent('.modal'), /Séjour.*Booking.*Arrivée Mer\. 4 nov\. 2026/s);
  await mp.click('[data-close]');
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
