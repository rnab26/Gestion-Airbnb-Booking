'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEnv } = require('./gas-mock');
const { messages, airbnbConfirmation } = require('./fixtures/emails');
const { AIRBNB_URL, BOOKING_URL, airbnbIcs, bookingIcs } = require('./fixtures/ical');

function setup(o) {
  o = o || {};
  const env = createEnv({ messages: JSON.parse(JSON.stringify(messages)) });
  env.fetchMap[AIRBNB_URL] = { body: airbnbIcs() };
  env.fetchMap[BOOKING_URL] = { body: bookingIcs() };
  const res = env.install();
  const owner = res.ownerUrl.split('k=')[1];
  if (o.withIcal !== false) {
    const s = env.api(owner, 'load').settings;
    env.api(owner, 'saveSettings', Object.assign({}, s, { icalAirbnb: AIRBNB_URL, icalBooking: BOOKING_URL }));
  }
  const data = o.noSync ? env.api(owner, 'load') : env.api(owner, 'sync');
  const manager = data.managerUrl.split('k=')[1];
  return { env, owner, manager, data };
}
const byKey = (d, k) => d.reservations.find(r => r.key === k);

// ---------- lecture des e-mails (fonctions pures) ----------
test('Airbnb : e-mail de confirmation réel → code, voyageur, dates, net, total', () => {
  const { ctx } = createEnv();
  const m = messages[0];
  const p = ctx.parseAirbnbConfirmation_(m.subject, m.body, '2026-09-09');
  assert.deepEqual(JSON.parse(JSON.stringify(p)), { code: 'HMTEST0001', guest: 'Jean Dupont', checkin: '2026-10-25', checkout: '2026-10-29',
    guestsText: '3 adultes', guestsCount: '3', location: '', amountNet: '412.3', paidByGuest: '590' });
  const p2 = ctx.parseAirbnbConfirmation_(messages[1].subject, messages[1].body, '2026-05-11');
  assert.equal(p2.guestsCount, '3');
  assert.equal(p2.checkout, '2026-06-02');
  const p3 = ctx.parseAirbnbConfirmation_(messages[2].subject, messages[2].body, '2026-05-20');
  assert.equal(p3.amountNet, '1204.5', 'montant avec espace des milliers');
});

test('Airbnb : année déduite quand le séjour passe en janvier', () => {
  const { ctx } = createEnv();
  const body = airbnbConfirmation({ first: 'A', last: 'B', code: 'HMYEAR0001', arrLine: '30 DÉC.', datesLine: 'mer. 30 déc. sam. 2 janv.', guests: '1 adulte', earn: '100,00', total: '120,00' });
  const p = ctx.parseAirbnbConfirmation_('Réservation confirmée : A B arrive le 30 déc.', body, '2026-11-02');
  assert.equal(p.checkin, '2026-12-30');
  assert.equal(p.checkout, '2027-01-02');
  const q = ctx.parseAirbnbConfirmation_('Réservation confirmée : A B arrive le 30 déc.', body.replace('mer. 30 déc. sam. 2 janv.', 'sam. 2 janv. lun. 4 janv.'), '2026-12-20');
  assert.equal(q.checkin, '2027-01-02');
});

test('Airbnb : sujets d’annulation et d’e-mails à ignorer', () => {
  const { ctx } = createEnv();
  assert.equal(ctx.parseAirbnbCancellationSubject_('Annulation de la réservation HM8M2YSCJH (12–14 juin 2026)'), 'HM8M2YSCJH');
  assert.equal(ctx.isAirbnbConfirmationSubject_('Confirmation : voici votre reçu Airbnb pour votre voyage du 28 mai – 1 juin'), false);
  assert.equal(ctx.isAirbnbConfirmationSubject_('Réservation confirmée : Jean Dupont arrive le 25 oct.'), true);
  assert.equal(ctx.parseAirbnbCancellationSubject_('Resolution Center CLA-A9EANCTERK Escalated for Reservation HMF8JTDKW4'), '');
});

test('Booking : sujets réels → numéro, date d’arrivée, type', () => {
  const { ctx } = createEnv();
  const j = x => JSON.parse(JSON.stringify(x));
  assert.deepEqual(j(ctx.parseBookingSubject_('Booking.com - Nouvelle réservation ! (7100000001, mercredi 4 novembre 2026)')),
    { type: 'new', number: '7100000001', date: '2026-11-04', guest: '' });
  assert.deepEqual(j(ctx.parseBookingSubject_('Booking.com - Réservation annulée ! (7100000002, samedi 21 novembre 2026)')),
    { type: 'cancel', number: '7100000002', date: '2026-11-21', guest: '' });
  assert.equal(ctx.parseBookingSubject_('Booking.com - Votre attention est requise : Martin Lucas (7100000004)').guest, 'Martin Lucas');
  assert.equal(ctx.parseBookingSubject_('Booking.com - New booking! (7100000001, Wednesday, 4 November 2026)').date, '2026-11-04');
  assert.equal(ctx.parseBookingSubject_('Booking.com - Souhaitez-vous continuer à faire partie de notre programme Partenaires Préférés ?').number, '');
});

test('Montants : formats français et anglais', () => {
  const { ctx } = createEnv();
  assert.equal(ctx.parseAmount_('412,30 €'), 412.3);
  assert.equal(ctx.parseAmount_('1 204,50'), 1204.5);
  assert.equal(ctx.parseAmount_('1 204,50'), 1204.5);
  assert.equal(ctx.parseAmount_('1,204.50'), 1204.5);
  assert.equal(ctx.parseAmount_('450'), 450);
  assert.equal(ctx.parseAmount_('-10,25 €'), -10.25);
  assert.equal(ctx.parseAmount_('abc'), null);
});

test('iCal : lignes repliées, dates, résumé', () => {
  const { ctx } = createEnv();
  const ev = JSON.parse(JSON.stringify(ctx.parseIcs_(airbnbIcs())));
  assert.equal(ev.length, 3);
  assert.equal(ev[0].start, '2026-10-25');
  assert.equal(ev[0].end, '2026-10-29');
  assert.match(ev[0].description, /HMTEST0001\nPhone Number/);
});

// ---------- installation et accès ----------
test('Installation : base, liens, déclencheur, e-mail du lien', () => {
  const env = createEnv();
  const res = env.install();
  assert.match(res.directUrl, /^https:\/\/script\.google\.com\/macros\/s\/TEST\/exec\?k=[0-9a-f]{64}$/);
  assert.equal(res.ownerUrl, 'https://rnab26.github.io/Gestion-Airbnb-Booking/#' + res.directUrl, 'lien via l’application installable');
  assert.equal(env.ctx.doGet({ parameter: {} }).xfo, 'ALLOWALL', 'affichable dans l’application');
  const sync = env.triggers.filter(t => t.fn === 'syncAll');
  assert.equal(sync.length, 1);
  assert.equal(sync[0].every, '1h');
  assert.equal(env.triggers.filter(t => t.fn === 'autoUpdate').length, 1);
  assert.equal(env.mails.length, 1);
  assert.ok(env.mails[0].body.includes(res.ownerUrl));
  assert.ok(env.sheet('Reservations') && env.sheet('Notes') && env.sheet('Journal'));
  assert.throws(() => env.install(), /Déjà installé/);
});

test('Accès : mauvais lien refusé, gestionnaire limitée à ses actions', () => {
  const { env, manager } = setup();
  assert.throws(() => env.api('mauvais', 'load'), /Lien invalide/);
  assert.throws(() => env.api('', 'load'), /Lien invalide/);
  for (const a of ['saveReservation', 'saveSettings', 'sync', 'regenerateManagerLink', 'deleteReservation']) {
    assert.throws(() => env.api(manager, a, {}), /Action non autorisée/, a);
  }
  const page = env.ctx.doGet({ parameter: { k: 'mauvais' } }).getContent();
  assert.ok(page.includes('"mode":"invalid"'));
  const mpage = env.ctx.doGet({ parameter: { k: manager } }).getContent();
  assert.ok(mpage.includes('"mode":"manager"'));
});

// ---------- synchronisation ----------
test('Synchro complète : e-mails + iCal fusionnés correctement', () => {
  const { data } = setup();
  const keys = data.reservations.map(r => r.key).sort();
  assert.deepEqual(keys, ['airbnb-block:2026-11-25_2026-11-27', 'airbnb:HMTEST0001', 'airbnb:HMTEST0002', 'airbnb:HMTEST0003', 'airbnb:HMTEST0004',
    'booking-ical:2026-12-20_2026-12-23', 'booking-ical:2027-01-05_2027-10-22', 'booking:7100000001', 'booking:7100000002', 'booking:7100000003']);
  const a1 = byKey(data, 'airbnb:HMTEST0001');
  assert.equal(a1.net, 412.3);
  assert.equal(a1.guest, 'Jean Dupont');
  assert.equal(a1.checkout, '2026-10-29');
  assert.equal(byKey(data, 'airbnb:HMTEST0003').status, 'cancelled');
  assert.equal(byKey(data, 'airbnb:HMTEST0004').origin, 'ical');
  const b1 = byKey(data, 'booking:7100000001');
  assert.equal(b1.checkin, '2026-11-04');
  assert.equal(b1.checkout, '2026-11-07', 'départ récupéré dans l’iCal Booking');
  assert.equal(b1.missingAmount, true);
  assert.equal(byKey(data, 'booking:7100000002').status, 'cancelled');
  assert.equal(byKey(data, 'booking:7100000003').checkout, '2026-11-18');
  assert.ok(data.lastSync.ok, data.lastSync.message);
  assert.deepEqual(data.overlaps, []);
  // « Not available » Airbnb = dates bloquées (gris) ; dates Airbnb réimportées dans Booking : rien de plus.
  assert.equal(data.reservations.filter(r => r.checkin === '2026-11-25').map(r => r.status).join(), 'blocked');
  assert.equal(data.reservations.filter(r => r.checkin === '2026-10-25').length, 1);
});

test('Synchro relancée : rien ne change (idempotente)', () => {
  const { env, owner, data } = setup();
  const again = env.api(owner, 'sync');
  assert.match(again.lastSync.message, /^0 nouvelle\(s\), 0 mise\(s\) à jour, 0 annulée\(s\)/);
  assert.deepEqual(again.reservations.map(r => r.key + r.updatedAt), data.reservations.map(r => r.key + r.updatedAt));
});

test('Revenus : Airbnb net, Booking brut − commission, répartition par nuit', () => {
  const { env, owner, data } = setup();
  const oct = data.stats['2026'].months[9];
  assert.equal(oct.revenue, 412.3);
  assert.equal(oct.nights, 4);
  const b1 = byKey(data, 'booking:7100000001');
  let d = env.api(owner, 'saveReservation', Object.assign({}, b1, { amountGross: '450' }));
  const nb = byKey(d, 'booking:7100000001');
  assert.equal(nb.net, 373.5, '450 × (1 − 17 %), taux par défaut sans facture');
  assert.equal(d.stats['2026'].months[10].revenue, 373.5);
  // Changer la commission recalcule partout.
  d = env.api(owner, 'saveSettings', Object.assign({}, d.settings, { bookingCommissionPct: '20' }));
  assert.equal(byKey(d, 'booking:7100000001').net, 360);
  // La saisie est protégée contre la synchro suivante.
  d = env.api(owner, 'sync');
  assert.equal(byKey(d, 'booking:7100000001').amountGross, '450');
  // Annulée : ne compte plus, sauf si « payée quand même ».
  const a1 = byKey(d, 'airbnb:HMTEST0001');
  d = env.api(owner, 'saveReservation', Object.assign({}, a1, { status: 'cancelled', keepRevenue: false }));
  assert.equal(d.stats['2026'].months[9].revenue, 0);
  d = env.api(owner, 'saveReservation', Object.assign({}, byKey(d, 'airbnb:HMTEST0001'), { keepRevenue: true }));
  assert.equal(d.stats['2026'].months[9].revenue, 412.3);
});

test('Séjour à cheval sur deux mois : revenu réparti par nuit', () => {
  const { env, owner } = setup({ withIcal: false });
  const d = env.api(owner, 'saveReservation', { guest: 'Direct', checkin: '2026-01-30', checkout: '2026-02-03', amountGross: '400', status: 'confirmed', source: 'direct' });
  assert.equal(d.stats['2026'].months[0].revenue, 200);
  assert.equal(d.stats['2026'].months[1].revenue, 200);
  assert.equal(d.stats['2026'].months[0].nights, 2);
});

test('Réservation directe : créer, modifier, supprimer ; synchronisée : masquer, réafficher', () => {
  const { env, owner } = setup();
  let d = env.api(owner, 'saveReservation', { guest: 'Ami', checkin: '2027-01-10', checkout: '2027-01-12', amountGross: '200', status: 'confirmed', source: 'direct' });
  const r = d.reservations.find(x => x.guest === 'Ami');
  assert.equal(r.net, 200);
  d = env.api(owner, 'saveReservation', Object.assign({}, r, { guest: 'Ami Paul' }));
  assert.ok(d.reservations.find(x => x.guest === 'Ami Paul'));
  d = env.api(owner, 'deleteReservation', { id: r.id });
  assert.ok(!d.reservations.find(x => x.id === r.id));
  const a2 = byKey(d, 'airbnb:HMTEST0002');
  d = env.api(owner, 'deleteReservation', { id: a2.id });
  assert.equal(byKey(d, 'airbnb:HMTEST0002').hidden, '1');
  d = env.api(owner, 'sync');
  assert.equal(byKey(d, 'airbnb:HMTEST0002').hidden, '1', 'reste masquée après synchro');
  d = env.api(owner, 'restoreReservation', { id: a2.id });
  assert.equal(byKey(d, 'airbnb:HMTEST0002').hidden, '');
});

test('Validations : dates et montants invalides refusés avec un message clair', () => {
  const { env, owner, data } = setup({ withIcal: false });
  assert.throws(() => env.api(owner, 'saveReservation', { checkin: '', status: 'confirmed' }), /Date d'arrivée/);
  assert.throws(() => env.api(owner, 'saveReservation', { checkin: '2026-05-05', checkout: '2026-05-04' }), /départ doit être après/);
  assert.throws(() => env.api(owner, 'saveReservation', { checkin: '2026-05-05', amountGross: 'beaucoup' }), /montant invalide/);
  assert.throws(() => env.api(owner, 'saveSettings', Object.assign({}, data.settings, { bookingCommissionPct: '99' })), /entre 0 et 60/);
  assert.throws(() => env.api(owner, 'saveSettings', Object.assign({}, data.settings, { icalAirbnb: 'http://x' })), /https/);
  assert.throws(() => env.api(owner, 'saveSettings', Object.assign({}, data.settings, { checkinTime: '25:00' })), /HH:MM/);
  assert.throws(() => env.api(owner, 'saveNote', { date: '2026-05-05', text: '   ' }), /vide/);
});

test('Revenir aux valeurs synchronisées', () => {
  const { env, owner, data } = setup();
  const a1 = byKey(data, 'airbnb:HMTEST0001');
  let d = env.api(owner, 'saveReservation', Object.assign({}, a1, { amountNet: '10' }));
  assert.equal(byKey(d, 'airbnb:HMTEST0001').net, 10);
  assert.deepEqual(byKey(d, 'airbnb:HMTEST0001').lockedFields, ['amountNet']);
  d = env.api(owner, 'resetReservation', { id: a1.id });
  assert.equal(byKey(d, 'airbnb:HMTEST0001').net, 412.3);
  assert.deepEqual(byKey(d, 'airbnb:HMTEST0001').lockedFields, []);
  assert.equal(d.reservations.length, data.reservations.length, 'pas de doublon après relecture des e-mails');
});

test('Calendrier injoignable : erreur affichée, aucune réservation perdue', () => {
  const { env, owner, data } = setup();
  env.fetchMap[BOOKING_URL] = { code: 500, body: 'oops' };
  const d = env.api(owner, 'sync');
  assert.equal(d.lastSync.ok, false);
  assert.match(d.lastSync.message, /Calendrier Booking : le lien répond 500/);
  assert.equal(d.reservations.length, data.reservations.length);
});

test('Booking : dates disparues de l’iCal retirées ; e-mail arrivé après : saisies conservées', () => {
  const { env, owner, data } = setup();
  // Note saisie sur la réservation vue seulement dans l'iCal
  const ph = byKey(data, 'booking-ical:2026-12-20_2026-12-23');
  env.api(owner, 'saveReservation', Object.assign({}, ph, { note: 'client fidèle', amountGross: '300' }));
  // L'e-mail Booking arrive ensuite pour ces dates
  env.gmail.messages.push({ id: 'b9', from: 'noreply@booking.com', date: new Date().toISOString(), subject: 'Booking.com - Nouvelle réservation ! (7000000001, dimanche 20 décembre 2026)', body: '' });
  let d = env.api(owner, 'sync');
  assert.ok(!byKey(d, 'booking-ical:2026-12-20_2026-12-23'), 'plus de doublon');
  const real = byKey(d, 'booking:7000000001');
  assert.equal(real.checkout, '2026-12-23');
  assert.equal(real.note, 'client fidèle');
  assert.equal(real.amountGross, '300');
  // Dates sans e-mail qui disparaissent du calendrier : retirées
  env.fetchMap[BOOKING_URL] = { body: bookingIcs({ withoutPlaceholder: true }) };
  d = env.api(owner, 'sync');
  assert.ok(byKey(d, 'booking:7000000001'), 'une réservation connue par e-mail n’est jamais effacée');
});

test('Double réservation détectée', () => {
  const { env, owner } = setup();
  const d = env.api(owner, 'saveReservation', { guest: 'Doublon', checkin: '2026-10-27', checkout: '2026-10-30', status: 'confirmed', source: 'direct' });
  assert.equal(d.overlaps.length, 1);
});

// ---------- page gestionnaire ----------
test('Gestionnaire : aucun montant, aucun code, aucune note privée (filtré serveur)', () => {
  const { env, owner, manager, data } = setup();
  env.api(owner, 'saveReservation', Object.assign({}, byKey(data, 'airbnb:HMTEST0001'), { note: 'SECRET-PRIVE', sharedNote: 'Lit bébé' }));
  env.api(owner, 'saveNote', { date: '2026-10-28', text: 'Note privée proprio', visible: false });
  env.api(owner, 'saveNote', { date: '2026-10-29', text: 'Changer les draps', visible: true });
  const m = env.api(manager, 'load');
  const raw = JSON.stringify(m);
  for (const forbidden of ['412.3', 'HMTEST', 'SECRET-PRIVE', 'Note privée proprio', 'amountNet', 'amountGross', 'paidByGuest', 'Dupont', 'icalAirbnb', 'bookingCommissionPct']) {
    assert.ok(!raw.includes(forbidden), 'fuite : ' + forbidden);
  }
  assert.ok(raw.includes('Changer les draps'));
  const r = m.reservations.find(x => x.checkin === '2026-10-25');
  assert.equal(r.guest, 'Jean');
  assert.equal(r.sharedNote, 'Lit bébé');
  assert.equal(r.guestsText, '3 adultes');
  assert.ok(!m.reservations.some(x => x.checkin === '2026-11-21'), 'annulée absente');
});

test('Gestionnaire : réglages de confidentialité appliqués', () => {
  const { env, owner, manager, data } = setup();
  env.api(owner, 'saveSettings', Object.assign({}, data.settings, { managerShowGuestName: false, managerShowGuestCount: false }));
  const m = env.api(manager, 'load');
  assert.ok(m.reservations.every(r => r.guest === '' && r.guestsText === ''));
});

test('Gestionnaire : ses notes oui, celles du propriétaire non ; option désactivable', () => {
  const { env, owner, manager } = setup();
  let o = env.api(owner, 'saveNote', { date: '2026-10-29', text: 'Note proprio visible', visible: true });
  const ownerNote = o.notes[0];
  let m = env.api(manager, 'saveNote', { date: '2026-10-30', text: 'Plus de café' });
  const mine = m.notes.find(n => n.text === 'Plus de café');
  assert.equal(mine.author, 'manager');
  assert.throws(() => env.api(manager, 'deleteNote', { id: ownerNote.id }), /tes propres notes/);
  assert.throws(() => env.api(manager, 'saveNote', { id: ownerNote.id, date: '2026-10-29', text: 'hack' }), /tes propres notes/);
  o = env.api(owner, 'load');
  assert.ok(o.notes.some(n => n.text === 'Plus de café'), 'le propriétaire voit la note');
  m = env.api(manager, 'deleteNote', { id: mine.id });
  assert.ok(!m.notes.some(n => n.text === 'Plus de café'));
  env.api(owner, 'saveSettings', Object.assign({}, o.settings, { managerCanAddNotes: false }));
  assert.throws(() => env.api(manager, 'saveNote', { date: '2026-10-30', text: 'x' }), /désactivé/);
});

test('Changer le lien gestionnaire : l’ancien ne marche plus', () => {
  const { env, owner, manager } = setup({ withIcal: false });
  const d = env.api(owner, 'regenerateManagerLink');
  assert.throws(() => env.api(manager, 'load'), /Lien invalide/);
  env.api(d.managerUrl.split('k=')[1], 'load');
});

test('Fréquence de synchro : déclencheur recréé', () => {
  const { env, owner, data } = setup({ withIcal: false });
  env.api(owner, 'saveSettings', Object.assign({}, data.settings, { syncEveryHours: 6 }));
  const sync = () => env.triggers.filter(t => t.fn === 'syncAll');
  assert.equal(sync().length, 1);
  assert.equal(sync()[0].every, '6h');
  env.api(owner, 'saveSettings', Object.assign({}, data.settings, { syncEveryHours: 24 }));
  assert.equal(sync()[0].every, '1d');
  assert.equal(env.triggers.filter(t => t.fn === 'autoUpdate').length, 1, 'mise à jour auto conservée');
});

// ---------- Booking : factures mensuelles ----------
const fs = require('fs');
const INVOICE_LAYOUT = fs.readFileSync(__dirname + '/fixtures/booking-invoice-layout.txt', 'utf8');
const INVOICE_RAW = fs.readFileSync(__dirname + '/fixtures/booking-invoice-raw.txt', 'utf8');

test('Facture Booking réelle (2 mises en page) → période, ventes, commission, frais', () => {
  const { ctx } = createEnv();
  for (const txt of [INVOICE_LAYOUT, INVOICE_RAW]) {
    const inv = JSON.parse(JSON.stringify(ctx.parseBookingInvoice_(txt, 'Booking.com Invoice 9900000001')));
    assert.deepEqual(inv, { number: '9900000001', periodStart: '2026-07-01', periodEnd: '2026-07-31',
      sales: '2500', commission: '425', paymentFees: '37.5', total: '462.5' });
  }
  assert.equal(ctx.parseBookingInvoice_('rien à voir', ''), null);
});

function novInvoice() {
  return INVOICE_LAYOUT.replace('9900000001', '1670000001').replace('01/07/2026 - 31/07/2026', '01/11/2026 - 30/11/2026')
    .replace('EUR 2 500,00', 'EUR 1 000,00').replace('EUR 425,00', 'EUR 170,00').replace('EUR 37,50', 'EUR 15,00');
}

test('Booking : facture lue → net réel réparti, taux réel, mois futurs estimés', () => {
  const { env, owner } = setup();
  env.gmail.messages.push({ id: 'inv1', from: 'Booking.com <noreply@booking.com>', date: '2026-12-03T12:04:21Z',
    subject: 'Booking.com Invoice 1670000001', body: 'Nouvelle facture', attachment: novInvoice() });
  let d = env.api(owner, 'sync');
  assert.match(d.lastSync.message, /1 facture\(s\) Booking lue\(s\)/);
  assert.equal(env.drive.deleted, 1, 'fichier temporaire Drive supprimé');
  assert.equal(Object.keys(env.drive.files).length, 0);
  assert.equal(d.booking.invoices.length, 1);
  assert.equal(d.booking.invoices[0].net, 815);
  assert.equal(d.booking.ratePct, 18.5, '(170 + 15) / 1000');
  assert.equal(d.booking.rateSource, 'factures');
  const b1 = byKey(d, 'booking:7100000001'), b2 = byKey(d, 'booking:7100000003');
  assert.equal(b1.net, 407.5); assert.equal(b1.amountKind, 'facture');
  assert.equal(b2.net, 407.5);
  assert.equal(d.stats['2026'].months[10].revenue, 815);
  // Dates fermées sans e-mail : pas une réservation, aucun revenu estimé
  let ph = byKey(d, 'booking-ical:2026-12-20_2026-12-23');
  assert.equal(ph.status, 'blocked');
  assert.equal(ph.counted, false);
  assert.equal(byKey(d, 'booking-ical:2027-01-05_2027-10-22').counted, false, 'longue fermeture hors revenus');
  assert.equal(d.stats['2027'], undefined, 'aucune nuit comptée en 2027');
  // Le propriétaire indique que c'est une vraie réservation : décembre, pas encore facturé, est estimé
  d = env.api(owner, 'saveReservation', Object.assign({}, ph, { status: 'confirmed' }));
  ph = byKey(d, 'booking-ical:2026-12-20_2026-12-23');
  assert.equal(ph.amountKind, 'estimé');
  assert.equal(ph.net, 407.5);
  assert.equal(d.stats['2026'].months[11].estimated, 407.5);
  d = env.api(owner, 'sync');
  assert.equal(byKey(d, 'booking-ical:2026-12-20_2026-12-23').status, 'confirmed', 'choix conservé à la synchro');
  assert.deepEqual(d.reservations.filter(r => r.missingAmount).map(r => r.key), ['airbnb:HMTEST0004'], 'Booking : plus rien à saisir');
  // Montant saisi à la main sur une réservation : le reste de la facture va à l'autre
  d = env.api(owner, 'saveReservation', Object.assign({}, b1, { amountNet: '500' }));
  assert.equal(byKey(d, 'booking:7100000003').net, 315);
  assert.equal(d.stats['2026'].months[10].revenue, 815);
  // Prix client saisi : converti avec le taux réel des factures
  d = env.api(owner, 'saveReservation', Object.assign({}, byKey(d, 'booking:7100000001'), { amountNet: '', amountGross: '600' }));
  assert.equal(byKey(d, 'booking:7100000001').net, 489, '600 × (1 − 18,5 %)');
  // Facture déjà lue : pas relue, pas de doublon
  d = env.api(owner, 'sync');
  assert.equal(d.booking.invoices.length, 1);
  assert.equal(env.drive.n, 1);
});

test('Booking : facture sans réservation identifiée → revenu quand même compté', () => {
  const { env, owner } = setup();
  env.gmail.messages.push({ id: 'inv7', from: 'noreply@booking.com', date: '2026-08-03T08:49:15Z',
    subject: 'Booking.com Invoice 9900000001', body: '', attachment: INVOICE_LAYOUT });
  const d = env.api(owner, 'sync');
  assert.equal(d.stats['2026'].months[6].revenue, 2037.5, '2500 − 425 − 37,5');
  assert.equal(d.stats['2026'].total.bySource.booking >= 2037.5, true);
});

test('Booking : conversion PDF en échec → avertissement, nouvel essai ensuite', () => {
  const { env, owner } = setup();
  env.gmail.messages.push({ id: 'inv1', from: 'noreply@booking.com', date: '2026-12-03T12:04:21Z',
    subject: 'Booking.com Invoice 1670000001', body: '', attachment: novInvoice() });
  env.drive.fail = true;
  let d = env.api(owner, 'sync');
  assert.match(d.lastSync.message, /non lue .*nouvel essai/);
  assert.equal(d.booking.invoices.length, 0);
  env.drive.fail = false;
  d = env.api(owner, 'sync');
  assert.equal(d.booking.invoices.length, 1);
});

test('Commission Booking : vide = taux des factures, sinon réglage', () => {
  const { env, owner, data } = setup();
  assert.equal(data.booking.ratePct, 17);
  assert.equal(data.booking.rateSource, 'défaut');
  const d = env.api(owner, 'saveSettings', Object.assign({}, data.settings, { bookingCommissionPct: '15,5' }));
  assert.equal(d.booking.ratePct, 15.5);
  assert.equal(d.booking.rateSource, 'réglage');
});

test('Gestionnaire : aucune donnée de facture', () => {
  const { env, owner, manager } = setup();
  env.gmail.messages.push({ id: 'inv1', from: 'noreply@booking.com', date: '2026-12-03T12:04:21Z',
    subject: 'Booking.com Invoice 1670000001', body: '', attachment: novInvoice() });
  env.api(owner, 'sync');
  const raw = JSON.stringify(env.api(manager, 'load'));
  for (const f of ['1670000001', '"net"', '407.5', 'invoices', 'ratePct']) assert.ok(!raw.includes(f), f);
});

test('Boîte très chargée : lecture étalée sur plusieurs synchros, rien de perdu', () => {
  const { env, owner } = setup({ noSync: true, withIcal: false });
  for (let i = 0; i < 900; i++) env.gmail.messages.unshift({ id: 'p' + i, from: 'automated@airbnb.com', date: '2026-01-01T10:00:00Z', subject: 'Promo ' + i, body: '' });
  let d = env.api(owner, 'sync');
  assert.match(d.lastSync.message, /suite à la prochaine synchro/);
  let n = 1;
  while (/suite à la prochaine synchro/.test(d.lastSync.message) && n < 10) { d = env.api(owner, 'sync'); n++; }
  assert.equal(n, 4, '900 e-mails lus en 4 passages de 300 maximum');
  assert.ok(byKey(d, 'airbnb:HMTEST0001'), 'confirmation lue');
  assert.equal(byKey(d, 'airbnb:HMTEST0003').status, 'cancelled');
});

// ---------- calendrier toujours à jour même si un e-mail manque ----------
test('Booking : annulation sans e-mail → retirée du planning, revient si les dates réapparaissent', () => {
  const { env, owner, manager } = setup();
  const ics = bookingIcs().replace(/BEGIN:VEVENT\r\nDTSTAMP:20261027T080000Z\r\nDTSTART;VALUE=DATE:20261115[\s\S]*?END:VEVENT\r\n/, '');
  env.fetchMap[BOOKING_URL] = { body: ics };
  let d = env.api(owner, 'sync');
  const r = byKey(d, 'booking:7100000003');
  assert.equal(r.status, 'cancelled');
  assert.equal(r.autoStatus, 'absent');
  assert.match(d.lastSync.message, /absente du calendrier : considérée annulée/);
  assert.ok(!env.api(manager, 'load').reservations.some(x => x.checkin === '2026-11-15'), 'disparue du planning gestionnaire');
  env.fetchMap[BOOKING_URL] = { body: bookingIcs() };
  d = env.api(owner, 'sync');
  assert.equal(byKey(d, 'booking:7100000003').status, 'confirmed');
});

test('Booking : dates changées sans e-mail → réservation déplacée, pas de doublon', () => {
  const { env, owner } = setup();
  env.fetchMap[BOOKING_URL] = { body: bookingIcs().replace('DTSTART;VALUE=DATE:20261104', 'DTSTART;VALUE=DATE:20261110').replace('DTEND;VALUE=DATE:20261107', 'DTEND;VALUE=DATE:20261113') };
  const d = env.api(owner, 'sync');
  const r = byKey(d, 'booking:7100000001');
  assert.equal(r.checkin, '2026-11-10');
  assert.equal(r.checkout, '2026-11-13');
  assert.equal(r.status, 'confirmed');
  assert.ok(!byKey(d, 'booking-ical:2026-11-10_2026-11-13'), 'pas de réservation fantôme');
  assert.deepEqual(d.overlaps, []);
  assert.match(d.lastSync.message, /dates changées/);
});

test('Airbnb : annulation sans e-mail → retirée ; e-mail d’annulation tardif sans effet de bord', () => {
  const { env, owner } = setup();
  env.gmail.messages.push({ id: 'a9', from: 'automated@airbnb.com', date: new Date().toISOString(),
    subject: 'Réservation confirmée : Léa Petit arrive le 10 déc.',
    body: airbnbConfirmation({ first: 'Léa', last: 'Petit', code: 'HMTEST0009', arrLine: '10 DÉC.', datesLine: 'jeu. 10 déc. sam. 12 déc.', guests: '2 adultes', earn: '200,00', total: '250,00' }) });
  const ev = ['BEGIN:VEVENT', 'DTEND;VALUE=DATE:20261212', 'DTSTART;VALUE=DATE:20261210', 'UID:x9@airbnb.com',
    'DESCRIPTION:Reservation URL: https://www.airbnb.com/hosting/reservations/details/HMTEST0009', 'SUMMARY:Reserved', 'END:VEVENT'];
  env.fetchMap[AIRBNB_URL] = { body: airbnbIcs(ev) };
  let d = env.api(owner, 'sync');
  assert.equal(byKey(d, 'airbnb:HMTEST0009').status, 'confirmed');
  env.fetchMap[AIRBNB_URL] = { body: airbnbIcs() };
  d = env.api(owner, 'sync');
  assert.equal(byKey(d, 'airbnb:HMTEST0009').status, 'cancelled');
  env.gmail.messages.push({ id: 'a10', from: 'automated@airbnb.com', date: new Date().toISOString(), subject: 'Annulation de la réservation HMTEST0009 (10–12 déc. 2026)', body: '' });
  d = env.api(owner, 'sync');
  const r = byKey(d, 'airbnb:HMTEST0009');
  assert.equal(r.status, 'cancelled');
  assert.equal(d.reservations.filter(x => x.code === 'HMTEST0009').length, 1);
});

test('Nouvelle réservation : e-mail reçu avant la mise à jour du calendrier → pas annulée par erreur', () => {
  const { env, owner } = setup();
  env.gmail.messages.push({ id: 'b20', from: 'noreply@booking.com', date: new Date().toISOString(),
    subject: 'Booking.com - Nouvelle réservation ! (7100000020, samedi 9 janvier 2027)', body: '' });
  let d = env.api(owner, 'sync');
  assert.equal(byKey(d, 'booking:7100000020').status, 'confirmed');
  d = env.api(owner, 'sync');
  assert.equal(byKey(d, 'booking:7100000020').status, 'confirmed', 'jamais vue dans le calendrier et connue depuis moins de 48 h');
});

test('Calendrier vide suspect : rien n’est annulé', () => {
  const { env, owner } = setup();
  env.fetchMap[BOOKING_URL] = { body: 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR' };
  const d = env.api(owner, 'sync');
  assert.equal(byKey(d, 'booking:7100000001').status, 'confirmed');
  assert.match(d.lastSync.message, /vide alors que/);
});

test('Annulation par e-mail Booking puis nouvelle réservation aux mêmes dates', () => {
  const { env, owner } = setup();
  env.gmail.messages.push({ id: 'b30', from: 'noreply@booking.com', date: new Date().toISOString(),
    subject: 'Booking.com - Réservation annulée ! (7100000001, mercredi 4 novembre 2026)', body: '' });
  env.gmail.messages.push({ id: 'b31', from: 'noreply@booking.com', date: new Date(Date.now() + 1000).toISOString(),
    subject: 'Booking.com - Nouvelle réservation ! (7100000031, mercredi 4 novembre 2026)', body: '' });
  const d = env.api(owner, 'sync');
  assert.equal(byKey(d, 'booking:7100000001').status, 'cancelled');
  const n = byKey(d, 'booking:7100000031');
  assert.equal(n.status, 'confirmed');
  assert.equal(n.checkout, '2026-11-07');
  assert.deepEqual(d.overlaps, []);
});

test('Application installable : adresse réglable, vide = liens directs', () => {
  const { env, owner, data } = setup({ withIcal: false });
  assert.ok(data.managerUrl.startsWith('https://rnab26.github.io/Gestion-Airbnb-Booking/#https://script.google.com/'));
  let d = env.api(owner, 'saveSettings', Object.assign({}, data.settings, { appUrl: '' }));
  assert.equal(d.managerUrl, d.managerDirectUrl);
  assert.throws(() => env.api(owner, 'saveSettings', Object.assign({}, data.settings, { appUrl: 'http://x' })), /Adresse de l'application/);
  d = env.api(owner, 'saveSettings', Object.assign({}, data.settings, { appUrl: 'https://exemple.fr/app/' }));
  assert.ok(d.ownerUrl.startsWith('https://exemple.fr/app/#'));
});

test('Limite Gmail atteinte : pas d’erreur rouge, lecture reprise ensuite sans perte', () => {
  const { env, owner } = setup({ noSync: true });
  env.gmail.quotaAfter = 4; // Gmail refuse à partir de la 5e lecture (même après les nouveaux essais)
  let d = env.api(owner, 'sync');
  assert.equal(d.lastSync.ok, true, d.lastSync.message);
  assert.match(d.lastSync.message, /limite Gmail|limite les lectures/);
  assert.ok(!/Quota exceeded/.test(d.lastSync.message), 'message technique masqué');
  env.gmail.quotaAfter = undefined;
  d = env.api(owner, 'sync');
  d = env.api(owner, 'sync');
  assert.equal(byKey(d, 'airbnb:HMTEST0001').net, 412.3);
  assert.equal(byKey(d, 'airbnb:HMTEST0003').status, 'cancelled');
  assert.equal(byKey(d, 'booking:7100000002').status, 'cancelled');
  assert.ok(env.gmail.slept > 0, 'appels Gmail espacés');
});

test('Booking : dates fermées (vrai export) jamais comptées comme réservation ni montrées à la gestionnaire', () => {
  const { env, manager, data } = setup();
  const blk = byKey(data, 'booking-ical:2027-01-05_2027-10-22');
  assert.equal(blk.status, 'blocked');
  assert.equal(blk.missingAmount, false);
  assert.deepEqual(data.overlaps, []);
  const m = env.api(manager, 'load');
  assert.ok(!m.reservations.some(r => r.checkin === '2027-01-05' || r.checkin === '2026-12-20'));
});

test('Fichier tout-en-un (dist/) : à jour et fonctionne sans Index.html', () => {
  const p = require('path');
  const built = fs.readFileSync(p.join(__dirname, '..', 'dist', 'Code-complet.gs'), 'utf8');
  const src = fs.readFileSync(p.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
  const html = fs.readFileSync(p.join(__dirname, '..', 'apps-script', 'Index.html'), 'utf8');
  assert.ok(built.includes(src) && built.includes(JSON.stringify(html)), 'lance node tools/build.js');
  const env = createEnv({ codeFile: p.join(__dirname, '..', 'dist', 'Code-complet.gs') });
  env.ctx.HtmlService.createTemplateFromFile = () => { throw new Error('Index.html ne doit pas être utilisé'); };
  const res = env.install();
  const page = env.ctx.doGet({ parameter: { k: res.directUrl.split('k=')[1] } }).getContent();
  assert.ok(page.includes('"mode":"owner"') && page.includes('function renderOwner'));
});

// ---------- mise à jour automatique ----------
function updateEnv(remoteVersion) {
  const s = setup({ withIcal: false });
  const p = require('path');
  const bundle = fs.readFileSync(p.join(__dirname, '..', 'dist', 'Code-complet.gs'), 'utf8');
  s.env.update.github['dist/Code-complet.gs'] = bundle.replace(/var APP_VERSION = '[^']+'/, "var APP_VERSION = '" + remoteVersion + "'");
  s.env.update.github['apps-script/appsscript.json'] = s.env.update.currentManifest;
  return s;
}

test('Mise à jour auto : nouvelle version → code remplacé, version créée, déploiement basculé', () => {
  const { env, owner } = updateEnv('9.9.9');
  const d = env.api(owner, 'checkUpdate');
  assert.equal(d.lastUpdate.ok, true, d.lastUpdate.message);
  assert.match(d.lastUpdate.message, /→ 9\.9\.9/);
  const calls = env.update.calls.map(c => c.method + ' ' + c.path);
  assert.deepEqual(calls, ['get /projects/SCRIPT_ID/content', 'put /projects/SCRIPT_ID/content', 'post /projects/SCRIPT_ID/versions', 'put /projects/SCRIPT_ID/deployments/TEST']);
  const files = env.update.calls[1].body.files;
  assert.deepEqual(files.map(f => f.name + ':' + f.type), ['Code:SERVER_JS', 'appsscript:JSON']);
  assert.match(files[0].source, /var APP_VERSION = '9\.9\.9'/);
  assert.equal(env.update.calls[3].body.deploymentConfig.versionNumber, 7);
});

test('Mise à jour auto : déjà à jour → rien touché', () => {
  const { env, owner, data } = updateEnv('X');
  env.update.github['dist/Code-complet.gs'] = env.update.github['dist/Code-complet.gs'].replace("var APP_VERSION = 'X'", "var APP_VERSION = '" + data.version + "'");
  const d = env.api(owner, 'checkUpdate');
  assert.match(d.lastUpdate.message, /Déjà à jour.*prêtes/);
  assert.deepEqual(env.update.calls.map(c => c.method), ['get'], 'seulement la vérification du droit de mise à jour');
  env.update.noScope = true;
  assert.throws(() => env.api(owner, 'checkUpdate'), /touche « Autoriser »/, 'droit manquant signalé même à jour');
});

test('Mise à jour auto : nouveaux accès Google demandés → pas installée, propriétaire prévenu', () => {
  const { env, owner } = updateEnv('9.9.9');
  const m = JSON.parse(env.update.currentManifest);
  m.oauthScopes.push('https://mail.google.com/');
  env.update.github['apps-script/appsscript.json'] = JSON.stringify(m);
  assert.throws(() => env.api(owner, 'checkUpdate'), /nouveaux accès Google/);
  assert.ok(!env.update.calls.some(c => c.method === 'put'));
  assert.equal(env.api(owner, 'load').lastUpdate.needsOwner, true);
});

test('Mise à jour auto : code tronqué refusé ; API non activée → message clair', () => {
  let { env, owner } = updateEnv('9.9.9');
  env.update.github['dist/Code-complet.gs'] = env.update.github['dist/Code-complet.gs'].slice(0, 50000) + "\nvar INDEX_HTML_ = 'x';";
  assert.throws(() => env.api(owner, 'checkUpdate'), /invalide|incomplet/);
  assert.ok(!env.update.calls.some(c => c.method === 'put'));
  ({ env, owner } = updateEnv('9.9.9'));
  env.update.apiDisabled = true;
  assert.throws(() => env.api(owner, 'checkUpdate'), /script\.google\.com\/home\/usersettings/);
});

test('Mise à jour auto : déclencheur quotidien posé, désactivable, réservé au propriétaire', () => {
  const { env, owner, manager, data } = updateEnv('9.9.9');
  assert.ok(env.triggers.some(t => t.fn === 'autoUpdate' && t.every === '1d' && t.atHour === 4));
  assert.throws(() => env.api(manager, 'checkUpdate'), /Action non autorisée/);
  env.api(owner, 'saveSettings', Object.assign({}, data.settings, { autoUpdateEnabled: false }));
  env.ctx.autoUpdate();
  assert.equal(env.update.calls.length, 0, 'désactivée : rien');
  env.api(owner, 'saveSettings', Object.assign({}, data.settings, { autoUpdateEnabled: true }));
  env.ctx.autoUpdate();
  assert.ok(env.update.calls.some(c => /deployments/.test(c.path)));
});

test('Corps d’e-mail en octets (service avancé réel) ou en base64 sans remplissage : lus tous les deux', () => {
  for (const b64 of [false, true]) {
    const { env, owner } = setup({ noSync: true, withIcal: false });
    env.gmail.base64Bodies = b64;
    const d = env.api(owner, 'sync');
    assert.ok(!/décoder/.test(d.lastSync.message), d.lastSync.message);
    assert.equal(byKey(d, 'airbnb:HMTEST0001').net, 412.3, b64 ? 'base64' : 'octets');
  }
});

test('E-mail en erreur : pas marqué comme lu, relu à la synchro suivante', () => {
  const { env, owner } = setup({ noSync: true, withIcal: false });
  const realGet = env.ctx.Gmail.Users.Messages.get;
  let fail = true;
  env.ctx.Gmail.Users.Messages.get = function (u, id, o) {
    if (fail && id === 'a1' && o.format === 'full') throw new Error('Impossible de décoder la chaîne.');
    return realGet.apply(this, arguments);
  };
  let d = env.api(owner, 'sync');
  assert.ok(!byKey(d, 'airbnb:HMTEST0001'));
  fail = false;
  d = env.api(owner, 'sync');
  assert.equal(byKey(d, 'airbnb:HMTEST0001').net, 412.3);
});

test('Mise à niveau : e-mails marqués lus par une ancienne version relus une fois', () => {
  const { env, owner } = setup({ noSync: true, withIcal: false });
  env.ctx.writeRows_('_emails_lus', ['id'], env.gmail.messages.map(m => ({ id: m.id })));
  let d = env.api(owner, 'sync');
  assert.equal(byKey(d, 'airbnb:HMTEST0001').net, 412.3, 'relu malgré l’ancienne liste');
  d = env.api(owner, 'sync');
  assert.match(d.lastSync.message, /0 e-mail\(s\) lu\(s\)/, 'pas de relecture à chaque fois');
});

test('Airbnb : provenance du voyageur et 4 derniers chiffres du téléphone', () => {
  const { ctx } = createEnv();
  const body = messages[0].body.replace('Identité vérifiée · 2 commentaires\n\nBonjour', 'Identité vérifiée · 2 commentaires\n\nLyon, France\n\nBonjour');
  assert.equal(ctx.parseAirbnbConfirmation_(messages[0].subject, body, '2026-09-09').location, 'Lyon, France');
  assert.equal(ctx.parseAirbnbConfirmation_(messages[0].subject, messages[0].body, '2026-09-09').location, '', 'message du voyageur ignoré');
  const msg2 = messages[0].body.replace('Identité vérifiée · 2 commentaires\n\nBonjour', 'Identité vérifiée · 2 commentaires\n\nBonjour, à bientôt');
  assert.equal(ctx.parseAirbnbConfirmation_(messages[0].subject, msg2, '2026-09-09').location, '');
  const { data } = setup();
  assert.equal(byKey(data, 'airbnb:HMTEST0004').phone, '…9876', 'iCal Airbnb');
});

test('Dates bloquées Airbnb en gris ; blocage en double d’une réservation supprimé ; téléphone modifiable', () => {
  const { env, owner, manager, data } = setup();
  const blk = byKey(data, 'airbnb-block:2026-11-25_2026-11-27');
  assert.equal(blk.status, 'blocked');
  assert.equal(blk.counted, false);
  env.fetchMap[AIRBNB_URL] = { body: airbnbIcs(['BEGIN:VEVENT', 'DTEND;VALUE=DATE:20261107', 'DTSTART;VALUE=DATE:20261104', 'UID:imp@airbnb.com', 'SUMMARY:Airbnb (Not available)', 'END:VEVENT']) };
  let d = env.api(owner, 'sync');
  assert.ok(!byKey(d, 'airbnb-block:2026-11-04_2026-11-07'), 'réservation Booking importée dans Airbnb : pas de doublon gris');
  const r = byKey(d, 'booking:7100000001');
  d = env.api(owner, 'saveReservation', Object.assign({}, r, { phone: '+33 6 12 34 56 78', location: 'Madrid, Espagne', guest: 'Ana Lopez' }));
  const r2 = byKey(d, 'booking:7100000001');
  assert.equal(r2.phone, '+33 6 12 34 56 78');
  assert.equal(r2.location, 'Madrid, Espagne');
  d = env.api(owner, 'sync');
  assert.equal(byKey(d, 'booking:7100000001').phone, '+33 6 12 34 56 78', 'gardé à la synchro');
  let m = env.api(manager, 'load');
  assert.ok(!JSON.stringify(m).includes('12 34 56'), 'téléphone masqué à la gestionnaire par défaut');
  env.api(owner, 'saveSettings', Object.assign({}, d.settings, { managerShowPhone: true }));
  m = env.api(manager, 'load');
  assert.equal(m.reservations.find(x => x.checkin === '2026-11-04').phone, '+33 6 12 34 56 78');
});

test('Autorisation manquante pour la mise à jour : lien « Autoriser » proposé, message clair', () => {
  const { env, owner } = updateEnv('9.9.9');
  assert.equal(env.api(owner, 'load').authUrl, '');
  env.update.authRequired = true;
  env.update.noScope = true;
  assert.throws(() => env.api(owner, 'checkUpdate'), /touche « Autoriser »/);
  const d = env.api(owner, 'load');
  assert.equal(d.authUrl, 'https://script.google.com/macros/d/SCRIPT_ID/authorize');
  assert.equal(d.lastUpdate.needsAuth, true);
});

test('Booking sans départ connu : montant estimé à la moyenne par séjour, nuits signalées', () => {
  const { env, owner } = setup();
  env.gmail.messages.push({ id: 'inv1', from: 'noreply@booking.com', date: '2026-12-03T12:04:21Z', subject: 'Booking.com Invoice 1670000001', body: '',
    attachment: INVOICE_LAYOUT.replace('01/07/2026 - 31/07/2026', '01/11/2026 - 30/11/2026').replace('EUR 2 500,00', 'EUR 1 000,00').replace('EUR 425,00', 'EUR 170,00').replace('EUR 37,50', 'EUR 15,00') });
  env.gmail.messages.push({ id: 'b40', from: 'noreply@booking.com', date: '2026-12-10T10:00:00Z', subject: 'Booking.com - Nouvelle réservation ! (7100000040, lundi 4 janvier 2027)', body: '' });
  const d = env.api(owner, 'sync');
  const r = byKey(d, 'booking:7100000040');
  assert.equal(r.checkout, '');
  assert.equal(r.amountKind, 'estimé');
  assert.equal(r.net, 407.5, '815 € / 2 séjours facturés');
  assert.equal(d.stats['2027'].total.staysWithoutNights, 1);
});

test('Mise à jour via l’accès clasp rangé dans les propriétés (API désactivée sur le projet par défaut)', () => {
  const { env, owner, manager } = updateEnv('9.9.9');
  env.update.projectApiOff = true;
  assert.throws(() => env.api(owner, 'checkUpdate'), /pas encore activées/);
  assert.throws(() => env.api(owner, 'setUpdaterCreds', { client_id: 'x', client_secret: 'y', refresh_token: 'z' }), /invalide/);
  assert.throws(() => env.api(manager, 'setUpdaterCreds', {}), /Action non autorisée/);
  let d = env.api(owner, 'setUpdaterCreds', { client_id: '123-abc.apps.googleusercontent.com', client_secret: 'GOCSPX-test', refresh_token: '1//0abc-DEF_ghi' });
  assert.equal(d.updaterReady, true);
  assert.ok(!JSON.stringify(d).includes('1//0abc'), 'le jeton ne revient jamais à l’écran');
  env.update.calls = [];
  d = env.api(owner, 'checkUpdate');
  assert.match(d.lastUpdate.message, /→ 9\.9\.9/);
  assert.ok(env.update.calls.every(c => c.auth === 'Bearer CLASP_TOKEN'));
  env.update.tokenRevoked = true;
  assert.throws(() => env.api(owner, 'checkUpdate'), /retiré du compte/);
  d = env.api(owner, 'clearUpdaterCreds');
  assert.equal(d.updaterReady, false);
});

test('Booking : message du client → nom, arrivée et départ (séjour passé hors calendrier)', () => {
  const { ctx } = createEnv();
  const { GUEST_MSG } = require('./fixtures/emails');
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.parseBookingGuestMessage_(GUEST_MSG))),
    { number: '7100000001', guest: 'ANA LOPEZ', checkin: '2026-11-04', checkout: '2026-11-07' });
  const { env, owner } = setup({ noSync: true, withIcal: false });
  env.gmail.messages.push({ id: 'g1', from: '7100000099-abcd@guest.booking.com', date: '2026-05-01T10:00:00Z',
    subject: 'WANDAS KRZYSZTOF nous a envoyé ce message',
    body: GUEST_MSG.replace(/7100000001/g, '7100000099').replace(/ANA LOPEZ/g, 'WANDAS KRZYSZTOF').replace('mercredi 4 novembre 2026', 'mercredi 6 mai 2026').replace('samedi 7 novembre 2026', 'samedi 9 mai 2026') });
  const d = env.api(owner, 'sync');
  const r = byKey(d, 'booking:7100000099');
  assert.equal(r.guest, 'WANDAS KRZYSZTOF');
  assert.equal(r.checkin, '2026-05-06');
  assert.equal(r.checkout, '2026-05-09');
  assert.equal(r.nights, 3);
});
