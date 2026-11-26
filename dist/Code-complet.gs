// FICHIER GÉNÉRÉ par tools/build.js — ne pas modifier à la main.
// Colle ce fichier entier dans Apps Script (il remplace Code.gs ET Index.html).

/**
 * Gestion location Airbnb + Booking — application Google Apps Script.
 *
 * Ce qu'elle fait :
 *  - lit les e-mails Airbnb et Booking de la boîte Gmail du propriétaire
 *    (lecture seule) pour créer les réservations et les montants Airbnb ;
 *  - lit les calendriers iCal Airbnb et Booking pour les dates à jour ;
 *  - stocke tout dans un Google Sheet créé à l'installation ;
 *  - sert deux pages : le tableau de bord du propriétaire (revenus, planning,
 *    notes, réglages) et une page planning pour la gestionnaire, sans aucun
 *    montant (filtrage fait ici, côté serveur).
 *
 * Accès : chaque page est protégée par une clé secrète dans le lien (?k=...).
 */

var APP_VERSION = '1.6.4'; // à augmenter à chaque changement : c'est ce que compare la mise à jour automatique

// Mise à jour automatique : code publié sur la branche « stable », que GitHub ne
// met à jour qu'après passage des tests (voir .github/workflows/tests.yml).
var UPDATE_BASE_URL = 'https://raw.githubusercontent.com/rnab26/Gestion-Airbnb-Booking/stable/';

var SHEET_RES = 'Reservations';
var SHEET_NOTES = 'Notes';
var SHEET_LOG = 'Journal';
var SHEET_EMAILS = '_emails_lus';
var SHEET_INVOICES = 'FacturesBooking';

var RES_COLS = ['id', 'key', 'source', 'origin', 'status', 'hidden', 'code', 'guest',
  'guestsText', 'guestsCount', 'checkin', 'checkout', 'amountNet', 'amountGross',
  'paidByGuest', 'keepRevenue', 'note', 'sharedNote', 'locked', 'emailId',
  'createdAt', 'updatedAt', 'seenAt', 'autoStatus', 'phone', 'location', 'commission'];
// commission : montant retenu par la plateforme (Booking : commission + frais de paiement ;
// Airbnb : frais de service hôte), positif. Brut = net + commission.
var NOTE_COLS = ['id', 'date', 'endDate', 'text', 'visible', 'author', 'createdAt', 'updatedAt'];
var LOG_COLS = ['at', 'kind', 'ok', 'message'];
var INVOICE_COLS = ['number', 'periodStart', 'periodEnd', 'sales', 'commission', 'paymentFees', 'total', 'emailId', 'readAt'];
// Taux utilisé tant qu'aucune facture Booking n'a été lue.
var BOOKING_FALLBACK_PCT = 17;
// Au-delà, une plage du calendrier Booking n'est pas un séjour : Booking fusionne une réservation
// et les dates fermées qui la suivent (jusqu'à la fin de son calendrier, ~1 an) en une seule plage.
var MAX_ICAL_STAY_NIGHTS = 45;

// Valeurs par défaut des réglages : toutes modifiables depuis l'onglet Réglages.
var DEFAULT_SETTINGS = {
  apartmentName: 'Mon appartement',
  icalAirbnb: '',
  icalBooking: '',
  // Commission Booking totale (commission + frais de paiement), en %, appliquée
  // au prix payé par le client saisi à la main. Vide = taux réel lu sur les factures.
  bookingCommissionPct: '',
  checkinTime: '15:00',
  checkoutTime: '10:00',
  syncEveryHours: 1,
  emailScanEnabled: true,
  managerLabel: 'Gestionnaire',
  managerShowGuestName: true,
  managerShowGuestCount: true,
  managerShowPhone: false,
  managerCanAddNotes: true,
  managerPastDays: 30,
  autoUpdateEnabled: true,
  // Page installable (GitHub Pages) qui affiche l'application : les liens partagés
  // passent par elle pour pouvoir « Installer l'application » depuis Chrome. Vide = liens directs.
  appUrl: 'https://rnab26.github.io/Gestion-Airbnb-Booking/',
  // N° d'établissement Booking (extranet, « hotel_id ») : pour ouvrir une réservation dans l'extranet depuis la fiche.
  bookingHotelId: '',
  // Durée minimale d'un séjour (nuits) : un trou plus court entre deux séjours n'est pas réservable (grisé clair).
  minNights: 2,
  // Message WhatsApp préparé pour la gestionnaire quand elle écrit à un voyageur.
  // Repères remplacés : {prénom} {gestionnaire} {arrivée} {départ} {heure} {guide}.
  managerWaMessage: 'Bonjour {prénom} 👋\nJe suis {gestionnaire}, je m\'occupe de votre arrivée à l\'appartement le {arrivée} (à partir de {heure}).\n\n{guide}\n\nJe reste disponible ici sur WhatsApp. Bon séjour !',
  // Guide d'arrivée (adresse, accès, boîte à clés, Wi-Fi…) inséré à la place de {guide}. Vide = ligne retirée.
  arrivalGuide: '',
  // Ce que touche la gestionnaire à chaque départ (elle fait le ménage), affiché en haut de sa page. 0 = rien d'affiché.
  managerFee: 50
};
var MANAGER_FEE_MAX = 1000;
var MIN_NIGHTS_MAX = 30;
var SYNC_HOURS_ALLOWED = [1, 2, 4, 6, 12, 24];
// Champs qu'une modification à la main protège contre la synchronisation.
var EDITABLE_RES_FIELDS = ['guest', 'guestsText', 'checkin', 'checkout', 'amountNet',
  'amountGross', 'status', 'keepRevenue', 'note', 'sharedNote', 'source', 'phone', 'location'];

// =====================================================================
// Pages web
// =====================================================================

function doGet(e) {
  var p = (e && e.parameter) || {};
  var props = PropertiesService.getScriptProperties();
  var boot;
  if (!props.getProperty('installed')) {
    boot = { mode: 'install' };
  } else {
    var role = roleFor_(p.k);
    boot = role ? { mode: role, token: p.k } : { mode: 'invalid' };
  }
  boot.version = APP_VERSION;
  var title = 'Gestion location';
  if (boot.mode === 'owner' || boot.mode === 'manager') {
    title = getSettings_().apartmentName + (boot.mode === 'manager' ? ' — Planning' : '');
  }
  // Version « tout-en-un » (dist/) : la page est intégrée au code, un seul fichier à coller.
  var t = typeof INDEX_HTML_ === 'string' ? HtmlService.createTemplate(INDEX_HTML_) : HtmlService.createTemplateFromFile('Index');
  t.bootJson = JSON.stringify(boot).replace(/</g, '\\u003c');
  return t.evaluate()
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL) // affichable dans l'application installable
    .setTitle(title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1');
}

/** Point d'entrée unique appelé par la page (google.script.run.api). */
function api(token, action, payload) {
  var role = roleFor_(token);
  if (!role) throw new Error('Lien invalide ou expiré. Demande un nouveau lien.');
  var table = role === 'owner' ? OWNER_ACTIONS : MANAGER_ACTIONS;
  var fn = table[action];
  if (!fn) throw new Error('Action non autorisée.');
  return fn(payload || {});
}

/** Installation : appelée une seule fois depuis la page, juste après le déploiement. */
function install() {
  var props = PropertiesService.getScriptProperties();
  return withLock_(function () {
    if (props.getProperty('installed')) throw new Error('Déjà installé. Utilise ton lien propriétaire.');
    var ss = SpreadsheetApp.create('Gestion location — données');
    props.setProperty('sheetId', ss.getId());
    ensureSheets_(ss);
    props.setProperty('settings', JSON.stringify(DEFAULT_SETTINGS));
    props.setProperty('ownerToken', newToken_());
    props.setProperty('managerToken', newToken_());
    props.setProperty('installed', new Date().toISOString());
    installTrigger_(DEFAULT_SETTINGS.syncEveryHours);
    ensureUpdateTrigger_();
    var ownerUrl = ownerUrl_();
    var directUrl = directUrl_(PropertiesService.getScriptProperties().getProperty('ownerToken'));
    try {
      MailApp.sendEmail(Session.getEffectiveUser().getEmail(),
        'Ton lien propriétaire — Gestion location',
        'Garde ce lien pour toi, il donne accès à tes revenus.\n\n' +
        'Application (à installer depuis Chrome : menu ⋮ › Installer l\'application) :\n' + ownerUrl +
        '\n\nLien direct (si l\'application ne s\'ouvre pas) :\n' + directUrl);
    } catch (err) {
      // L'e-mail est un filet de sécurité, l'installation reste valide sans lui.
    }
    return { ownerUrl: ownerUrl, directUrl: directUrl };
  });
}

/** À lancer depuis l'éditeur si le lien propriétaire est perdu (il s'affiche dans le journal). */
function afficherMonLien() {
  Logger.log('Application : ' + ownerUrl_());
  Logger.log('Lien direct : ' + directUrl_(PropertiesService.getScriptProperties().getProperty('ownerToken')));
  return ownerUrl_();
}

/** Déclencheur horaire. */
function syncAll() {
  return runSync_('auto');
}

// =====================================================================
// Actions
// =====================================================================

var OWNER_ACTIONS = {
  load: function () { return ownerData_(); },
  sync: function () { runSync_('manuel'); return ownerData_(); },
  saveReservation: function (p) { saveReservation_(p); return ownerData_(); },
  deleteReservation: function (p) { deleteReservation_(p.id); return ownerData_(); },
  restoreReservation: function (p) { setHidden_(p.id, false); return ownerData_(); },
  resetReservation: function (p) { resetReservation_(p.id); return ownerData_(); },
  saveNote: function (p) { saveNote_(p, 'owner'); return ownerData_(); },
  deleteNote: function (p) { deleteNote_(p.id, 'owner'); return ownerData_(); },
  saveSettings: function (p) { saveSettings_(p); return ownerData_(); },
  checkUpdate: function () { checkUpdate_(true); return ownerData_(); },
  setUpdaterCreds: function (p) { setUpdaterCreds_(p); return ownerData_(); },
  importBookingExport: function (p) { var res = importBookingExport_(p); var d = ownerData_(); d.importResult = res; return d; },
  // Aperçu, dans l'application du propriétaire, de ce que voit la gestionnaire (mêmes données filtrées).
  previewManager: function () { return managerData_(); },
  clearUpdaterCreds: function () { PropertiesService.getScriptProperties().deleteProperty('updaterCreds'); return ownerData_(); },
  regenerateManagerLink: function () {
    PropertiesService.getScriptProperties().setProperty('managerToken', newToken_());
    return ownerData_();
  }
};

var MANAGER_ACTIONS = {
  load: function () { return managerData_(); },
  saveNote: function (p) {
    if (!getSettings_().managerCanAddNotes) throw new Error('L\'ajout de notes est désactivé.');
    saveNote_(p, 'manager');
    return managerData_();
  },
  deleteNote: function (p) {
    if (!getSettings_().managerCanAddNotes) throw new Error('La modification des notes est désactivée.');
    deleteNote_(p.id, 'manager');
    return managerData_();
  }
};

function ownerData_() {
  var settings = getSettings_();
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('triggersFor') !== APP_VERSION) {
    // Après une mise à jour : on (re)pose les déclencheurs de la nouvelle version.
    try { ensureUpdateTrigger_(); props.setProperty('triggersFor', APP_VERSION); } catch (e) { /* réessayé au prochain chargement */ }
  }
  var invoices = readRows_(SHEET_INVOICES, INVOICE_COLS);
  var model = revenueModel_(readRows_(SHEET_RES, RES_COLS), invoices, settings);
  var rows = model.rows;
  rows.sort(function (a, b) { return (a.checkin || '9999').localeCompare(b.checkin || '9999'); });
  var notes = readRows_(SHEET_NOTES, NOTE_COLS);
  var lastSync = JSON.parse(props.getProperty('lastSync') || 'null');
  var log = readRows_(SHEET_LOG, LOG_COLS).slice(-15).reverse();
  return {
    role: 'owner',
    today: todayYmd_(),
    nowTime: nowHm_(),
    settings: settings,
    reservations: rows,
    closures: closuresFor_(rows, settings.minNights),
    notes: notes,
    stats: computeStats_(rows, model.unallocated),
    booking: {
      ratePct: model.ratePct,
      rateSource: model.rateSource,
      perNight: model.perNight,
      invoices: invoices.map(function (i) {
        var sales = Number(i.sales), fees = Number(i.commission) + Number(i.paymentFees || 0);
        return { number: i.number, periodStart: i.periodStart, periodEnd: i.periodEnd, sales: sales, fees: round2_(fees), net: round2_(sales - fees) };
      }).sort(function (a, b) { return b.periodEnd.localeCompare(a.periodEnd); })
    },
    overlaps: findOverlaps_(rows),
    lastSync: lastSync,
    log: log,
    managerUrl: shareUrl_(props.getProperty('managerToken')),
    managerDirectUrl: directUrl_(props.getProperty('managerToken')),
    ownerUrl: ownerUrl_(),
    ownerDirectUrl: directUrl_(props.getProperty('ownerToken')),
    sheetUrl: db_().getUrl(),
    version: APP_VERSION,
    lastUpdate: JSON.parse(props.getProperty('lastUpdate') || 'null'),
    lastImport: JSON.parse(props.getProperty('lastImport') || 'null'),
    updaterReady: !!props.getProperty('updaterCreds'),
    authUrl: pendingAuthUrl_()
  };
}

/** Données de la gestionnaire : aucun montant, aucun code, aucune note privée. */
function managerData_() {
  var s = getSettings_();
  var today = todayYmd_();
  var from = addDays_(today, -Math.max(0, Number(s.managerPastDays) || 0));
  var all = readRows_(SHEET_RES, RES_COLS);
  var res = all
    .filter(function (r) { return isActive_(r) && isYmd_(r.checkin) && (r.checkout || r.checkin) >= from; })
    .map(function (r) {
      return {
        id: r.id,
        source: r.source,
        checkin: r.checkin,
        checkout: r.checkout,
        nights: nightsBetween_(r.checkin, r.checkout),
        guest: s.managerShowGuestName ? firstName_(r.guest) : '',
        guestsText: s.managerShowGuestCount ? (r.guestsText || (r.guestsCount ? r.guestsCount + ' voyageur(s)' : '')) : '',
        sharedNote: r.sharedNote || '',
        phone: s.managerShowPhone ? (r.phone || '') : ''
      };
    });
  res.sort(function (a, b) { return a.checkin.localeCompare(b.checkin); });
  var notes = readRows_(SHEET_NOTES, NOTE_COLS).filter(function (n) {
    return n.author === 'manager' || n.visible === '1';
  });
  return {
    role: 'manager',
    today: today,
    nowTime: nowHm_(),
    settings: {
      apartmentName: s.apartmentName,
      checkinTime: s.checkinTime,
      checkoutTime: s.checkoutTime,
      managerLabel: s.managerLabel,
      managerCanAddNotes: !!s.managerCanAddNotes,
      // Message WhatsApp préparé : utile seulement si elle voit les numéros.
      managerWaMessage: s.managerShowPhone ? s.managerWaMessage : '',
      arrivalGuide: s.managerShowPhone ? s.arrivalGuide : ''
    },
    reservations: res,
    // Jours fermés : seulement des dates et un type, jamais la plateforme ni la raison détaillée.
    closures: closuresFor_(all, s.minNights).filter(function (c) { return c.end > from; }),
    // Ses revenus à elle (forfait par départ), jamais ceux du propriétaire.
    pay: managerPay_(all, s, today, nowHm_(), from),
    notes: notes,
    version: APP_VERSION
  };
}

// =====================================================================
// Réservations et notes
// =====================================================================

function saveReservation_(p) {
  withLock_(function () {
    var rows = readRows_(SHEET_RES, RES_COLS);
    var now = nowIso_();
    var r;
    if (p.id) {
      r = rows.filter(function (x) { return x.id === p.id; })[0];
      if (!r) throw new Error('Réservation introuvable (elle a peut-être été supprimée).');
    } else {
      r = newRow_(RES_COLS);
      r.id = Utilities.getUuid();
      r.key = 'direct:' + r.id;
      r.origin = 'manual';
      r.source = 'direct';
      r.status = 'confirmed';
      r.createdAt = now;
      rows.push(r);
    }
    var clean = {
      guest: str_(p.guest, 120),
      guestsText: str_(p.guestsText, 80),
      checkin: p.checkin || '',
      checkout: p.checkout || '',
      amountNet: amountField_(p.amountNet, 'Montant net'),
      amountGross: amountField_(p.amountGross, 'Prix payé par le client'),
      status: ['cancelled', 'blocked'].indexOf(p.status) >= 0 ? p.status : 'confirmed',
      keepRevenue: p.keepRevenue ? '1' : '',
      note: str_(p.note, 2000),
      phone: str_(p.phone, 40).trim(),
      location: str_(p.location, 80).trim(),
      sharedNote: str_(p.sharedNote, 2000),
      source: ['airbnb', 'booking', 'direct'].indexOf(p.source) >= 0 ? p.source : r.source
    };
    if (!isYmd_(clean.checkin)) throw new Error('Date d\'arrivée manquante ou invalide.');
    if (clean.checkout && !isYmd_(clean.checkout)) throw new Error('Date de départ invalide.');
    if (clean.checkout && clean.checkout <= clean.checkin) throw new Error('Le départ doit être après l\'arrivée.');
    if (r.origin !== 'manual' && clean.source !== r.source) clean.source = r.source;
    var locked = lockedSet_(r);
    EDITABLE_RES_FIELDS.forEach(function (f) {
      if (String(r[f] || '') !== String(clean[f] || '')) {
        r[f] = clean[f];
        if (r.origin !== 'manual') locked[f] = true;
      }
    });
    r.locked = Object.keys(locked).join(',');
    r.updatedAt = now;
    writeRows_(SHEET_RES, RES_COLS, rows);
  });
}

/** Réservation saisie à la main : supprimée. Réservation synchronisée : masquée (sinon elle reviendrait). */
function deleteReservation_(id) {
  withLock_(function () {
    var rows = readRows_(SHEET_RES, RES_COLS);
    var r = rows.filter(function (x) { return x.id === id; })[0];
    if (!r) throw new Error('Réservation introuvable.');
    if (r.origin === 'manual') {
      rows = rows.filter(function (x) { return x.id !== id; });
    } else {
      r.hidden = '1';
      var locked = lockedSet_(r);
      locked.hidden = true;
      r.locked = Object.keys(locked).join(',');
      r.updatedAt = nowIso_();
    }
    writeRows_(SHEET_RES, RES_COLS, rows);
  });
}

function setHidden_(id, hidden) {
  withLock_(function () {
    var rows = readRows_(SHEET_RES, RES_COLS);
    var r = rows.filter(function (x) { return x.id === id; })[0];
    if (!r) throw new Error('Réservation introuvable.');
    r.hidden = hidden ? '1' : '';
    var locked = lockedSet_(r);
    delete locked.hidden;
    r.locked = Object.keys(locked).join(',');
    r.updatedAt = nowIso_();
    writeRows_(SHEET_RES, RES_COLS, rows);
  });
}

/** Annule les modifications à la main : la prochaine synchro remet les valeurs d'origine. */
function resetReservation_(id) {
  withLock_(function () {
    var rows = readRows_(SHEET_RES, RES_COLS);
    var r = rows.filter(function (x) { return x.id === id; })[0];
    if (!r) throw new Error('Réservation introuvable.');
    r.locked = r.hidden === '1' ? 'hidden' : '';
    r.updatedAt = nowIso_();
    writeRows_(SHEET_RES, RES_COLS, rows);
  });
  // Réapplique tout de suite les valeurs synchronisées (e-mails relus depuis le début).
  PropertiesService.getScriptProperties().deleteProperty('lastEmailScan');
  writeRows_(SHEET_EMAILS, ['id'], []);
  runSync_('réinitialisation');
}

function saveNote_(p, author) {
  withLock_(function () {
    var notes = readRows_(SHEET_NOTES, NOTE_COLS);
    var now = nowIso_();
    var n;
    if (p.id) {
      n = notes.filter(function (x) { return x.id === p.id; })[0];
      if (!n) throw new Error('Note introuvable (elle a peut-être été supprimée).');
      if (author === 'manager' && n.author !== 'manager') throw new Error('Tu ne peux modifier que tes propres notes.');
    } else {
      n = newRow_(NOTE_COLS);
      n.id = Utilities.getUuid();
      n.author = author;
      n.createdAt = now;
      notes.push(n);
    }
    var text = str_(p.text, 2000).trim();
    if (!text) throw new Error('La note est vide.');
    if (!isYmd_(p.date)) throw new Error('Date de la note invalide.');
    if (p.endDate && (!isYmd_(p.endDate) || p.endDate < p.date)) throw new Error('La date de fin doit être après la date de début.');
    n.text = text;
    n.date = p.date;
    n.endDate = p.endDate && p.endDate !== p.date ? p.endDate : '';
    n.visible = author === 'manager' ? '1' : (p.visible ? '1' : '');
    n.updatedAt = now;
    writeRows_(SHEET_NOTES, NOTE_COLS, notes);
  });
}

function deleteNote_(id, author) {
  withLock_(function () {
    var notes = readRows_(SHEET_NOTES, NOTE_COLS);
    var n = notes.filter(function (x) { return x.id === id; })[0];
    if (!n) throw new Error('Note introuvable.');
    if (author === 'manager' && n.author !== 'manager') throw new Error('Tu ne peux supprimer que tes propres notes.');
    writeRows_(SHEET_NOTES, NOTE_COLS, notes.filter(function (x) { return x.id !== id; }));
  });
}

// =====================================================================
// Réglages
// =====================================================================

function getSettings_() {
  var raw = PropertiesService.getScriptProperties().getProperty('settings');
  var saved = raw ? JSON.parse(raw) : {};
  var out = {};
  Object.keys(DEFAULT_SETTINGS).forEach(function (k) {
    out[k] = saved.hasOwnProperty(k) ? saved[k] : DEFAULT_SETTINGS[k];
  });
  return out;
}

function saveSettings_(p) {
  var cur = getSettings_();
  var next = {};
  next.apartmentName = str_(p.apartmentName, 80).trim() || DEFAULT_SETTINGS.apartmentName;
  next.icalAirbnb = icalUrl_(p.icalAirbnb, 'Airbnb');
  next.icalBooking = icalUrl_(p.icalBooking, 'Booking');
  var rawPct = String(p.bookingCommissionPct === undefined || p.bookingCommissionPct === null ? '' : p.bookingCommissionPct).trim();
  if (rawPct === '') {
    next.bookingCommissionPct = '';
  } else {
    var pct = Number(rawPct.replace(',', '.').replace('%', ''));
    if (isNaN(pct) || pct < 0 || pct > 60) throw new Error('Commission Booking : un nombre entre 0 et 60, ou vide pour le taux réel des factures.');
    next.bookingCommissionPct = Math.round(pct * 100) / 100;
  }
  next.checkinTime = timeField_(p.checkinTime, 'Heure d\'arrivée');
  next.checkoutTime = timeField_(p.checkoutTime, 'Heure de départ');
  var h = Number(p.syncEveryHours);
  if (SYNC_HOURS_ALLOWED.indexOf(h) < 0) throw new Error('Fréquence de synchronisation invalide.');
  next.syncEveryHours = h;
  next.emailScanEnabled = !!p.emailScanEnabled;
  next.managerLabel = str_(p.managerLabel, 60).trim() || DEFAULT_SETTINGS.managerLabel;
  next.managerShowGuestName = !!p.managerShowGuestName;
  next.managerShowGuestCount = !!p.managerShowGuestCount;
  next.managerShowPhone = !!p.managerShowPhone;
  next.managerCanAddNotes = !!p.managerCanAddNotes;
  var past = Number(p.managerPastDays);
  if (isNaN(past) || past < 0 || past > 365) throw new Error('Historique gestionnaire : entre 0 et 365 jours.');
  next.managerPastDays = Math.round(past);
  var app = String(p.appUrl || '').trim();
  if (app && !/^https:\/\/[^\s#?]+\/$/.test(app)) throw new Error('Adresse de l\'application : https://… se terminant par /, ou vide.');
  next.appUrl = app;
  next.autoUpdateEnabled = !!p.autoUpdateEnabled;
  var hid = String(p.bookingHotelId === undefined ? cur.bookingHotelId : p.bookingHotelId || '').replace(/\s/g, '');
  if (hid && !/^\d{4,12}$/.test(hid)) throw new Error('N° d\'établissement Booking : des chiffres seulement (ex. 1234567), ou vide.');
  next.bookingHotelId = hid;
  var mn = p.minNights === undefined ? cur.minNights : Number(String(p.minNights).trim());
  if (!(mn >= 1 && mn <= MIN_NIGHTS_MAX) || Math.round(mn) !== mn) throw new Error('Durée minimale de séjour : un nombre entier de nuits entre 1 et ' + MIN_NIGHTS_MAX + '.');
  next.minNights = mn;
  var wm = p.managerWaMessage === undefined ? cur.managerWaMessage : str_(p.managerWaMessage, 2000).trim();
  next.managerWaMessage = wm || DEFAULT_SETTINGS.managerWaMessage;
  next.arrivalGuide = p.arrivalGuide === undefined ? cur.arrivalGuide : str_(p.arrivalGuide, 6000).trim();
  var feeRaw = p.managerFee === undefined ? String(cur.managerFee) : String(p.managerFee === null ? '' : p.managerFee).trim();
  var fee = feeRaw === '' ? 0 : Number(feeRaw.replace(/€/g, '').replace(/\s/g, '').replace(',', '.'));
  if (isNaN(fee) || fee < 0 || fee > MANAGER_FEE_MAX) throw new Error('Revenus de la gestionnaire : un montant par départ entre 0 et ' + MANAGER_FEE_MAX + ' €, ou vide pour ne rien afficher.');
  next.managerFee = round2_(fee);
  PropertiesService.getScriptProperties().setProperty('settings', JSON.stringify(next));
  if (next.syncEveryHours !== cur.syncEveryHours) installTrigger_(next.syncEveryHours);
}

function icalUrl_(v, label) {
  var s = String(v || '').trim();
  if (!s) return '';
  if (!/^https:\/\/\S+$/i.test(s)) throw new Error('Lien calendrier ' + label + ' : il doit commencer par https://');
  return s;
}

function timeField_(v, label) {
  var s = String(v || '').trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) throw new Error(label + ' : format HH:MM attendu (ex. 15:00).');
  return s;
}

function amountField_(v, label) {
  if (v === undefined || v === null || String(v).trim() === '') return '';
  var n = parseAmount_(v);
  if (n === null) throw new Error(label + ' : montant invalide.');
  return String(n);
}

/**
 * Lien Google à ouvrir quand le code demande un accès pas encore accordé par le
 * propriétaire (ex. mise à jour automatique) ; vide si tout est autorisé.
 */
function pendingAuthUrl_() {
  try {
    var info = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL);
    return info.getAuthorizationStatus() === ScriptApp.AuthorizationStatus.REQUIRED ? (info.getAuthorizationUrl() || '') : '';
  } catch (e) {
    return '';
  }
}

function ensureUpdateTrigger_() {
  var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'autoUpdate'; });
  if (!has) ScriptApp.newTrigger('autoUpdate').timeBased().everyDays(1).atHour(4).create();
}

// =====================================================================
// Mise à jour automatique (chaque nuit, ou bouton dans Réglages)
// =====================================================================

/** Déclencheur quotidien. */
function autoUpdate() {
  if (!getSettings_().autoUpdateEnabled) return;
  try { checkUpdate_(false); } catch (e) { /* déjà consigné par checkUpdate_ */ }
}

/**
 * Récupère le code publié (branche stable), le vérifie, remplace le code du
 * projet puis fait pointer le déploiement Web sur la nouvelle version.
 * N'installe rien si la nouvelle version demande des accès Google en plus :
 * il faudrait l'accord du propriétaire.
 */
function checkUpdate_(manual) {
  var props = PropertiesService.getScriptProperties();
  var status = { at: nowIso_(), ok: true, version: APP_VERSION, message: '' };
  try {
    var code = fetchText_(UPDATE_BASE_URL + 'dist/Code-complet.gs');
    var manifest = fetchText_(UPDATE_BASE_URL + 'apps-script/appsscript.json');
    var vm = code.match(/var APP_VERSION = '([^']+)'/);
    if (!vm || code.indexOf('function doGet(') < 0 || code.indexOf('var INDEX_HTML_ =') < 0) throw new Error('fichier de mise à jour incomplet');
    checkSyntax_(code);
    var nextManifest = JSON.parse(manifest);
    if (vm[1] === APP_VERSION) {
      // Même version : on vérifie quand même que l'outil a le droit de se mettre à jour.
      scriptApi_('get', '/projects/' + ScriptApp.getScriptId() + '/content');
      status.message = 'Déjà à jour (version ' + APP_VERSION + '). Mises à jour automatiques prêtes.';
    } else {
      var scriptId = ScriptApp.getScriptId();
      var current = scriptApi_('get', '/projects/' + scriptId + '/content');
      var curManifest = (current.files || []).filter(function (f) { return f.name === 'appsscript'; })[0];
      var curScopes = curManifest ? (JSON.parse(curManifest.source).oauthScopes || []) : [];
      var extra = (nextManifest.oauthScopes || []).filter(function (sc) { return curScopes.indexOf(sc) < 0; });
      if (extra.length) {
        status.ok = false;
        status.needsOwner = true;
        status.message = 'La version ' + vm[1] + ' demande de nouveaux accès Google : mise à jour manuelle nécessaire (page « Copier le code »).';
      } else {
        var m = baseUrl_().match(/\/macros\/s\/([^/]+)\/exec/);
        if (!m) throw new Error('adresse de déploiement introuvable');
        scriptApi_('put', '/projects/' + scriptId + '/content', { files: [
          { name: 'Code', type: 'SERVER_JS', source: code },
          { name: 'appsscript', type: 'JSON', source: manifest }
        ] });
        var ver = scriptApi_('post', '/projects/' + scriptId + '/versions', { description: 'Mise à jour auto ' + vm[1] });
        scriptApi_('put', '/projects/' + scriptId + '/deployments/' + m[1], { deploymentConfig: {
          scriptId: scriptId, versionNumber: ver.versionNumber, manifestFileName: 'appsscript', description: 'Version ' + vm[1]
        } });
        status.version = vm[1];
        status.message = 'Mis à jour : version ' + APP_VERSION + ' → ' + vm[1] + '.';
      }
    }
  } catch (e) {
    status.ok = false;
    var msg = String(e && e.message || e);
    status.message = /User has not enabled the Apps Script API/i.test(msg)
      ? 'Active « API Google Apps Script » sur https://script.google.com/home/usersettings (une seule fois) pour les mises à jour automatiques.'
      : /has not been used in project|SERVICE_DISABLED|it is disabled/i.test(msg)
        ? 'Mises à jour automatiques pas encore activées (accès de mise à jour à installer par Claude).'
      : /insufficient authentication scopes|insufficientPermissions/i.test(msg)
        ? 'Autorisation Google manquante pour les mises à jour automatiques : touche « Autoriser » en haut de l\'écran (une seule fois).'
        : 'Mise à jour impossible : ' + msg;
    status.needsAuth = /insufficient authentication scopes|insufficientPermissions/i.test(msg);
  }
  status.manual = !!manual;
  props.setProperty('lastUpdate', JSON.stringify(status));
  appendLog_('mise à jour', status.ok, status.message);
  if (!status.ok && manual) throw new Error(status.message);
  return status;
}

function fetchText_(url) {
  var r = UrlFetchApp.fetch(url + (url.indexOf('?') < 0 ? '?' : '&') + 'nocache=' + Date.now(), { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error('GitHub répond ' + r.getResponseCode());
  return r.getContentText();
}

/** Refuse un code tronqué ou cassé avant de l'installer (analyse seulement, rien n'est exécuté). */
function checkSyntax_(code) {
  try {
    new Function(code); // eslint-disable-line no-new-func
  } catch (e) {
    if (e instanceof SyntaxError) throw new Error('code reçu invalide (' + e.message + ')');
  }
}

/**
 * Jeton pour l'API Apps Script. Le projet Google par défaut d'un script ne peut pas
 * activer cette API (documentation Google) : on utilise l'accès « clasp » limité aux
 * scripts que le propriétaire a accordé, rangé dans les propriétés privées du script
 * (jamais dans le code). Sans lui, on tente le jeton du script.
 */
function updaterToken_() {
  var raw = PropertiesService.getScriptProperties().getProperty('updaterCreds');
  if (!raw) return ScriptApp.getOAuthToken();
  var c = JSON.parse(raw);
  var r = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post', muteHttpExceptions: true,
    payload: { client_id: c.client_id, client_secret: c.client_secret, refresh_token: c.refresh_token, grant_type: 'refresh_token' }
  });
  if (r.getResponseCode() !== 200) {
    throw new Error('accès de mise à jour refusé par Google (' + r.getResponseCode() + ' ' + apiErrorText_(r.getContentText()) + ') : il a peut-être été retiré du compte');
  }
  return JSON.parse(r.getContentText()).access_token;
}

function setUpdaterCreds_(p) {
  var c = { client_id: str_(p.client_id, 200).trim(), client_secret: str_(p.client_secret, 200).trim(), refresh_token: str_(p.refresh_token, 600).trim() };
  if (!/\.apps\.googleusercontent\.com$/.test(c.client_id) || !c.client_secret || !/^1\/\/[\w-]+$/.test(c.refresh_token)) {
    throw new Error('Accès de mise à jour invalide.');
  }
  PropertiesService.getScriptProperties().setProperty('updaterCreds', JSON.stringify(c));
}

function scriptApi_(method, path, body) {
  var o = { method: method, muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + updaterToken_() } };
  if (body) { o.contentType = 'application/json'; o.payload = JSON.stringify(body); }
  var r = UrlFetchApp.fetch('https://script.googleapis.com/v1' + path, o);
  var text = r.getContentText();
  if (r.getResponseCode() >= 300) {
    var detail = text;
    try { detail = JSON.parse(text).error.message; } catch (e) {}
    throw new Error(detail + ' (' + r.getResponseCode() + ')');
  }
  return text ? JSON.parse(text) : {};
}

function installTrigger_(hours) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'syncAll') ScriptApp.deleteTrigger(t);
  });
  var b = ScriptApp.newTrigger('syncAll').timeBased();
  if (hours >= 24) b.everyDays(1); else b.everyHours(hours);
  b.create();
}

// =====================================================================
// Synchronisation
// =====================================================================

function runSync_(kind) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Une synchronisation est déjà en cours, réessaie dans une minute.');
  var ctx;
  try {
    var settings = getSettings_();
    var rows = readRows_(SHEET_RES, RES_COLS);
    ctx = {
      rows: rows,
      byKey: indexBy_(rows, 'key'),
      now: nowIso_(),
      today: todayYmd_(),
      counts: { added: 0, updated: 0, cancelled: 0, removed: 0, emails: 0, invoices: 0 },
      errors: [],
      warnings: []
    };
    if (settings.emailScanEnabled) {
      try { scanEmails_(ctx); } catch (e) { (isQuotaError_(e) ? ctx.warnings : ctx.errors).push('Lecture des e-mails : ' + friendlyError_(e)); }
      try { scanBookingInvoices_(ctx); } catch (e) { (isQuotaError_(e) ? ctx.warnings : ctx.errors).push('Factures Booking : ' + friendlyError_(e)); }
    }
    [['airbnb', settings.icalAirbnb, 'Airbnb'], ['booking', settings.icalBooking, 'Booking']].forEach(function (s) {
      if (!s[1]) return;
      try {
        applyIcs_(ctx, s[0], fetchIcs_(s[1], s[2]));
      } catch (e) {
        ctx.errors.push('Calendrier ' + s[2] + ' : ' + e.message);
      }
    });
    dropRedundantBlocks_(ctx);
    writeRows_(SHEET_RES, RES_COLS, ctx.rows);
  } finally {
    lock.releaseLock();
  }
  var c = ctx.counts;
  var msg = c.added + ' nouvelle(s), ' + c.updated + ' mise(s) à jour, ' + c.cancelled + ' annulée(s)' +
    (c.removed ? ', ' + c.removed + ' retirée(s)' : '') + ' — ' + c.emails + ' e-mail(s) lu(s)' +
    (c.invoices ? ', ' + c.invoices + ' facture(s) Booking lue(s)' : '');
  if (ctx.errors.length) msg += ' | Erreurs : ' + ctx.errors.join(' ; ');
  if (ctx.warnings.length) msg += ' | À vérifier : ' + ctx.warnings.join(' ; ');
  var ok = ctx.errors.length === 0;
  PropertiesService.getScriptProperties().setProperty('lastSync',
    JSON.stringify({ at: ctx.now, ok: ok, message: msg, kind: kind }));
  appendLog_(kind, ok, msg);
  return { ok: ok, message: msg };
}

function fetchIcs_(url, label) {
  var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  var code = resp.getResponseCode();
  if (code !== 200) throw new Error('le lien répond ' + code + '. Vérifie-le dans Réglages.');
  var text = resp.getContentText();
  if (text.indexOf('BEGIN:VCALENDAR') < 0) throw new Error('ce lien ne renvoie pas un calendrier (.ics).');
  return parseIcs_(text);
}

function applyIcs_(ctx, src, events) {
  var seen = {};
  var booked = 0;
  if (src === 'booking') {
    // Départs aberrants déjà enregistrés (plage séjour + fermeture prise pour un séjour) : effacés.
    ctx.rows.forEach(function (r) {
      if (r.source === 'booking' && r.origin === 'email' && !lockedSet_(r).checkout && nightsBetween_(r.checkin, r.checkout) > MAX_ICAL_STAY_NIGHTS) {
        r.checkout = '';
        r.updatedAt = ctx.now;
        ctx.counts.updated++;
      }
    });
  }
  events.forEach(function (ev) {
    if (!isYmd_(ev.start) || !isYmd_(ev.end) || ev.end <= ev.start) return;
    if (src === 'airbnb') {
      if (/not available|indisponible|blocked|bloqu/i.test(ev.summary || '')) {
        // Dates bloquées sur Airbnb (à la main, ou importées d'un autre calendrier) : affichées en gris.
        var bkey = 'airbnb-block:' + ev.start + '_' + ev.end;
        var b = upsert_(ctx, bkey, { source: 'airbnb', origin: 'ical', status: 'blocked' },
          { checkin: ev.start, checkout: ev.end, status: 'blocked' });
        b.seenAt = ctx.now;
        seen[bkey] = true;
        return;
      }
      booked++;
      var m = ((ev.description || '') + ' ' + (ev.summary || '')).match(/\b(HM[A-Z0-9]{6,})\b/);
      var key = m ? 'airbnb:' + m[1] : 'airbnb-ical:' + (ev.uid || ev.start);
      // L'iCal Airbnb donne les 4 derniers chiffres du téléphone du voyageur.
      var last4 = (ev.description || '').match(/Last 4 Digits\)?\s*:\s*(\d{4})/i);
      var r = upsert_(ctx, key, { source: 'airbnb', origin: 'ical', status: 'confirmed' },
        { code: m ? m[1] : '', checkin: ev.start, checkout: ev.end }, { phone: last4 ? '…' + last4[1] : '' });
      revive_(ctx, r);
      r.seenAt = ctx.now;
      seen[key] = true;
      return;
    }
    booked++;
    var tooLong = nightsBetween_(ev.start, ev.end) > MAX_ICAL_STAY_NIGHTS;
    // Booking : l'iCal ne donne que des dates. On le rattache à la réservation
    // connue par e-mail qui arrive le même jour, pour récupérer le départ.
    var match = ctx.rows.filter(function (r) {
      return r.source === 'booking' && r.origin === 'email' && (r.status !== 'cancelled' || r.autoStatus === 'absent') && r.checkin === ev.start;
    })[0];
    if (match && tooLong) {
      // Séjour + fermeture fusionnés : le départ est inconnu, le reste de la plage est affiché bloqué.
      revive_(ctx, match);
      if (!lockedSet_(match).checkout && nightsBetween_(match.checkin, match.checkout) > MAX_ICAL_STAY_NIGHTS) {
        match.checkout = '';
        match.updatedAt = ctx.now;
        ctx.counts.updated++;
      }
      match.seenAt = ctx.now;
    } else if (match) {
      revive_(ctx, match);
      var placeholder = ctx.byKey['booking-ical:' + ev.start + '_' + ev.end];
      if (placeholder) mergePlaceholder_(match, placeholder);
      var locked = lockedSet_(match);
      if (!locked.checkout && match.checkout !== ev.end) {
        match.checkout = ev.end;
        match.updatedAt = ctx.now;
        ctx.counts.updated++;
      }
      match.seenAt = ctx.now;
      return;
    }
    var dup = !tooLong && ctx.rows.filter(function (r) {
      return r.source !== 'booking' && r.status !== 'cancelled' && r.checkin === ev.start && r.checkout === ev.end;
    })[0];
    if (dup) return; // dates importées d'Airbnb ou réservation directe déjà connue
    // Dates fermées sans e-mail Booking : le plus souvent une fermeture (Booking exporte
    // réservations ET dates fermées sous le même libellé). Affichées en gris, hors revenus ;
    // le propriétaire peut les passer en réservation. Un e-mail reçu ensuite les rattache.
    var pkey = 'booking-ical:' + ev.start + '_' + ev.end;
    var pr = upsert_(ctx, pkey, { source: 'booking', origin: 'ical', status: 'blocked' },
      { checkin: ev.start, checkout: ev.end, status: 'blocked' });
    pr.seenAt = ctx.now;
    seen[pkey] = true;
  });
  reconcileMissing_(ctx, src, seen, booked);
  // Ce qui a disparu du calendrier (futur uniquement) : retiré, ou annulé s'il porte des saisies.
  ctx.rows = ctx.rows.filter(function (r) {
    if (r.mergedInto) { delete ctx.byKey[r.key]; return false; }
    if (r.origin !== 'ical' || r.source !== src || seen[r.key]) return true;
    if (r.checkout && r.checkout < ctx.today) return true;
    if (r.locked) {
      if (r.status !== 'cancelled') { r.status = 'cancelled'; r.updatedAt = ctx.now; ctx.counts.cancelled++; }
      return true;
    }
    delete ctx.byKey[r.key];
    ctx.counts.removed++;
    return false;
  });
}

/**
 * Une plateforme bloque les dates réservées sur l'autre (import croisé des calendriers) :
 * ces blocages en double d'une vraie réservation ne sont pas gardés.
 */
function dropRedundantBlocks_(ctx) {
  var active = ctx.rows.filter(isActive_);
  ctx.rows = ctx.rows.filter(function (r) {
    if (r.status !== 'blocked' || r.origin !== 'ical' || r.locked) return true;
    var same = active.some(function (a) { return a.checkin === r.checkin && a.checkout === r.checkout; });
    if (same) delete ctx.byKey[r.key];
    return !same;
  });
}

/** Réservation annulée faute d'être dans le calendrier, qui y réapparaît : de nouveau confirmée. */
function revive_(ctx, r) {
  if (r.status === 'cancelled' && r.autoStatus === 'absent' && !lockedSet_(r).status) {
    r.status = 'confirmed';
    r.autoStatus = '';
    r.updatedAt = ctx.now;
    ctx.counts.updated++;
  }
}

/**
 * Réservations connues par e-mail mais absentes du calendrier de la plateforme
 * (e-mail d'annulation ou de modification manqué) :
 *  - Booking : si des dates inconnues sont apparues près de là, c'est un
 *    changement de dates, on déplace la réservation ;
 *  - sinon, une réservation future déjà vue dans le calendrier (ou connue depuis
 *    plus de 48 h) qui n'y est plus est considérée annulée. Elle revient
 *    automatiquement si elle réapparaît.
 * Un calendrier vide alors que des séjours futurs sont connus est jugé suspect :
 * on ne touche à rien.
 */
function reconcileMissing_(ctx, src, seen, booked) {
  var horizon = addDays_(ctx.today, 330);
  var nowMs = Date.parse(ctx.now);
  var missing = ctx.rows.filter(function (r) {
    return r.source === src && r.origin === 'email' && r.hidden !== '1' && r.status !== 'cancelled' &&
      isYmd_(r.checkin) && r.checkin > ctx.today && r.checkin <= horizon && r.seenAt !== ctx.now;
  });
  if (!missing.length) return;
  if (!booked) {
    ctx.warnings.push('calendrier ' + src + ' vide alors que ' + missing.length + ' séjour(s) futur(s) sont connus : rien modifié');
    return;
  }
  if (src === 'booking') {
    var free = ctx.rows.filter(function (r) {
      // Seules des dates apparues à cette synchro peuvent être un changement de dates.
      return r.source === 'booking' && r.origin === 'ical' && seen[r.key] && !r.mergedInto && r.status !== 'cancelled' && r.createdAt === ctx.now &&
        nightsBetween_(r.checkin, r.checkout) <= MAX_ICAL_STAY_NIGHTS;
    });
    missing = missing.filter(function (r) {
      var near = free.filter(function (p) { return Math.abs(nightsBetween_(r.checkin, p.checkin) || nightsBetween_(p.checkin, r.checkin)) <= 60; });
      if (near.length !== 1) return true;
      var p = near[0];
      var others = missing.filter(function (o) { return o !== r && Math.abs(nightsBetween_(o.checkin, p.checkin) || nightsBetween_(p.checkin, o.checkin)) <= 60; });
      if (others.length) return true; // ambigu : on ne devine pas
      var locked = lockedSet_(r);
      if (!locked.checkin) r.checkin = p.checkin;
      if (!locked.checkout) r.checkout = p.checkout;
      mergePlaceholder_(r, p);
      free.splice(free.indexOf(p), 1);
      r.seenAt = ctx.now;
      r.updatedAt = ctx.now;
      ctx.counts.updated++;
      ctx.warnings.push('Booking n° ' + r.code + ' : dates changées → ' + r.checkin + ' / ' + r.checkout);
      return false;
    });
  }
  missing.forEach(function (r) {
    var known48h = r.createdAt && nowMs - Date.parse(r.createdAt) > 48 * 3600 * 1000;
    if ((!r.seenAt && !known48h) || lockedSet_(r).status) return;
    r.status = 'cancelled';
    r.autoStatus = 'absent';
    r.updatedAt = ctx.now;
    ctx.counts.cancelled++;
    ctx.warnings.push((src === 'airbnb' ? 'Airbnb ' : 'Booking n° ') + (r.code || '') + ' du ' + r.checkin + ' absente du calendrier : considérée annulée');
  });
}

/** Une réservation Booking d'abord vue dans l'iCal puis reçue par e-mail : on garde les saisies. */
function mergePlaceholder_(target, ph) {
  var tl = lockedSet_(target);
  Object.keys(lockedSet_(ph)).forEach(function (f) {
    if (f === 'hidden' || f === 'checkin' || f === 'checkout' || f === 'status') return;
    if (!target[f] && ph[f]) { target[f] = ph[f]; tl[f] = true; }
  });
  target.locked = Object.keys(tl).join(',');
  ph.mergedInto = target.key;
}

// Relecture complète demandée une fois par ces versions (ex. 1.1.2 : la 1.0 avait marqué
// comme lus des e-mails qu'elle n'avait pas su décoder).
var EMAIL_RESCAN_VERSION = '1.5.2'; // 1.5.2 : net des e-mails Airbnb de 2024 ; 1.5.0 : frais de service hôte Airbnb (commission réelle) ; 1.3.1 : messages des clients Booking

function scanEmails_(ctx) {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('emailRescanDone') !== EMAIL_RESCAN_VERSION) {
    writeRows_(SHEET_EMAILS, ['id'], []);
    props.deleteProperty('lastEmailScan');
    props.setProperty('emailRescanDone', EMAIL_RESCAN_VERSION);
  }
  var tz = Session.getScriptTimeZone() || 'Europe/Paris';
  var last = props.getProperty('lastEmailScan');
  // Seuls les e-mails utiles (expéditeurs et sujets vérifiés sur les vrais e-mails) : moins de lectures Gmail.
  var q = '{(from:automated@airbnb.com subject:(confirmée OR confirmed OR annulation OR annulée OR canceled OR cancelled))' +
    ' (from:noreply@booking.com subject:("nouvelle réservation" OR annulée OR modification OR "new booking" OR cancelled OR cancellation OR "envoyé ce message"))' +
    ' from:(guest.booking.com OR property.booking.com)}' +
    (last ? ' after:' + last : '');
  var processed = {};
  readRows_(SHEET_EMAILS, ['id']).forEach(function (r) { processed[r.id] = true; });
  var ids = [];
  var pageToken = null;
  for (var guard = 0; guard < 50; guard++) {
    var resp = gmail_(function () { return Gmail.Users.Messages.list('me', { q: q, maxResults: 500, pageToken: pageToken || undefined }); });
    (resp.messages || []).forEach(function (m) { if (!processed[m.id]) ids.push(m.id); });
    pageToken = resp.nextPageToken;
    if (!pageToken) break;
  }
  // Plafond par passage (limites Gmail et 6 min d'Apps Script) : le reste est lu à la synchro suivante.
  var truncated = ids.length > GMAIL_MAX_PER_RUN;
  if (truncated) ids = ids.slice(ids.length - GMAIL_MAX_PER_RUN); // les plus anciens d'abord
  var metas = [];
  for (var i = 0; i < ids.length; i++) {
    var m;
    try {
      m = gmail_(function () { return Gmail.Users.Messages.get('me', ids[i], { format: 'metadata', metadataHeaders: ['From', 'Subject'] }); });
    } catch (e) {
      if (!isQuotaError_(e)) throw e;
      truncated = true;
      break;
    }
    metas.push({ id: ids[i], date: new Date(Number(m.internalDate)), from: header_(m, 'From').toLowerCase(), subject: header_(m, 'Subject') });
  }
  metas.sort(function (a, b) { return a.date - b.date; });
  var done = [];
  var stop = false;
  metas.forEach(function (m) {
    var ymd = Utilities.formatDate(m.date, tz, 'yyyy-MM-dd');
    if (stop) return;
    try {
      if (m.from.indexOf('airbnb') >= 0) handleAirbnbEmail_(ctx, m, ymd);
      else if (m.from.indexOf('booking.com') >= 0) handleBookingEmail_(ctx, m, ymd);
    } catch (e) {
      if (isQuotaError_(e)) { stop = true; truncated = true; return; } // repris tel quel à la prochaine synchro
      // Non marqué comme lu : il sera retenté à la prochaine synchro (une erreur ne fait rien perdre).
      ctx.errors.push('e-mail « ' + m.subject.slice(0, 60) + ' » : ' + e.message);
      truncated = true;
      return;
    }
    done.push(m.id);
  });
  ctx.counts.emails = done.length;
  appendRows_(SHEET_EMAILS, ['id'], done.map(function (id) { return { id: id }; }));
  if (truncated) ctx.warnings.push('lecture des e-mails en plusieurs fois (limite Gmail) : suite à la prochaine synchro, rien n\'est perdu');
  else props.setProperty('lastEmailScan', Utilities.formatDate(new Date(Date.now() - 3 * 86400000), tz, 'yyyy/MM/dd'));
}

/**
 * Factures mensuelles Booking (PDF joint) : ventes, commission et frais réels du
 * mois, par date de départ. Une facture qui échoue sera retentée à la synchro suivante.
 */
function scanBookingInvoices_(ctx) {
  var known = {};
  readRows_(SHEET_INVOICES, INVOICE_COLS).forEach(function (i) { known[i.emailId] = true; known['n' + i.number] = true; });
  var resp = gmail_(function () { return Gmail.Users.Messages.list('me', { q: 'from:booking.com subject:(invoice OR facture) has:attachment', maxResults: 100 }); });
  var added = [];
  var stop = false;
  (resp.messages || []).forEach(function (ref) {
    if (known[ref.id] || stop) return;
    var msg;
    try {
      msg = gmail_(function () { return Gmail.Users.Messages.get('me', ref.id, { format: 'full' }); });
    } catch (e) {
      if (!isQuotaError_(e)) throw e;
      stop = true;
      ctx.warnings.push('factures Booking : limite Gmail atteinte, suite à la prochaine synchro');
      return;
    }
    var subject = header_(msg, 'Subject');
    if (!/invoice|facture/i.test(subject)) return;
    var att = findPdfPart_(msg.payload);
    if (!att) return;
    try {
      var data = gmail_(function () { return Gmail.Users.Messages.Attachments.get('me', ref.id, att.body.attachmentId); }).data;
      var text = pdfToText_(bytesOf_(data), att.filename || 'facture.pdf');
      var inv = parseBookingInvoice_(text, subject);
      if (!inv) { ctx.warnings.push('facture Booking illisible : « ' + subject + ' »'); return; }
      if (known['n' + inv.number]) return;
      inv.emailId = ref.id;
      inv.readAt = ctx.now;
      added.push(inv);
      known['n' + inv.number] = true;
    } catch (e) {
      ctx.warnings.push('facture « ' + subject + ' » non lue (' + e.message + '), nouvel essai à la prochaine synchro');
    }
  });
  if (added.length) appendRows_(SHEET_INVOICES, INVOICE_COLS, added);
  ctx.counts.invoices = added.length;
}

function findPdfPart_(part) {
  if (!part) return null;
  if (part.filename && /\.pdf$/i.test(part.filename) && part.body && part.body.attachmentId) return part;
  var parts = part.parts || [];
  for (var i = 0; i < parts.length; i++) {
    var f = findPdfPart_(parts[i]);
    if (f) return f;
  }
  return null;
}

/**
 * Texte d'un PDF via la conversion Google Drive (fichier temporaire supprimé aussitôt).
 * Création par le service avancé Drive : il active l'API Drive du projet Apps Script
 * (sans lui, Google répondait 403 sur le compte de Raphaël).
 */
function pdfToText_(bytes, name) {
  var auth = { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() };
  var id;
  try {
    id = Drive.Files.create({ name: 'tmp-' + name, mimeType: 'application/vnd.google-apps.document' },
      Utilities.newBlob(bytes, 'application/pdf', name), { fields: 'id' }).id;
  } catch (e) {
    throw new Error('conversion du PDF refusée : ' + String(e && e.message || e).slice(0, 160));
  }
  try {
    var ex = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + id + '/export?mimeType=text%2Fplain', { headers: auth, muteHttpExceptions: true });
    if (ex.getResponseCode() !== 200) throw new Error('lecture du PDF converti impossible (' + ex.getResponseCode() + ' ' + apiErrorText_(ex.getContentText()) + ')');
    return ex.getContentText();
  } finally {
    try { Drive.Files.remove(id); } catch (e) {
      UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + id, { method: 'delete', headers: auth, muteHttpExceptions: true });
    }
  }
}

function apiErrorText_(text) {
  try { return JSON.parse(text).error.message.slice(0, 160); } catch (e) { return String(text || '').slice(0, 160); }
}

function handleAirbnbEmail_(ctx, m, ymd) {
  if (isAirbnbConfirmationSubject_(m.subject)) {
    var body = plainBody_(gmail_(function () { return Gmail.Users.Messages.get('me', m.id, { format: 'full' }); }));
    var p = parseAirbnbConfirmation_(m.subject, body, ymd);
    if (!p) { ctx.warnings.push('format Airbnb non reconnu : « ' + m.subject.slice(0, 60) + ' »'); return; }
    var r = upsert_(ctx, 'airbnb:' + p.code, { source: 'airbnb', origin: 'email', status: 'confirmed' }, {
      code: p.code, guest: p.guest, guestsText: p.guestsText, guestsCount: p.guestsCount, location: p.location,
      amountNet: p.amountNet, paidByGuest: p.paidByGuest, commission: p.commission, emailId: m.id
    }, { checkin: p.checkin, checkout: p.checkout });
    if (r.origin === 'ical') r.origin = 'email';
    return;
  }
  var code = parseAirbnbCancellationSubject_(m.subject);
  if (code) cancel_(ctx, 'airbnb:' + code);
}

function handleBookingEmail_(ctx, m, ymd) {
  // Messages des clients (et demandes d'annulation) : seuls e-mails Booking qui donnent
  // le nom et la date de départ (vérifié sur les vrais e-mails, 27 oct. 2026).
  if (/guest\.booking\.com|property\.booking\.com/.test(m.from) || /envoy[ée] ce message/i.test(m.subject)) {
    var full = gmail_(function () { return Gmail.Users.Messages.get('me', m.id, { format: 'full' }); });
    var d = parseBookingGuestMessage_(plainBody_(full));
    if (!d) return;
    var r = upsert_(ctx, 'booking:' + d.number, { source: 'booking', origin: 'email', status: 'confirmed' },
      { code: d.number, checkout: d.checkout }, { guest: d.guest, checkin: d.checkin });
    if (r.origin === 'ical') r.origin = 'email';
    return;
  }
  var p = parseBookingSubject_(m.subject);
  if (!p.number) return;
  var key = 'booking:' + p.number;
  if (p.type === 'new' && p.date) {
    upsert_(ctx, key, { source: 'booking', origin: 'email', status: 'confirmed' },
      { code: p.number, emailId: m.id }, { checkin: p.date });
  } else if (p.type === 'modif' && p.date && ctx.byKey[key]) {
    var r = ctx.byKey[key];
    if (!lockedSet_(r).checkin && r.checkin !== p.date) {
      r.checkin = p.date;
      if (r.checkout && r.checkout <= p.date) r.checkout = '';
      r.updatedAt = ctx.now;
      ctx.counts.updated++;
    }
  } else if (p.type === 'cancel') {
    cancel_(ctx, key);
  }
  if (p.guest && ctx.byKey[key] && !ctx.byKey[key].guest) ctx.byKey[key].guest = p.guest;
}

function cancel_(ctx, key) {
  var r = ctx.byKey[key];
  if (!r || r.status === 'cancelled' || lockedSet_(r).status) return;
  r.status = 'cancelled';
  r.updatedAt = ctx.now;
  ctx.counts.cancelled++;
}

/**
 * Crée ou met à jour une réservation. `fields` écrase (sauf champs modifiés
 * à la main), `ifEmpty` ne remplit que les champs vides.
 */
function upsert_(ctx, key, base, fields, ifEmpty) {
  var r = ctx.byKey[key];
  var created = false;
  if (!r) {
    r = newRow_(RES_COLS);
    r.id = Utilities.getUuid();
    r.key = key;
    Object.keys(base).forEach(function (k) { r[k] = base[k]; });
    r.createdAt = ctx.now;
    ctx.rows.push(r);
    ctx.byKey[key] = r;
    created = true;
    ctx.counts.added++;
  }
  var locked = lockedSet_(r);
  var changed = false;
  function set(f, v, onlyEmpty) {
    if (v === undefined || v === null || v === '' || locked[f]) return;
    if (onlyEmpty && r[f]) return;
    if (String(r[f]) !== String(v)) { r[f] = String(v); changed = true; }
  }
  Object.keys(fields || {}).forEach(function (f) { set(f, fields[f], false); });
  Object.keys(ifEmpty || {}).forEach(function (f) { set(f, ifEmpty[f], true); });
  if (changed && !created) ctx.counts.updated++;
  if (changed || created) r.updatedAt = ctx.now;
  return r;
}

// =====================================================================
// Lecture des e-mails et des calendriers (fonctions pures, testées)
// =====================================================================

function isAirbnbConfirmationSubject_(subject) {
  return /^\s*(?:R[ée]servation confirm[ée]e|Reservation confirmed)\s*[:\-–]/i.test(subject || '');
}

function parseAirbnbCancellationSubject_(subject) {
  var s = String(subject || '');
  if (!/annul|cancel/i.test(s)) return '';
  var m = s.match(/\b(HM[A-Z0-9]{6,})\b/);
  return m ? m[1] : '';
}

function parseAirbnbConfirmation_(subject, body, emailYmd) {
  var sm = String(subject || '').match(/^\s*(?:R[ée]servation confirm[ée]e|Reservation confirmed)\s*[:\-–]\s*(.+?)\s+(?:arrive|arrives|arrivera)\b/i);
  if (!sm) return null;
  var text = String(body || '').replace(/\r/g, '');
  var cm = text.match(/(?:CODE DE CONFIRMATION|CONFIRMATION CODE)\s*\n?\s*(HM[A-Z0-9]{6,})/i) ||
    text.match(/details\/(HM[A-Z0-9]{6,})/);
  if (!cm) return null;
  var out = { code: cm[1], guest: sm[1].trim(), checkin: '', checkout: '', guestsText: '', guestsCount: '', location: '',
    amountNet: '', paidByGuest: '', commission: '' };
  var dm = text.match(/(?:Arriv[ée]e\s+D[ée]part|Check-?in\s+Check-?out)\s*\n+\s*([^\n]+)/i);
  if (dm) {
    var d = extractDates_(dm[1]);
    if (d.length >= 2) {
      out.checkin = inferDate_(d[0].day, d[0].month, d[0].year, emailYmd);
      out.checkout = inferDate_(d[1].day, d[1].month, d[1].year, out.checkin);
    }
  }
  // Provenance indiquée par le voyageur (« Lyon, France »), juste après « Identité vérifiée · … ».
  var lm = text.match(/(?:Identit[ée] v[ée]rifi[ée]e|Identity verified)[^\n]*\n\s*\n\s*([^\n]{3,60})\n/i);
  if (lm && /^[A-ZÀ-ÝŁŚŻ][^,.!?:;@\d]{1,40}(?:, [A-ZÀ-ÝŁŚŻ][^,.!?:;@\d]{1,40})+$/.test(lm[1].trim())) out.location = lm[1].trim();
  var gm = text.match(/(?:^|\n)\s*(?:VOYAGEURS|GUESTS)\s*\n+\s*([^\n]+)/i);
  if (gm) {
    out.guestsText = gm[1].trim();
    var total = 0;
    var re = /(\d+)\s*(adulte|enfant|adult|child)/gi;
    var x;
    while ((x = re.exec(gm[1])) !== null) total += Number(x[1]);
    if (!total) { var n = gm[1].match(/\d+/); if (n) total = Number(n[0]); }
    if (total) out.guestsCount = String(total);
  }
  // Partie « LE VOYAGEUR A PAYÉ » puis « VERSEMENT DE L'HÔTE ». Net : « VOUS GAGNEZ x € » (depuis 2025)
  // ou le « TOTAL (EUR) » du versement (e-mails de 2024, vérifié sur un vrai e-mail le 22 nov. 2026).
  var AMT = '(-?\\d[\\d\\s\\u00a0\\u202f.,]*)';
  var split = text.search(/VERSEMENT DE L['’]H[ÔO]TE|HOST PAYOUT/i);
  var guestPart = split >= 0 ? text.slice(0, split) : text, hostPart = split >= 0 ? text.slice(split) : '';
  var am = text.match(new RegExp('(?:VOUS GAGNEZ|YOU EARN)[ \\t]*(?:€|EUR)?[ \\t]*' + AMT, 'i')) ||
    hostPart.match(new RegExp('TOTAL\\s*\\((?:EUR|€)\\)[ \\t]*(?:€)?[ \\t]*' + AMT, 'i'));
  if (am) { var a = parseAmount_(am[1].split('\n')[0]); if (a !== null) out.amountNet = String(a); }
  var pm = guestPart.match(new RegExp('TOTAL\\s*\\((?:EUR|€)\\)[ \\t]*(?:€)?[ \\t]*' + AMT, 'i'));
  if (pm) { var b = parseAmount_(pm[1].split('\n')[0]); if (b !== null) out.paidByGuest = String(b); }
  // Commission réelle Airbnb : « Frais de service hôte (15.5 % + TVA) -77,70 € », ou « Frais de service -75,60 € »
  // dans le versement (2024) ; dernier montant de la ligne.
  var fm = text.match(/(?:Frais de service h[ôo]te|Host service fee)[^\n]*/i) || hostPart.match(/(?:Frais de service|Service fee)[^\n]*/i);
  if (fm) {
    var fa = fm[0].replace(/\([^)]*\)/g, '').match(/(\d[\d\s  .,]*\d|\d)\s*€?\s*$/);
    var fv = fa ? parseAmount_(fa[1]) : null;
    if (fv !== null) out.commission = String(Math.abs(fv));
  }
  return out;
}

function parseBookingSubject_(subject) {
  var s = String(subject || '');
  var type = /nouvelle r[ée]servation|new booking|new reservation/i.test(s) ? 'new'
    : /annul|cancel/i.test(s) ? 'cancel'
    : /modif/i.test(s) ? 'modif' : 'other';
  var out = { type: type, number: '', date: '', guest: '' };
  var m = s.match(/\((\d{8,12}),\s*(?:[^\d,()]+,?\s*)?(\d{1,2})\s+([^\s\d,()]+)\s+(\d{4})\)/);
  if (m) {
    out.number = m[1];
    var mo = monthNum_(m[3]);
    if (mo) out.date = ymd_(Number(m[4]), mo, Number(m[2]));
  } else {
    var en = s.match(/\((\d{8,12}),\s*(?:[A-Za-z]+,\s*)?([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})\)/);
    if (en) {
      out.number = en[1];
      var mo2 = monthNum_(en[2]);
      if (mo2) out.date = ymd_(Number(en[4]), mo2, Number(en[3]));
    }
  }
  if (!out.number) {
    var n = s.match(/\((\d{8,12})\)/);
    if (n) out.number = n[1];
  }
  var g = s.match(/:\s*([^:()]+?)\s*\((\d{8,12})\)\s*$/);
  if (g && !/booking/i.test(g[1])) out.guest = g[1].trim();
  return out;
}

/** Message de client Booking → numéro, nom, arrivée, départ. */
function parseBookingGuestMessage_(text) {
  var t = String(text || '');
  var num = t.match(/Num[ée]ro de r[ée]servation\s*:\s*(\d{8,12})/i) || t.match(/Booking number\s*:\s*(\d{8,12})/i);
  if (!num) return null;
  function dateAfter(label) {
    var m = t.match(new RegExp(label + '\\s*:\\s*(?:[^\\d\\n]+\\s)?(\\d{1,2})\\s+([^\\s\\d]+)\\s+(\\d{4})', 'i'));
    if (!m) return '';
    var mo = monthNum_(m[2]);
    return mo ? ymd_(Number(m[3]), mo, Number(m[1])) : '';
  }
  var name = t.match(/(?:Nom du client|Guest name)\s*:\s*([^\n]+)/i);
  var out = { number: num[1], guest: name ? name[1].trim() : '', checkin: dateAfter('(?:Arriv[ée]e|Check-in)'), checkout: dateAfter('(?:D[ée]part|Check-out)') };
  if (out.checkout && out.checkin && out.checkout <= out.checkin) out.checkout = '';
  return out;
}

/** Facture Booking (texte du PDF) → période, ventes, commission, frais. */
function parseBookingInvoice_(text, subject) {
  var t = String(text || '').replace(/\r/g, '');
  var NUM = '(\\d{1,3}(?:[ \\u00a0\\u202f.]\\d{3})*,\\d{2}|\\d{1,3}(?:,\\d{3})*\\.\\d{2}|\\d+)';
  var CUR = '(?:EUR|€)\\s*';
  // Selon la conversion, les libellés et les valeurs peuvent être séparés : on cherche la période seule.
  var per = t.match(/(\d{2})\/(\d{2})\/(\d{4})\s*[-–]\s*(\d{2})\/(\d{2})\/(\d{4})/);
  var sales = t.match(new RegExp('(?:R[ée]servations|Reservations)\\s+' + CUR + NUM + '\\s+' + CUR + NUM, 'i'));
  if (!per || !sales) return null;
  var num = String(subject || '').match(/(?:invoice|facture)\D*(\d{6,})/i) || t.match(/(?:Num[ée]ro de facture|Invoice number)\s*:?\s*(\d{6,})/i);
  var fees = t.match(new RegExp('(?:Frais de service de paiement|Payments? service fees?|Payment charges?)\\s+' + CUR + NUM, 'i'));
  var total = t.match(new RegExp('(?:Montant total d[ûu]|Total amount due)\\s+' + CUR + NUM, 'i'));
  var out = {
    number: num ? num[1] : per[6] + per[5] + per[4],
    periodStart: per[3] + '-' + per[2] + '-' + per[1],
    periodEnd: per[6] + '-' + per[5] + '-' + per[4],
    sales: String(parseAmount_(sales[1])),
    commission: String(parseAmount_(sales[2])),
    paymentFees: fees ? String(parseAmount_(fees[1])) : '0',
    total: total ? String(parseAmount_(total[1])) : ''
  };
  if (out.sales === 'null' || out.commission === 'null') return null;
  return out;
}

function parseIcs_(text) {
  var lines = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  var events = [];
  var cur = null;
  lines.forEach(function (raw) {
    var line = raw.replace(/\s+$/, '');
    if (line === 'BEGIN:VEVENT') { cur = {}; return; }
    if (line === 'END:VEVENT') { if (cur && cur.start) events.push(cur); cur = null; return; }
    if (!cur) return;
    var i = line.indexOf(':');
    if (i < 0) return;
    var name = line.slice(0, i).split(';')[0].toUpperCase();
    var val = line.slice(i + 1);
    if (name === 'DTSTART') cur.start = icsDate_(val);
    else if (name === 'DTEND') cur.end = icsDate_(val);
    else if (name === 'SUMMARY') cur.summary = unescapeIcs_(val);
    else if (name === 'DESCRIPTION') cur.description = unescapeIcs_(val);
    else if (name === 'UID') cur.uid = val.trim();
  });
  events.forEach(function (e) { if (!e.end && e.start) e.end = addDays_(e.start, 1); });
  return events;
}

function icsDate_(v) {
  var m = String(v || '').match(/(\d{4})(\d{2})(\d{2})/);
  return m ? m[1] + '-' + m[2] + '-' + m[3] : '';
}

function unescapeIcs_(v) {
  return String(v || '').replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

var MONTHS_ = {
  janvier: 1, janv: 1, jan: 1, january: 1,
  fevrier: 2, fevr: 2, fev: 2, feb: 2, february: 2,
  mars: 3, mar: 3, march: 3,
  avril: 4, avr: 4, apr: 4, april: 4,
  mai: 5, may: 5,
  juin: 6, jun: 6, june: 6,
  juillet: 7, juil: 7, jul: 7, july: 7,
  aout: 8, aug: 8, august: 8,
  septembre: 9, sept: 9, sep: 9, september: 9,
  octobre: 10, oct: 10, october: 10,
  novembre: 11, nov: 11, november: 11,
  decembre: 12, dec: 12, december: 12
};

function monthNum_(w) {
  var k = stripAccents_(String(w || '').toLowerCase()).replace(/\./g, '');
  return MONTHS_[k] || 0;
}

function extractDates_(line) {
  var out = [];
  var re = /(\d{1,2})\s+([A-Za-zÀ-ÿ]+)\.?(?:\s+(\d{4}))?/g;
  var m;
  while ((m = re.exec(line)) !== null) {
    var mo = monthNum_(m[2]);
    if (mo) out.push({ day: Number(m[1]), month: mo, year: m[3] ? Number(m[3]) : 0 });
  }
  if (out.length >= 2) return out;
  out = [];
  var re2 = /([A-Za-z]+)\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?/g;
  while ((m = re2.exec(line)) !== null) {
    var mo2 = monthNum_(m[1]);
    if (mo2) out.push({ day: Number(m[2]), month: mo2, year: m[3] ? Number(m[3]) : 0 });
  }
  return out;
}

/** Les e-mails Airbnb n'indiquent pas l'année : on prend la première date qui suit la référence. */
function inferDate_(day, month, year, refYmd) {
  if (!day || !month) return '';
  if (year) return ymd_(year, month, day);
  var ry = Number(String(refYmd).slice(0, 4));
  var cand = ymd_(ry, month, day);
  if (cand < addDays_(refYmd, -7)) cand = ymd_(ry + 1, month, day);
  return cand;
}

function parseAmount_(raw) {
  if (raw === undefined || raw === null) return null;
  var s = String(raw).replace(/[\s  €$£]/g, '').replace(/EUR/i, '');
  if (!s) return null;
  var neg = /^[-−]/.test(s);
  s = s.replace(/^[-−]/, '');
  if (!/^\d[\d.,]*$/.test(s)) return null;
  var dec = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  var tail = dec >= 0 ? s.length - dec - 1 : 0;
  if (dec >= 0 && tail > 0 && tail <= 2) s = s.slice(0, dec).replace(/[.,]/g, '') + '.' + s.slice(dec + 1);
  else s = s.replace(/[.,]/g, '');
  var n = parseFloat(s);
  if (isNaN(n)) return null;
  return Math.round((neg ? -n : n) * 100) / 100;
}

// =====================================================================
// Import de l'export des réservations Booking (extranet › Réservations › Télécharger)
// =====================================================================

// Noms de colonnes reconnus, comparés sans accents, casse ni ponctuation (« % » devient « pct »).
var BOOKING_EXPORT_COLS = {
  number: ['numero de reservation', 'n de reservation', 'no de reservation', 'reservation number', 'booking number', 'book number', 'reservation id', 'numero de la reservation'],
  guest: ['nom du client', 'nom des clients', 'noms des clients', 'nom s du des client s', 'nom s des client s', 'nom s du client', 'guest name s', 'guest names', 'guest name', 'nom du voyageur', 'nom des voyageurs'],
  booker: ['reserve par', 'reservation effectuee par', 'booked by', 'booker name'],
  checkin: ['arrivee', 'date d arrivee', 'check in', 'checkin', 'arrival', 'arrival date'],
  checkout: ['depart', 'date de depart', 'check out', 'checkout', 'departure', 'departure date'],
  status: ['statut', 'status', 'statut de la reservation', 'reservation status'],
  price: ['prix', 'price', 'prix total', 'montant total', 'total price', 'tarif', 'montant'],
  commission: ['montant de la commission', 'commission amount', 'montant commission', 'commission'],
  commissionPct: ['pct comm', 'commission pct', 'pct de commission', 'pourcentage de commission', 'taux de commission', 'commission rate'],
  people: ['personnes', 'nombre de personnes', 'people', 'persons', 'voyageurs', 'guests'],
  adults: ['adultes', 'nombre d adultes', 'adults'],
  children: ['enfants', 'nombre d enfants', 'children'],
  country: ['pays du client', 'pays de la personne ayant reserve', 'booker country', 'guest country', 'pays', 'country'],
  phone: ['numero de telephone', 'telephone', 'phone number', 'phone'],
  cancelledOn: ['date d annulation', 'cancellation date']
};
var BOOKING_EXPORT_MAX_B64 = 14000000; // ≈ 10 Mo de fichier

/** Action propriétaire : fichier (base64) → réservations Booking complétées. */
function importBookingExport_(p) {
  var name = str_(p && p.name, 120);
  var data = String((p && p.data) || '').replace(/^data:[^,]*,/, '');
  if (!data) throw new Error('Aucun fichier reçu.');
  if (data.length > BOOKING_EXPORT_MAX_B64) throw new Error('Fichier trop gros (10 Mo maximum).');
  var parsed = parseBookingExport_(readTableFile_(data));
  if (!parsed.records.length && !parsed.errors.length) throw new Error('Aucune réservation dans ce fichier.');
  var result = withLock_(function () {
    var rows = readRows_(SHEET_RES, RES_COLS);
    var out = applyBookingExport_(parsed.records, rows, readRows_(SHEET_INVOICES, INVOICE_COLS), nowIso_());
    writeRows_(SHEET_RES, RES_COLS, out.rows);
    return out.summary;
  });
  result.errors = parsed.errors.concat(result.errors);
  var c = result;
  var message = c.added + ' nouvelle(s), ' + c.updated + ' mise(s) à jour, ' + c.cancelled + ' annulée(s), ' +
    c.unchanged + ' inchangée(s), ' + c.errors.length + ' erreur(s)';
  var details = [];
  if (c.kept) details.push(c.kept + ' valeur(s) saisie(s) à la main conservée(s)');
  c.checks.forEach(function (k) {
    details.push('Facture ' + k.label + ' : ' + (k.match ? 'net identique (' + fmtEur_(k.invoiceNet) + ')' :
      'export ' + fmtEur_(k.exportNet) + ' / facture ' + fmtEur_(k.invoiceNet)));
  });
  details = details.concat(c.warnings, c.errors.slice(0, 15));
  if (c.errors.length > 15) details.push('… et ' + (c.errors.length - 15) + ' autre(s) erreur(s)');
  var last = { at: nowIso_(), ok: c.errors.length === 0, file: name, message: message, details: details };
  PropertiesService.getScriptProperties().setProperty('lastImport', JSON.stringify(last));
  appendLog_('import Booking', last.ok, message + (details.length ? ' | ' + details.join(' ; ') : ''));
  return last;
}

/** Contenu d'un fichier (base64) → tableau de lignes : Excel .xls (relevé Booking), .xlsx, CSV ou page HTML enregistrée en .xls. */
function readTableFile_(b64) {
  var bytes;
  try { bytes = Utilities.base64Decode(b64); } catch (e) { throw new Error('Fichier illisible.'); }
  if (!bytes || !bytes.length) throw new Error('Fichier vide.');
  var b0 = bytes[0] & 255, b1 = bytes[1] & 255;
  if (b0 === 0x50 && b1 === 0x4B) return xlsxRows_(bytes);
  if (b0 === 0xD0 && b1 === 0xCF) {
    try { return xlsRows_(bytes); } catch (e) { throw new Error('Fichier Excel .xls illisible. Dans Booking, retélécharge le relevé (ou enregistre-le en .xlsx ou CSV).'); }
  }
  var text = bytesToText_(bytes);
  if (/<table[\s>]/i.test(text)) return htmlTableRows_(text);
  return csvRows_(text);
}

function bytesToText_(bytes) {
  var b0 = bytes[0] & 255, b1 = bytes[1] & 255, b2 = bytes[2] & 255;
  if (b0 === 0xFF && b1 === 0xFE) return Utilities.newBlob(bytes.slice(2)).getDataAsString('UTF-16LE');
  if (b0 === 0xFE && b1 === 0xFF) return Utilities.newBlob(bytes.slice(2)).getDataAsString('UTF-16BE');
  if (b0 === 0xEF && b1 === 0xBB && b2 === 0xBF) bytes = bytes.slice(3);
  var t = Utilities.newBlob(bytes).getDataAsString('UTF-8');
  if (t.indexOf('�') >= 0) t = Utilities.newBlob(bytes).getDataAsString('windows-1252');
  return t;
}

/** CSV : séparateur deviné (« ; » , « , » ou tabulation), guillemets gérés. */
function csvRows_(text) {
  var t = String(text || '').replace(/^﻿/, '');
  var first = (t.match(/^[^\r\n]*/) || [''])[0];
  var counts = { ';': 0, ',': 0, '\t': 0 }, q = false;
  for (var i = 0; i < first.length; i++) {
    var ch = first.charAt(i);
    if (ch === '"') q = !q; else if (!q && counts.hasOwnProperty(ch)) counts[ch]++;
  }
  var sep = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; })[0];
  var rows = [], row = [], cell = '', inQ = false;
  for (var j = 0; j < t.length; j++) {
    var c = t.charAt(j);
    if (inQ) {
      if (c === '"') { if (t.charAt(j + 1) === '"') { cell += '"'; j++; } else inQ = false; } else cell += c;
    } else if (c === '"' && cell === '') inQ = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t.charAt(j + 1) === '\n') j++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** Excel .xlsx (zip de fichiers XML) : première feuille, textes partagés résolus. */
function xlsxRows_(bytes) {
  var files = {};
  try {
    Utilities.unzip(Utilities.newBlob(bytes, 'application/zip', 'export.xlsx')).forEach(function (b) { files[b.getName()] = b; });
  } catch (e) { throw new Error('Fichier Excel illisible.'); }
  function text(n) { return files[n] ? files[n].getDataAsString('UTF-8') : ''; }
  var shared = [];
  text('xl/sharedStrings.xml').replace(/<si\b[^>]*>([\s\S]*?)<\/si>/g, function (_, si) { shared.push(xmlText_(si)); return ''; });
  var path = 'xl/worksheets/sheet1.xml';
  var sheetTag = text('xl/workbook.xml').match(/<sheet\b[^>]*\br:id="([^"]+)"/);
  if (sheetTag) {
    var rel = text('xl/_rels/workbook.xml.rels').match(new RegExp('<Relationship\\b[^>]*\\bId="' + sheetTag[1] + '"[^>]*>'));
    var target = rel && rel[0].match(/\bTarget="([^"]+)"/);
    if (target) path = target[1].charAt(0) === '/' ? target[1].slice(1) : 'xl/' + target[1].replace(/^\.\//, '');
  }
  var xml = text(path);
  if (!xml) throw new Error('Feuille introuvable dans le fichier Excel.');
  var rows = [];
  xml.replace(/<row\b[^>]*>([\s\S]*?)<\/row>/g, function (_, inner) {
    var row = [];
    inner.replace(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, function (__, attrs, body) {
      var ref = (attrs.match(/\br="([A-Z]+)\d+"/) || [])[1];
      var type = (attrs.match(/\bt="([^"]+)"/) || [])[1] || '';
      var v = '';
      body = body || '';
      if (type === 'inlineStr') v = xmlText_(body);
      else {
        var vm = body.match(/<v>([\s\S]*?)<\/v>/);
        v = vm ? xmlDecode_(vm[1]) : '';
        if (type === 's') v = shared[Number(v)] || '';
      }
      row[ref ? colIndex_(ref) : row.length] = v;
      return '';
    });
    for (var i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = '';
    rows.push(row);
    return '';
  });
  return rows;
}

/**
 * Excel 97-2003 (.xls, format BIFF8 dans un fichier OLE) : c'est ce que donne
 * « Télécharger le relevé de réservations » de l'extranet Booking (vérifié le 22 nov. 2026).
 * Lit la première feuille : textes (table partagée), nombres, formules.
 */
function xlsRows_(bytes) {
  var u8 = [];
  for (var i = 0; i < bytes.length; i++) u8.push(bytes[i] & 255);
  var wb = cfbStream_(u8, ['Workbook', 'Book']);
  if (!wb) throw new Error('Fichier Excel .xls illisible (classeur introuvable).');
  function u16(p) { return wb[p] | (wb[p + 1] << 8); }
  function u32(p) { return (wb[p] | (wb[p + 1] << 8) | (wb[p + 2] << 16)) + wb[p + 3] * 16777216; }
  function num(p) { // double IEEE 754 (8 octets, petit-boutiste)
    var lo = u32(p), hi = u32(p + 4);
    var sign = hi >= 2147483648 ? -1 : 1, exp = Math.floor(hi / 1048576) % 2048, mant = (hi % 1048576) * 4294967296 + lo;
    if (exp === 0) return sign * mant * Math.pow(2, -1074);
    if (exp === 2047) return NaN;
    return sign * (1 + mant / 4503599627370496) * Math.pow(2, exp - 1023);
  }
  function rk(v) {
    var n;
    if (v & 2) n = (v >> 2) | 0; // entier signé sur 30 bits
    else { var hi = v - (v % 4); n = num8_(hi); }
    return (v & 1) ? n / 100 : n;
  }
  function num8_(hi) { // double dont seuls les 32 bits de poids fort sont donnés
    var sign = hi >= 2147483648 ? -1 : 1, exp = Math.floor(hi / 1048576) % 2048, mant = (hi % 1048576) * 4294967296;
    if (exp === 0) return 0;
    return sign * (1 + mant / 4503599627370496) * Math.pow(2, exp - 1023);
  }
  function numStr(n) { return Math.floor(n) === n ? String(n) : String(parseFloat(n.toPrecision(15))); }
  // Enregistrements : [type u16][longueur u16][données]
  var recs = [];
  for (var p = 0; p + 4 <= wb.length;) {
    var type = u16(p), len = u16(p + 2);
    recs.push({ type: type, pos: p + 4, len: len });
    p += 4 + len;
  }
  // Table des textes partagés (SST + CONTINUE).
  var sst = [];
  for (var k = 0; k < recs.length; k++) {
    if (recs[k].type !== 0x00FC) continue;
    var segs = [recs[k]];
    for (var c = k + 1; c < recs.length && recs[c].type === 0x003C; c++) segs.push(recs[c]);
    sst = readSst_(wb, segs);
    break;
  }
  // Première feuille de calcul (BOUNDSHEET de type feuille).
  var start = -1;
  recs.some(function (r) {
    if (r.type === 0x0085 && wb[r.pos + 5] === 0) { start = u32(r.pos); return true; }
    return false;
  });
  var rows = [];
  function put(r, col, v) { (rows[r] = rows[r] || [])[col] = v; }
  var inSheet = false, pendingFormula = null;
  for (var j = 0; j < recs.length; j++) {
    var rec = recs[j], q = rec.pos;
    if (!inSheet) { if (rec.type === 0x0809 && q - 4 === start) inSheet = true; continue; }
    if (rec.type === 0x000A) break; // fin de la feuille
    switch (rec.type) {
      case 0x00FD: put(u16(q), u16(q + 2), sst[u32(q + 6)] || ''); break; // LABELSST
      case 0x0204: case 0x00D6: put(u16(q), u16(q + 2), readXlStr_(wb, q + 6, true).s); break; // LABEL, RSTRING
      case 0x0203: put(u16(q), u16(q + 2), numStr(num(q + 6))); break; // NUMBER
      case 0x027E: put(u16(q), u16(q + 2), numStr(rk(u32(q + 6)))); break; // RK
      case 0x00BD: // MULRK
        var r0 = u16(q), c0 = u16(q + 2), n = (rec.len - 6) / 6;
        for (var m = 0; m < n; m++) put(r0, c0 + m, numStr(rk(u32(q + 4 + m * 6 + 2))));
        break;
      case 0x0205: put(u16(q), u16(q + 2), wb[q + 7] ? '' : String(wb[q + 6] ? 'VRAI' : 'FAUX')); break; // BOOLERR
      case 0x0006: // FORMULA : résultat déjà calculé
        if (u16(q + 12) === 0xFFFF) {
          if (wb[q + 6] === 0) pendingFormula = { r: u16(q), c: u16(q + 2) };
          else if (wb[q + 6] === 1) put(u16(q), u16(q + 2), wb[q + 8] ? 'VRAI' : 'FAUX');
        } else put(u16(q), u16(q + 2), numStr(num(q + 6)));
        break;
      case 0x0207: // STRING (texte d'une formule)
        if (pendingFormula) { put(pendingFormula.r, pendingFormula.c, readXlStr_(wb, q, true).s); pendingFormula = null; }
        break;
    }
  }
  var out = [];
  for (var y = 0; y < rows.length; y++) {
    var row = rows[y] || [];
    for (var x = 0; x < row.length; x++) if (row[x] === undefined) row[x] = '';
    out.push(row);
  }
  return out;
}

/** Texte BIFF8 (XLUnicodeString) : longueur sur 2 octets (ou 1), drapeaux, caractères. */
function readXlStr_(b, p, len16) {
  var cch = len16 ? (b[p] | (b[p + 1] << 8)) : b[p];
  p += len16 ? 2 : 1;
  var flags = b[p++], high = flags & 1, runs = 0, ext = 0;
  if (flags & 8) { runs = b[p] | (b[p + 1] << 8); p += 2; }
  if (flags & 4) { ext = (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16)) + b[p + 3] * 16777216; p += 4; }
  var s = '';
  for (var i = 0; i < cch; i++) {
    s += String.fromCharCode(high ? (b[p] | (b[p + 1] << 8)) : b[p]);
    p += high ? 2 : 1;
  }
  return { s: s, end: p + runs * 4 + ext };
}

/** Table SST répartie sur plusieurs enregistrements (CONTINUE) : un texte peut être coupé en deux. */
function readSst_(b, segs) {
  var si = 0, p = segs[0].pos + 8, end = segs[0].pos + segs[0].len;
  var unique = (b[segs[0].pos + 4] | (b[segs[0].pos + 5] << 8) | (b[segs[0].pos + 6] << 16)) + b[segs[0].pos + 7] * 16777216;
  function next() { si++; if (si >= segs.length) return false; p = segs[si].pos; end = p + segs[si].len; return true; }
  function byte() { if (p >= end && !next()) throw new Error('SST tronquée'); return b[p++]; }
  function skip(n) { while (n > 0) { if (p >= end && !next()) return; var k = Math.min(n, end - p); p += k; n -= k; } }
  var out = [];
  try {
    while (out.length < unique) {
      if (p >= end && !next()) break;
      var cch = byte() | (byte() << 8);
      var flags = byte(), high = flags & 1, runs = 0, ext = 0;
      if (flags & 8) runs = byte() | (byte() << 8);
      if (flags & 4) ext = (byte() | (byte() << 8) | (byte() << 16)) + byte() * 16777216;
      var s = '';
      for (var i = 0; i < cch; i++) {
        if (p >= end) { if (!next()) break; high = b[p++] & 1; } // nouveau segment : drapeau répété
        if (high) { var lo = b[p++]; s += String.fromCharCode(lo | (b[p++] << 8)); } else s += String.fromCharCode(b[p++]);
      }
      skip(runs * 4 + ext);
      out.push(s);
    }
  } catch (e) { /* table incomplète : on garde ce qui a été lu */ }
  return out;
}

/** Fichier composé OLE (CFB) → contenu du premier flux portant l'un des noms donnés. */
function cfbStream_(b, names) {
  function u16(p) { return b[p] | (b[p + 1] << 8); }
  function u32(p) { return (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16)) + b[p + 3] * 16777216; }
  var ssz = 1 << u16(30), mssz = 1 << u16(32);
  var cutoff = u32(56), miniFatStart = u32(60), dirStart = u32(48);
  var END = 0xFFFFFFFE;
  function sec(n) { return (n + 1) * ssz; }
  // Table d'allocation (FAT), via la DIFAT de l'en-tête puis ses secteurs d'extension.
  var fatSecs = [];
  for (var i = 0; i < 109; i++) { var s = u32(76 + i * 4); if (s < 0xFFFFFFFA) fatSecs.push(s); }
  var dif = u32(68), guard = 0;
  while (dif < 0xFFFFFFFA && guard++ < 1000) {
    for (var d = 0; d < ssz / 4 - 1; d++) { var s2 = u32(sec(dif) + d * 4); if (s2 < 0xFFFFFFFA) fatSecs.push(s2); }
    dif = u32(sec(dif) + ssz - 4);
  }
  var fat = [];
  fatSecs.forEach(function (fs) { for (var e = 0; e < ssz / 4; e++) fat.push(u32(sec(fs) + e * 4)); });
  function chain(start) {
    var out = [], n = start, g = 0;
    while (n !== END && n < fat.length && g++ < 1000000) { out.push(n); n = fat[n]; }
    return out;
  }
  function readChain(start, size) {
    var out = [];
    chain(start).forEach(function (n) { var o = sec(n); for (var k = 0; k < ssz; k++) out.push(b[o + k]); });
    return size === undefined ? out : out.slice(0, size);
  }
  var dir = readChain(dirStart);
  var entries = [];
  for (var off = 0; off + 128 <= dir.length; off += 128) {
    var nl = dir[off + 64] | (dir[off + 65] << 8), name = '';
    for (var c = 0; c + 1 < nl - 1; c += 2) name += String.fromCharCode(dir[off + c] | (dir[off + c + 1] << 8));
    entries.push({ name: name, type: dir[off + 66],
      start: (dir[off + 116] | (dir[off + 117] << 8) | (dir[off + 118] << 16)) + dir[off + 119] * 16777216,
      size: (dir[off + 120] | (dir[off + 121] << 8) | (dir[off + 122] << 16)) + dir[off + 123] * 16777216 });
  }
  var root = entries[0];
  var target = null;
  names.some(function (n) { target = entries.filter(function (e) { return e.type === 2 && e.name === n; })[0]; return !!target; });
  if (!target || !root) return null;
  if (target.size >= cutoff) return readChain(target.start, target.size);
  // Petit flux : dans le « mini-flux » (secteurs de 64 octets).
  var ministream = readChain(root.start, root.size);
  var minifat = [];
  var mf = readChain(miniFatStart);
  for (var q = 0; q + 3 < mf.length; q += 4) minifat.push((mf[q] | (mf[q + 1] << 8) | (mf[q + 2] << 16)) + mf[q + 3] * 16777216);
  var out = [], m = target.start, gm = 0;
  while (m !== END && m < minifat.length && gm++ < 1000000) {
    for (var z = 0; z < mssz; z++) out.push(ministream[m * mssz + z]);
    m = minifat[m];
  }
  return out.slice(0, target.size);
}

function colIndex_(letters) {
  var n = 0;
  for (var i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
  return n - 1;
}

function xmlText_(s) {
  var out = '';
  String(s).replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').replace(/<t\b[^>]*>([\s\S]*?)<\/t>/g, function (_, t) { out += t; return ''; });
  return xmlDecode_(out);
}

function xmlDecode_(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, function (_, e) {
    var k = e.toLowerCase();
    if (k.charAt(0) === '#') return String.fromCharCode(k.charAt(1) === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[k];
  });
}

/** Page HTML enregistrée en .xls (tableau) → lignes. */
function htmlTableRows_(html) {
  var rows = [];
  String(html).replace(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi, function (_, tr) {
    var row = [];
    tr.replace(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi, function (__, td) {
      row.push(xmlDecode_(td.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim());
      return '';
    });
    rows.push(row);
    return '';
  });
  return rows;
}

function normCol_(s) {
  return stripAccents_(xmlDecode_(String(s || '')).toLowerCase()).replace(/%/g, ' pct ').replace(/[^a-z0-9]+/g, ' ').trim();
}

function mapExportHeader_(row) {
  var norm = (row || []).map(normCol_);
  var map = {};
  Object.keys(BOOKING_EXPORT_COLS).forEach(function (k) {
    var names = BOOKING_EXPORT_COLS[k];
    for (var a = 0; a < names.length; a++) {
      var i = norm.indexOf(names[a]);
      if (i >= 0) { map[k] = i; return; }
    }
  });
  return map;
}

/**
 * Lignes du fichier → réservations lues. Erreurs ligne par ligne, sans bloquer le reste.
 * Lève une erreur claire si le fichier n'est pas un export des réservations Booking.
 */
function parseBookingExport_(table) {
  var hi = -1, map = null;
  for (var i = 0; i < Math.min(table.length, 15); i++) {
    var m = mapExportHeader_(table[i]);
    if (m.number !== undefined && (m.checkin !== undefined || m.price !== undefined)) { hi = i; map = m; break; }
  }
  if (hi < 0) {
    var seen = (table[0] || []).filter(function (x) { return String(x).trim(); }).slice(0, 10).join(', ');
    throw new Error('Ce fichier n\'est pas un export des réservations Booking : colonne « Numéro de réservation » introuvable' +
      (seen ? ' (colonnes lues : ' + seen + ')' : '') + '.');
  }
  function cell(row, k) { return map[k] === undefined ? '' : String(row[map[k]] === undefined || row[map[k]] === null ? '' : row[map[k]]).trim(); }
  var data = table.slice(hi + 1);
  // Dates « 10/02/2026 » : jour/mois (Europe) sauf si une date du fichier n'a de sens qu'en mois/jour.
  var us = data.some(function (row) {
    return ['checkin', 'checkout'].some(function (k) {
      var d = cell(row, k).match(/^(\d{1,2})\/(\d{1,2})\/\d{4}/);
      return d && Number(d[2]) > 12 && Number(d[1]) <= 12;
    });
  });
  var records = [], errors = [], done = {};
  data.forEach(function (row, n) {
    var line = hi + n + 2;
    if (!row.join('').trim()) return;
    var rawNum = cell(row, 'number');
    var num = /^\d(\.\d+)?e\+?\d+$/i.test(rawNum) ? Number(rawNum).toFixed(0) : rawNum.replace(/\.0+$/, '').replace(/[\s.]/g, '');
    if (!/^\d{6,14}$/.test(num)) {
      if (cell(row, 'checkin') || cell(row, 'price')) errors.push('ligne ' + line + ' : numéro de réservation illisible « ' + rawNum + ' »');
      return; // ligne de total ou vide
    }
    if (done[num]) { errors.push('ligne ' + line + ' : réservation ' + num + ' en double, ignorée'); return; }
    var ci = parseExportDate_(cell(row, 'checkin'), us);
    var co = parseExportDate_(cell(row, 'checkout'), us);
    if (!ci) { errors.push('ligne ' + line + ' (' + num + ') : date d\'arrivée illisible « ' + cell(row, 'checkin') + ' »'); return; }
    if (cell(row, 'checkout') && !co) errors.push('ligne ' + line + ' (' + num + ') : date de départ illisible « ' + cell(row, 'checkout') + ' »');
    if (co && co <= ci) co = '';
    var rawPrice = cell(row, 'price');
    var price = exportAmount_(rawPrice);
    if (rawPrice && price === null) { errors.push('ligne ' + line + ' (' + num + ') : prix illisible « ' + rawPrice + ' »'); return; }
    var adults = exportInt_(cell(row, 'adults')), children = exportInt_(cell(row, 'children')), people = exportInt_(cell(row, 'people'));
    if (!people && adults) people = adults + (children || 0);
    var guestsText = adults ? adults + ' adulte' + (adults > 1 ? 's' : '') + (children ? ', ' + children + ' enfant' + (children > 1 ? 's' : '') : '')
      : people ? people + ' voyageur' + (people > 1 ? 's' : '') : '';
    done[num] = true;
    records.push({
      line: line,
      number: num,
      guest: cleanGuestName_(cell(row, 'guest') || cell(row, 'booker')),
      checkin: ci,
      checkout: co,
      cancelled: /annul|cancel/i.test(cell(row, 'status')) || !!cell(row, 'cancelledOn'),
      price: price,
      commission: exportAmount_(cell(row, 'commission')),
      commissionPct: exportAmount_(cell(row, 'commissionPct')),
      people: people ? String(people) : '',
      guestsText: guestsText,
      country: countryName_(cell(row, 'country')),
      phone: cell(row, 'phone').replace(/^'/, '').slice(0, 40)
    });
  });
  return { records: records, errors: errors };
}

/** Montant d'un export, sans arrondi (« 113.5260 EUR » : 4 décimales pour les commissions Booking). */
function exportAmount_(v) {
  var s = String(v || '').replace(/%/g, '').replace(/\b[A-Z]{3}\b/g, '').replace(/[\s  €]/g, '');
  if (!s) return null;
  if (/^-?\d+\.\d+$/.test(s)) return Number(s);
  if (/^-?\d+,\d+$/.test(s) && !/^-?\d{1,3},\d{3}$/.test(s)) return Number(s.replace(',', '.'));
  return parseAmount_(s);
}

function exportInt_(v) {
  var n = parseInt(String(v || '').replace(/\D+$/, ''), 10);
  return isNaN(n) || n < 0 ? 0 : n;
}

/** « Dupont, Jean » → « Jean Dupont » ; plusieurs voyageurs : le premier. */
function cleanGuestName_(v) {
  var s = String(v || '').split(/\s*[;\n|]\s*/)[0].replace(/\s+/g, ' ').trim();
  var m = s.match(/^([^,]+),\s*([^,]+)$/);
  if (m) s = m[2] + ' ' + m[1];
  return s.slice(0, 120);
}

/** Date d'un export : 2026-10-01, 01/10/2026, 1 oct. 2026, Oct 1, 2026 ou numéro de série Excel. */
function parseExportDate_(v, us) {
  var s = String(v === undefined || v === null ? '' : v).trim();
  if (!s) return '';
  var m;
  function ok(y, mo, d) { return y >= 2000 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth_(y, mo) ? ymd_(y, mo, d) : ''; }
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return ok(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/))) return us ? ok(+m[3], +m[1], +m[2]) : ok(+m[3], +m[2], +m[1]);
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    var d = new Date(Math.round((Number(s) - 25569) * 86400000));
    return ok(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  if ((m = s.match(/(\d{1,2})\s+([A-Za-zÀ-ÿ]+)\.?,?\s+(\d{4})/)) && monthNum_(m[2])) return ok(+m[3], monthNum_(m[2]), +m[1]);
  if ((m = s.match(/([A-Za-zÀ-ÿ]+)\.?\s+(\d{1,2}),?\s+(\d{4})/)) && monthNum_(m[1])) return ok(+m[3], monthNum_(m[1]), +m[2]);
  return '';
}

var COUNTRIES_FR_ = {
  fr: 'France', il: 'Israël', be: 'Belgique', ch: 'Suisse', lu: 'Luxembourg', mc: 'Monaco', de: 'Allemagne', at: 'Autriche',
  nl: 'Pays-Bas', gb: 'Royaume-Uni', uk: 'Royaume-Uni', ie: 'Irlande', es: 'Espagne', pt: 'Portugal', it: 'Italie', gr: 'Grèce',
  pl: 'Pologne', cz: 'Tchéquie', sk: 'Slovaquie', hu: 'Hongrie', ro: 'Roumanie', bg: 'Bulgarie', hr: 'Croatie', si: 'Slovénie',
  rs: 'Serbie', ua: 'Ukraine', ru: 'Russie', se: 'Suède', no: 'Norvège', dk: 'Danemark', fi: 'Finlande', is: 'Islande',
  ee: 'Estonie', lv: 'Lettonie', lt: 'Lituanie', mt: 'Malte', cy: 'Chypre', tr: 'Turquie', us: 'États-Unis', ca: 'Canada',
  mx: 'Mexique', br: 'Brésil', ar: 'Argentine', cl: 'Chili', co: 'Colombie', au: 'Australie', nz: 'Nouvelle-Zélande',
  ma: 'Maroc', dz: 'Algérie', tn: 'Tunisie', eg: 'Égypte', za: 'Afrique du Sud', sn: 'Sénégal', ci: 'Côte d\'Ivoire',
  cn: 'Chine', jp: 'Japon', kr: 'Corée du Sud', in: 'Inde', sg: 'Singapour', th: 'Thaïlande', ae: 'Émirats arabes unis',
  sa: 'Arabie saoudite', qa: 'Qatar', lb: 'Liban', jo: 'Jordanie'
};

function countryName_(v) {
  var s = String(v || '').trim();
  if (/^[A-Za-z]{2}$/.test(s)) return COUNTRIES_FR_[s.toLowerCase()] || s.toUpperCase();
  return s.slice(0, 80);
}

function fmtEur_(n) {
  var parts = (Math.round(Number(n) * 100) / 100).toFixed(2).split('.');
  return parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ',' + parts[1] + ' €';
}

/**
 * Montant net de chaque réservation de l'export : prix − commission (lue dans l'export)
 * − frais de paiement. Frais : ceux de la facture du mois de départ, répartis au centime
 * au prorata des prix quand les ventes de l'export égalent celles de la facture ;
 * sinon taux réel de la facture du mois (ou de toutes les factures).
 */
function bookingExportAmounts_(records, invoices) {
  var inv = {}, all = { sales: 0, commission: 0, fees: 0 };
  invoices.forEach(function (i) {
    var ym = String(i.periodEnd).slice(0, 7);
    var o = inv[ym] || (inv[ym] = { sales: 0, commission: 0, fees: 0 });
    o.sales += Number(i.sales) || 0; o.commission += Number(i.commission) || 0; o.fees += Number(i.paymentFees) || 0;
    all.sales += Number(i.sales) || 0; all.commission += Number(i.commission) || 0; all.fees += Number(i.paymentFees) || 0;
  });
  var amounts = {}, warnings = [], groups = {};
  var noCommission = 0;
  records.forEach(function (x) {
    if (!(x.price > 0)) return;
    // Annulée : le relevé garde le tarif d'origine ; seule une commission facturée (montant > 0)
    // prouve que le client a payé quelque chose (vérifié sur le vrai relevé : 50 annulations sur 51 sans commission).
    if (x.cancelled && !(x.commission > 0)) return;
    var c = x.commission !== null ? x.commission : x.commissionPct !== null ? x.price * x.commissionPct / 100 : null;
    amounts[x.number] = { gross: x.price, commission: c, net: 0 };
    var ym = (x.checkout || x.checkin).slice(0, 7);
    (groups[ym] = groups[ym] || []).push(x);
  });
  var checks = [];
  Object.keys(groups).sort().forEach(function (ym) {
    var list = groups[ym], i = inv[ym];
    var sales = 0;
    list.forEach(function (x) { sales += x.price; });
    sales = round2_(sales);
    list.forEach(function (x) {
      var a = amounts[x.number];
      if (a.commission === null) {
        noCommission++;
        a.commission = (x.price * (i && i.sales ? i.commission / i.sales : all.sales ? all.commission / all.sales : BOOKING_FALLBACK_PCT / 100));
      }
    });
    if (i && Math.abs(sales - i.sales) < 0.05) {
      // Mêmes ventes que la facture : sa commission + ses frais répartis au centime (au prorata
      // de la commission de chaque séjour + sa part des frais), donc total du mois = facture.
      var total = Math.round((i.commission + i.fees) * 100), given = 0, rawSum = 0;
      var parts = list.map(function (x) {
        var raw = amounts[x.number].commission + x.price * i.fees / i.sales;
        rawSum += raw;
        return { x: x, raw: raw };
      });
      parts.forEach(function (p) {
        var exact = rawSum > 0 ? total * p.raw / rawSum : 0;
        p.cents = Math.floor(exact + 1e-9); p.rest = exact - p.cents; given += p.cents;
      });
      parts.slice().sort(function (a, b) { return b.rest - a.rest; }).slice(0, Math.max(0, total - given)).forEach(function (p) { p.cents++; });
      parts.forEach(function (p) { var a = amounts[p.x.number]; a.net = round2_(a.gross - p.cents / 100); });
    } else {
      var rate = i && i.sales ? i.fees / i.sales : all.sales ? all.fees / all.sales : 0;
      list.forEach(function (x) { var a = amounts[x.number]; a.net = round2_(a.gross - a.commission - x.price * rate); });
      if (!i && !all.sales) warnings.push('aucune facture Booking lue : frais de paiement non déduits pour ' + monthLabel_(ym));
    }
    var net = 0;
    list.forEach(function (x) { net += amounts[x.number].net; });
    if (i) {
      var invNet = round2_(i.sales - i.commission - i.fees);
      checks.push({ ym: ym, label: monthLabel_(ym), exportNet: round2_(net), invoiceNet: invNet, match: Math.abs(round2_(net) - invNet) < 0.05 });
    }
  });
  if (noCommission) warnings.push(noCommission + ' réservation(s) sans commission dans le fichier : taux réel des factures appliqué');
  return { amounts: amounts, checks: checks, warnings: warnings };
}

function monthLabel_(ym) {
  var names = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  return names[Number(ym.slice(5, 7)) - 1] + ' ' + ym.slice(0, 4);
}

/**
 * Applique les réservations lues aux lignes existantes (rapprochement par numéro).
 * Jamais de doublon (clé booking:<numéro>), jamais d'écrasement d'un champ modifié à la main.
 */
function applyBookingExport_(records, rows, invoices, now) {
  var ctx = { rows: rows, byKey: indexBy_(rows, 'key'), now: now, counts: { added: 0, updated: 0, cancelled: 0 } };
  var calc = bookingExportAmounts_(records, invoices);
  var s = { added: 0, updated: 0, cancelled: 0, unchanged: 0, kept: 0, errors: [], warnings: calc.warnings, checks: calc.checks };
  records.forEach(function (x) {
    var key = 'booking:' + x.number;
    var r = ctx.byKey[key];
    var before = r ? JSON.stringify(r) : '';
    var wasCancelled = r && r.status === 'cancelled';
    var locked = r ? lockedSet_(r) : {};
    var a = calc.amounts[x.number];
    var fields = { code: x.number, guest: x.guest, checkin: x.checkin, checkout: x.checkout, phone: x.phone, location: x.country, guestsCount: x.people };
    if (a) {
      fields.amountGross = String(a.gross);
      fields.amountNet = String(a.net);
      fields.commission = String(round2_(a.gross - a.net)); // commission + frais de paiement
      if (x.cancelled) fields.keepRevenue = '1'; // annulée mais facturée au client
    }
    var status = x.cancelled ? 'cancelled' : 'confirmed';
    Object.keys(fields).concat(['status']).forEach(function (f) {
      var v = f === 'status' ? status : fields[f];
      if (r && locked[f] && v !== '' && String(r[f]) !== String(v)) s.kept++;
    });
    r = upsert_(ctx, key, { source: 'booking', origin: 'export', status: status }, fields, { guestsText: x.guestsText });
    if (!lockedSet_(r).status) {
      if (r.status !== status) { r.status = status; r.updatedAt = now; }
      if (r.autoStatus) { r.autoStatus = ''; r.updatedAt = now; }
    }
    // Annulée sans frais : ne compte pas dans les revenus (corrige aussi un import précédent).
    if (x.cancelled && !a && r.keepRevenue === '1' && !lockedSet_(r).keepRevenue) { r.keepRevenue = ''; r.updatedAt = now; }
    // Dates fermées vues dans le calendrier Booking pour ce séjour : rattachées à la réservation.
    var ph = ctx.byKey['booking-ical:' + r.checkin + '_' + r.checkout];
    if (ph && ph !== r && !ph.mergedInto) { mergePlaceholder_(r, ph); r.updatedAt = now; }
    if (!before) s.added++;
    else if (JSON.stringify(r) === before) s.unchanged++;
    else if (!wasCancelled && r.status === 'cancelled') s.cancelled++;
    else s.updated++;
  });
  var kept = ctx.rows.filter(function (r) { return !r.mergedInto; });
  return { rows: kept, summary: s };
}

// =====================================================================
// Revenus (seule source de vérité du calcul)
// =====================================================================

/** Réservation qui occupe le logement (ni annulée, ni simple fermeture de dates, ni masquée). */
function isActive_(r) {
  return r.status !== 'cancelled' && r.status !== 'blocked' && r.hidden !== '1';
}

/**
 * Revenus de la gestionnaire : forfait (managerFee) à chaque départ, car elle fait le ménage au départ
 * du client. Par mois du départ : nombre de départs, total, déjà perçu (départ passé, ou aujourd'hui
 * après l'heure de départ) et à venir. Mois sans départ : absent (0 € à l'écran).
 * Une réservation annulée ou masquée ne compte pas (pas de ménage).
 */
function managerPay_(rows, s, today, nowTime, from) {
  var fee = Number(s.managerFee) || 0;
  if (fee <= 0) return null;
  var fromYm = String(from || today).slice(0, 7);
  var months = {};
  rows.forEach(function (r) {
    if (!isActive_(r) || !isYmd_(r.checkin)) return;
    var d = isYmd_(r.checkout) ? r.checkout : r.checkin;
    var ym = d.slice(0, 7);
    if (ym < fromYm) return;
    var m = months[ym] || (months[ym] = { count: 0, paidCount: 0 });
    m.count++;
    if (d < today || (d === today && String(nowTime || '') >= String(s.checkoutTime || '10:00'))) m.paidCount++;
  });
  // Liste triée (et non objet indexé par mois) : c'est ce format qui passe sans perte jusqu'à la page.
  var list = Object.keys(months).sort().map(function (k) {
    var m = months[k];
    return { ym: k, count: m.count, paidCount: m.paidCount, amount: round2_(m.count * fee), paid: round2_(m.paidCount * fee), toCome: round2_((m.count - m.paidCount) * fee) };
  });
  return { fee: fee, months: list };
}

/**
 * Jours fermés du calendrier, en plages de nuits [start, end[ :
 *  - « unbookable » (gris clair) : trou entre deux indisponibilités plus court que la durée minimale,
 *    ou court blocage collé à un séjour (temps de préparation, trou fermé par la plateforme) ;
 *  - « manual » (gris foncé) : les autres dates fermées sur Airbnb/Booking, et les blocages saisis dans l'outil.
 * Seule source de vérité des gris : le propriétaire et la gestionnaire voient le même calendrier.
 */
function closuresFor_(rows, minNights) {
  var min = Math.max(1, Math.round(Number(minNights) || 1));
  var kind = {}; // nuit → 'stay' | 'block' | 'blockTool'
  var lo = '', hi = '';
  function mark(r, k) {
    var end = r.checkout && r.checkout > r.checkin ? r.checkout : addDays_(r.checkin, 1);
    for (var d = r.checkin; d < end; d = addDays_(d, 1)) {
      if (k === 'stay' || !kind[d] || (kind[d] === 'block' && k === 'blockTool')) kind[d] = k;
    }
    if (!lo || r.checkin < lo) lo = r.checkin;
    if (!hi || end > hi) hi = end;
  }
  rows.forEach(function (r) {
    if (r.hidden === '1' || !isYmd_(r.checkin) || (r.checkout && !isYmd_(r.checkout))) return;
    if (isActive_(r)) mark(r, 'stay');
    else if (r.status === 'blocked') mark(r, r.origin === 'manual' ? 'blockTool' : 'block');
  });
  if (!lo) return [];
  var nights = [];
  for (var d = lo; d < hi; d = addDays_(d, 1)) nights.push({ d: d, k: kind[d] || 'free' });
  var out = new Array(nights.length);
  // Découpe en suites de nuits de même nature, puis classe chaque suite.
  var runs = [];
  nights.forEach(function (n, i) {
    var g = n.k === 'blockTool' ? 'block' : n.k;
    var last = runs[runs.length - 1];
    if (last && last.g === g) last.to = i; else runs.push({ g: g, from: i, to: i });
  });
  runs.forEach(function (run, ri) {
    var len = run.to - run.from + 1;
    var prev = runs[ri - 1], next = runs[ri + 1];
    var k = null;
    if (run.g === 'free') {
      if (prev && next && len < min) k = 'unbookable';
    } else if (run.g === 'block') {
      var touchesStay = (prev && prev.g === 'stay') || (next && next.g === 'stay');
      k = touchesStay && len < min ? 'unbookable' : 'manual';
    }
    for (var i = run.from; i <= run.to; i++) {
      out[i] = run.g === 'block' && nights[i].k === 'blockTool' ? 'manual' : k;
    }
  });
  var res = [];
  nights.forEach(function (n, i) {
    var k = out[i];
    var last = res[res.length - 1];
    if (!k) return;
    if (last && last.kind === k && last.end === n.d) last.end = addDays_(n.d, 1);
    else res.push({ start: n.d, end: addDays_(n.d, 1), kind: k });
  });
  return res;
}

/** Taux Booking appliqué au prix client : réglage, sinon taux réel des factures, sinon 17 %. */
function bookingRate_(settings, invoices) {
  if (settings.bookingCommissionPct !== '' && settings.bookingCommissionPct !== null && settings.bookingCommissionPct !== undefined) {
    return { pct: Number(settings.bookingCommissionPct), source: 'réglage' };
  }
  var sales = 0, fees = 0;
  invoices.forEach(function (i) { sales += Number(i.sales) || 0; fees += (Number(i.commission) || 0) + (Number(i.paymentFees) || 0); });
  if (sales > 0) return { pct: round2_(fees / sales * 100), source: 'factures' };
  return { pct: BOOKING_FALLBACK_PCT, source: 'défaut' };
}

/** Montant net saisi ou lu (exact), ou null s'il manque. */
function netAmount_(r, ratePct) {
  if (r.status === 'cancelled' && r.keepRevenue !== '1') return 0;
  if (r.amountNet !== '' && r.amountNet !== undefined && r.amountNet !== null) return Number(r.amountNet);
  if (r.amountGross !== '' && r.amountGross !== undefined && r.amountGross !== null) {
    var gross = Number(r.amountGross);
    if (r.source === 'booking') return round2_(gross * (1 - ratePct / 100));
    return gross;
  }
  return null;
}

/** Commission connue (positive) : lue (export Booking, e-mail Airbnb) ou déduite du prix client Booking ; null sinon. */
function commissionAmount_(r, net, ratePct) {
  if (net === null || (r.status === 'cancelled' && r.keepRevenue !== '1')) return null;
  if (r.commission !== '' && r.commission !== undefined && r.commission !== null) return Number(r.commission);
  if (r.source === 'booking' && r.amountGross !== '' && r.amountGross !== undefined && r.amountGross !== null) return round2_(Number(r.amountGross) - net);
  return null;
}

/** Mois comptable Booking : celui du départ (comme sur les factures Booking). */
function bookingMonth_(r) {
  return (r.checkout || r.checkin || '').slice(0, 7);
}

/**
 * Montants de chaque réservation, seule source de vérité du calcul :
 *  - exact : e-mail Airbnb ou saisie ;
 *  - facture : Booking sans montant saisi, le net réel du mois (facture) est
 *    réparti entre les séjours Booking partis ce mois-là, au prorata des nuits ;
 *  - estimé : Booking d'un mois pas encore facturé, net moyen par nuit des factures.
 */
function revenueModel_(rawRows, invoices, settings) {
  var rate = bookingRate_(settings, invoices);
  var rows = rawRows.map(function (r) {
    var o = {};
    RES_COLS.forEach(function (c) { o[c] = r[c]; });
    o.nights = nightsBetween_(r.checkin, r.checkout);
    o.counted = r.hidden !== '1' && (r.status === 'cancelled' ? r.keepRevenue === '1' : r.status !== 'blocked');
    o.net = netAmount_(r, rate.pct);
    o.amountKind = o.net === null ? '' : 'exact';
    o.lockedFields = r.locked ? r.locked.split(',') : [];
    o.commissionAmt = commissionAmount_(r, o.net, rate.pct);
    return o;
  });
  var byMonth = {};
  invoices.forEach(function (i) {
    var ym = String(i.periodEnd).slice(0, 7);
    var m = byMonth[ym] || (byMonth[ym] = { net: 0 });
    m.net += (Number(i.sales) || 0) - (Number(i.commission) || 0) - (Number(i.paymentFees) || 0);
  });
  var unallocated = {};
  var allocNet = 0, allocNights = 0, allocNetAll = 0, allocCount = 0;
  Object.keys(byMonth).forEach(function (ym) {
    var list = rows.filter(function (r) { return r.source === 'booking' && r.counted && isYmd_(r.checkin) && bookingMonth_(r) === ym; });
    var known = 0;
    list.forEach(function (r) { if (r.net !== null) known += r.net; });
    var rest = list.filter(function (r) { return r.net === null; });
    var remaining = round2_(byMonth[ym].net - known);
    if (rest.length && remaining > 0) {
      var weight = 0;
      rest.forEach(function (r) { weight += Math.max(1, r.nights); });
      rest.forEach(function (r) {
        r.net = round2_(remaining * Math.max(1, r.nights) / weight);
        r.amountKind = 'facture';
        allocNetAll += r.net;
        allocCount++;
        if (r.nights) { allocNet += r.net; allocNights += r.nights; }
      });
    } else if (remaining > 0.5) {
      unallocated[ym] = remaining; // ventes facturées sans réservation identifiée
    }
  });
  // Estimation des séjours Booking pas encore facturés : net moyen par nuit des séjours Booking au
  // montant exact (import de l'export) sur les 12 derniers mois ; à défaut, celui des parts de facture.
  var yearAgo = addDays_(todayYmd_(), -365), exNet = 0, exNights = 0, exStays = 0, exAll = 0;
  rows.forEach(function (r) {
    if (r.source !== 'booking' || !r.counted || r.amountKind !== 'exact' || !r.net || r.status === 'cancelled') return;
    if ((r.checkout || r.checkin) < yearAgo) return;
    exAll += r.net; exStays++;
    if (r.nights) { exNet += r.net; exNights += r.nights; }
  });
  var perNight = exNights >= 10 ? exNet / exNights : allocNights ? allocNet / allocNights : 0;
  // Séjours sans date de départ connue (Booking passé) : moyenne par séjour.
  var perStay = exStays >= 5 ? exAll / exStays : allocCount ? allocNetAll / allocCount : 0;
  rows.forEach(function (r) {
    if (r.source === 'booking' && r.counted && r.net === null && !byMonth[bookingMonth_(r)]) {
      var est = r.nights && perNight ? perNight * r.nights : perStay;
      if (est) { r.net = round2_(est); r.amountKind = 'estimé'; }
    }
    r.missingAmount = r.counted && r.net === null;
  });
  return { rows: rows, unallocated: unallocated, ratePct: rate.pct, rateSource: rate.source, perNight: round2_(perNight) };
}

/**
 * Revenus par année et par mois. Le montant d'un séjour est réparti nuit par
 * nuit sur les mois concernés ; un séjour sans date de départ compte sur son
 * mois d'arrivée. Chaque mois liste ses paiements (items : séjour, nuits du mois,
 * net et commission de ces nuits) ; brut et commissions connus par plateforme.
 */
function computeStats_(rows, unallocated) {
  var years = {};
  function bucket(y) {
    if (!years[y]) {
      years[y] = { months: [], total: { revenue: 0, estimated: 0, nights: 0, bookings: 0, missing: 0, bySource: {}, commissionBySource: {}, grossKnownBySource: {}, revenueWithNights: 0, staysWithoutNights: 0 } };
      for (var i = 0; i < 12; i++) years[y].months.push({ revenue: 0, estimated: 0, commission: 0, nights: 0, bookings: 0, missing: 0, days: daysInMonth_(Number(y), i + 1), items: [] });
    }
    return years[y];
  }
  Object.keys(unallocated || {}).forEach(function (ym) {
    var b = bucket(ym.slice(0, 4)), mi = Number(ym.slice(5, 7)) - 1;
    addRev_(b, mi, unallocated[ym], 'booking', false);
    b.months[mi].items.push({ id: '', source: 'booking', nights: 0, net: round2_(unallocated[ym]), commission: null, kind: 'facture' });
  });
  rows.forEach(function (r) {
    if (!r.counted || !isYmd_(r.checkin)) return;
    var net = r.net;
    var com = r.commissionAmt;
    var y0 = r.checkin.slice(0, 4);
    var m0 = Number(r.checkin.slice(5, 7)) - 1;
    var b0 = bucket(y0);
    b0.months[m0].bookings++;
    b0.total.bookings++;
    if (net === null) { b0.months[m0].missing++; b0.total.missing++; }
    var n = r.nights;
    var est = r.amountKind === 'estimé';
    var parts = {}; // « année-mois » → nuits du séjour dans ce mois
    if (!n) {
      b0.total.staysWithoutNights++;
      parts[y0 + '-' + m0] = 0;
    } else {
      for (var i = 0; i < n; i++) {
        var d = addDays_(r.checkin, i);
        var k = d.slice(0, 4) + '-' + (Number(d.slice(5, 7)) - 1);
        parts[k] = (parts[k] || 0) + 1;
      }
    }
    Object.keys(parts).forEach(function (k) {
      var y = k.split('-')[0], mi = Number(k.split('-')[1]), b = bucket(y), nn = parts[k];
      var share = n ? nn / n : 1;
      b.months[mi].nights += nn;
      b.total.nights += nn;
      var amount = net === null ? null : net * share;
      var c = com === null || com === undefined ? null : com * share;
      if (amount) {
        addRev_(b, mi, amount, r.source, est);
        if (n) b.total.revenueWithNights += amount;
        if (c !== null) {
          b.months[mi].commission += c;
          b.total.commissionBySource[r.source] = (b.total.commissionBySource[r.source] || 0) + c;
          b.total.grossKnownBySource[r.source] = (b.total.grossKnownBySource[r.source] || 0) + amount + c;
        }
      }
      b.months[mi].items.push({ id: r.id, source: r.source, nights: nn, net: amount === null ? null : round2_(amount), commission: c === null ? null : round2_(c), kind: r.amountKind });
    });
  });
  Object.keys(years).forEach(function (y) {
    var t = years[y].total;
    t.revenue = round2_(t.revenue);
    t.estimated = round2_(t.estimated);
    t.revenueWithNights = round2_(t.revenueWithNights);
    ['bySource', 'commissionBySource', 'grossKnownBySource'].forEach(function (g) { Object.keys(t[g]).forEach(function (k) { t[g][k] = round2_(t[g][k]); }); });
    years[y].months.forEach(function (m) { m.revenue = round2_(m.revenue); m.estimated = round2_(m.estimated); m.commission = round2_(m.commission); });
    t.days = (Number(y) % 4 === 0 && (Number(y) % 100 !== 0 || Number(y) % 400 === 0)) ? 366 : 365;
  });
  return years;
}

function addRev_(b, mi, amount, source, estimated) {
  b.months[mi].revenue += amount;
  b.total.revenue += amount;
  if (estimated) { b.months[mi].estimated += amount; b.total.estimated += amount; }
  b.total.bySource[source] = (b.total.bySource[source] || 0) + amount;
}

/** Deux réservations actives qui se chevauchent = risque de double réservation. */
function findOverlaps_(rows) {
  var act = rows.filter(function (r) { return isActive_(r) && isYmd_(r.checkin) && isYmd_(r.checkout); })
    .sort(function (a, b) { return a.checkin.localeCompare(b.checkin); });
  var out = [];
  for (var i = 0; i < act.length; i++) {
    for (var j = i + 1; j < act.length && act[j].checkin < act[i].checkout; j++) {
      out.push([act[i].id, act[j].id]);
    }
  }
  return out;
}

// =====================================================================
// Stockage (Google Sheet)
// =====================================================================

function db_() {
  var id = PropertiesService.getScriptProperties().getProperty('sheetId');
  if (!id) throw new Error('Base de données absente : relance l\'installation.');
  var ss;
  try { ss = SpreadsheetApp.openById(id); } catch (e) {
    throw new Error('Le Google Sheet des données est introuvable (supprimé ?).');
  }
  return ss;
}

function ensureSheets_(ss) {
  [[SHEET_RES, RES_COLS], [SHEET_NOTES, NOTE_COLS], [SHEET_LOG, LOG_COLS], [SHEET_EMAILS, ['id']], [SHEET_INVOICES, INVOICE_COLS]].forEach(function (d) {
    sheet_(ss, d[0], d[1]);
  });
  var first = ss.getSheetByName('Sheet1') || ss.getSheetByName('Feuille 1') || ss.getSheetByName('Feuille1');
  if (first && ss.getSheets().length > 1) ss.deleteSheet(first);
}

function sheet_(ss, name, cols) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, cols.length).setNumberFormat('@').setValues([cols]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function readRows_(name, cols) {
  var sh = sheet_(db_(), name, cols);
  var values = sh.getDataRange().getDisplayValues();
  if (values.length < 2) return [];
  var header = values[0];
  return values.slice(1).filter(function (row) { return row.join('') !== ''; }).map(function (row) {
    var o = {};
    cols.forEach(function (c) {
      var i = header.indexOf(c);
      o[c] = i >= 0 ? row[i] : '';
    });
    return o;
  });
}

function writeRows_(name, cols, rows) {
  var sh = sheet_(db_(), name, cols);
  var data = [cols].concat(rows.map(function (r) {
    return cols.map(function (c) { return r[c] === undefined || r[c] === null ? '' : String(r[c]); });
  }));
  sh.clearContents();
  sh.getRange(1, 1, data.length, cols.length).setNumberFormat('@').setValues(data);
}

function appendRows_(name, cols, rows) {
  if (!rows.length) return;
  var sh = sheet_(db_(), name, cols);
  var start = sh.getLastRow() + 1;
  sh.getRange(start, 1, rows.length, cols.length).setNumberFormat('@').setValues(rows.map(function (r) {
    return cols.map(function (c) { return r[c] === undefined ? '' : String(r[c]); });
  }));
}

function appendLog_(kind, ok, message) {
  appendRows_(SHEET_LOG, LOG_COLS, [{ at: nowIso_(), kind: kind, ok: ok ? '1' : '', message: message }]);
  var rows = readRows_(SHEET_LOG, LOG_COLS);
  if (rows.length > 300) writeRows_(SHEET_LOG, LOG_COLS, rows.slice(-200));
}

// =====================================================================
// Outils
// =====================================================================

function roleFor_(token) {
  if (!token) return '';
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('installed')) return '';
  if (token === props.getProperty('ownerToken')) return 'owner';
  if (token === props.getProperty('managerToken')) return 'manager';
  return '';
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Une autre opération est en cours, réessaie dans quelques secondes.');
  try { return fn(); } finally { lock.releaseLock(); }
}

function baseUrl_() {
  return ScriptApp.getService().getUrl() || '';
}

function directUrl_(token) {
  return baseUrl_() + '?k=' + token;
}

/** Lien à partager : via l'application installable si elle est réglée, sinon direct. */
function shareUrl_(token) {
  var app = getSettings_().appUrl;
  return app ? app + '#' + directUrl_(token) : directUrl_(token);
}

function ownerUrl_() {
  return shareUrl_(PropertiesService.getScriptProperties().getProperty('ownerToken'));
}

function newToken_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

function newRow_(cols) {
  var o = {};
  cols.forEach(function (c) { o[c] = ''; });
  return o;
}

function lockedSet_(r) {
  var o = {};
  String(r.locked || '').split(',').forEach(function (f) { if (f) o[f] = true; });
  return o;
}

function indexBy_(rows, k) {
  var o = {};
  rows.forEach(function (r) { o[r[k]] = r; });
  return o;
}

// Gmail limite les lectures par minute et par utilisateur : on espace les appels
// et on réessaie quelques fois avant de remettre la suite à la synchro suivante.
var GMAIL_PAUSE_MS = 120;
var GMAIL_MAX_PER_RUN = 300;
var GMAIL_RETRY_WAITS_MS = [2000, 5000, 12000];

function isQuotaError_(e) {
  return /quota|rate ?limit|too many requests|429|userRateLimitExceeded/i.test(String(e && e.message || e));
}

function gmail_(fn) {
  for (var attempt = 0; ; attempt++) {
    try {
      var out = fn();
      Utilities.sleep(GMAIL_PAUSE_MS);
      return out;
    } catch (e) {
      if (!isQuotaError_(e) || attempt >= GMAIL_RETRY_WAITS_MS.length) throw e;
      Utilities.sleep(GMAIL_RETRY_WAITS_MS[attempt]);
    }
  }
}

/** Message d'erreur lisible pour l'écran (les détails techniques restent dans le journal Apps Script). */
function friendlyError_(e) {
  if (isQuotaError_(e)) return 'Gmail limite les lectures par minute : la suite se fera seule à la prochaine synchro (rien n\'est perdu).';
  return String(e && e.message || e);
}

function header_(msg, name) {
  var hs = (msg.payload && msg.payload.headers) || [];
  for (var i = 0; i < hs.length; i++) if (String(hs[i].name).toLowerCase() === name.toLowerCase()) return String(hs[i].value || '');
  return '';
}

/** Corps texte d'un message Gmail API (partie text/plain, sinon HTML sans balises). */
function plainBody_(msg) {
  var plain = '';
  var html = '';
  (function walk(part) {
    if (!part) return;
    if (part.mimeType === 'text/plain' && part.body && part.body.data && !plain) plain = decode_(part.body.data);
    else if (part.mimeType === 'text/html' && part.body && part.body.data && !html) html = decode_(part.body.data);
    (part.parts || []).forEach(walk);
  })(msg.payload);
  if (plain) return plain;
  return html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/[ \t]+/g, ' ');
}

/**
 * Le service avancé Gmail d'Apps Script renvoie les champs binaires (corps,
 * pièces jointes) déjà décodés en tableau d'octets ; l'API REST les renvoie en
 * base64 « web ». On accepte les deux (constaté sur le compte de Raphaël :
 * « Impossible de décoder la chaîne » en traitant le tableau comme du base64).
 */
function bytesOf_(data) {
  if (data === null || data === undefined) return [];
  if (typeof data !== 'string') return data;
  var s = data.replace(/\s/g, '');
  while (s.length % 4) s += '=';
  return Utilities.base64DecodeWebSafe(s);
}

function decode_(data) {
  var bytes = bytesOf_(data);
  return Utilities.newBlob(bytes).getDataAsString('UTF-8');
}

function firstName_(full) {
  return String(full || '').trim().split(/\s+/)[0] || '';
}

function str_(v, max) {
  return String(v === undefined || v === null ? '' : v).slice(0, max);
}

function stripAccents_(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function pad2_(n) { return (n < 10 ? '0' : '') + n; }
function ymd_(y, m, d) { return y + '-' + pad2_(m) + '-' + pad2_(d); }
function isYmd_(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s || ''); }
function round2_(n) { return Math.round(n * 100) / 100; }
function daysInMonth_(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
function ymdToUtc_(s) { var p = s.split('-'); return Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])); }
function addDays_(s, n) {
  var d = new Date(ymdToUtc_(s) + n * 86400000);
  return ymd_(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}
function nightsBetween_(a, b) {
  if (!isYmd_(a) || !isYmd_(b)) return 0;
  var n = Math.round((ymdToUtc_(b) - ymdToUtc_(a)) / 86400000);
  return n > 0 ? n : 0;
}
function nowIso_() { return new Date().toISOString(); }
function todayYmd_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Europe/Paris', 'yyyy-MM-dd');
}
/** Heure locale du logement (« 14:05 ») : sert à savoir qui est dans l'appartement en ce moment. */
function nowHm_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Europe/Paris', 'HH:mm');
}


// Page de l'application (copie de apps-script/Index.html).
var INDEX_HTML_ = "<!DOCTYPE html>\n<html lang=\"fr\">\n<head>\n<base target=\"_top\">\n<meta charset=\"utf-8\">\n<style>\n:root{\n  --bg:#f6f5f2;--card:#fff;--ink:#1d1d1f;--muted:#6b6b70;--line:#e4e2dc;--accent:#1f6f5c;--accent-ink:#fff;\n  --airbnb:#e0383e;--airbnb-soft:#ffc4c6;--booking:#2f6fe0;--booking-soft:#c4d6ff;--direct:#2f9d6a;--direct-soft:#c9ecd9;--blocked:#c6c6cc;--blocked-bg:#ececee;\n  --warn:#b26a00;--warn-soft:#fff3dc;--err:#c0392b;--err-soft:#fde4e1;--ok:#2f9d6a;--radius:14px;\n}\n@media (prefers-color-scheme: dark){\n  :root{--bg:#141416;--card:#1f1f23;--ink:#f1f1f3;--muted:#a0a0a8;--line:#33333a;--accent:#3fb394;--accent-ink:#0d1f1a;\n  --airbnb-soft:#6b2a2d;--booking-soft:#24385f;--direct-soft:#1c3a2c;--blocked:#46464c;--blocked-bg:#2c2c31;--warn-soft:#3d2e12;--err-soft:#47201c;}\n}\n*{box-sizing:border-box}\nhtml,body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 -apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,Helvetica,Arial,sans-serif}\nbutton,input,select,textarea{font:inherit;color:inherit}\n.wrap{max-width:760px;margin:0 auto;padding:12px 16px 96px}\nheader.top{display:flex;align-items:center;gap:10px;padding:14px 16px 6px;max-width:760px;margin:0 auto}\nheader.top h1{font-size:19px;margin:0;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.chip{display:inline-flex;align-items:center;gap:6px;font-size:12px;padding:4px 10px;border-radius:999px;background:var(--card);border:1px solid var(--line);color:var(--muted);white-space:nowrap}\n.chip.err{color:var(--err);border-color:var(--err)}\n.btn{border:1px solid var(--line);background:var(--card);border-radius:10px;padding:10px 14px;cursor:pointer;min-height:42px}\n.btn.primary{background:var(--accent);color:var(--accent-ink);border-color:var(--accent);font-weight:600}\n.btn.danger{color:var(--err);border-color:var(--err)}\n.btn.ghost{background:transparent;border-color:transparent}\n.btn.small{padding:6px 10px;min-height:34px;font-size:13px}\n.btn[disabled]{opacity:.55;cursor:default}\n.icon-btn{border:1px solid var(--line);background:var(--card);border-radius:10px;width:42px;height:42px;cursor:pointer;font-size:18px}\n.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:14px;margin:10px 0}\n.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}\n.spread{display:flex;justify-content:space-between;align-items:center;gap:8px}\n.muted{color:var(--muted)}\n.small{font-size:13px}\nh2{font-size:17px;margin:18px 0 8px}\nh3{font-size:15px;margin:0 0 8px}\n.banner{border-radius:12px;padding:12px 14px;margin:10px 0;font-size:14px}\n.banner.info{background:var(--booking-soft)}\n.banner.warn{background:var(--warn-soft)}\n.banner.err{background:var(--err-soft)}\nnav.tabs{position:fixed;left:0;right:0;bottom:0;background:var(--card);border-top:1px solid var(--line);display:flex;justify-content:center;z-index:5;padding-bottom:env(safe-area-inset-bottom)}\nnav.tabs button{flex:1;max-width:150px;border:0;background:none;padding:9px 2px 10px;font-size:11.5px;color:var(--muted);cursor:pointer}\nnav.tabs button .ic{display:block;font-size:19px;line-height:1.2}\nnav.tabs button.on{color:var(--accent);font-weight:600}\n/* calendrier */\n.cal-head{display:flex;align-items:center;gap:6px;margin:6px 0}\n.cal-head .title{flex:1;text-align:center;font-weight:600;text-transform:capitalize}\n.cal{display:flex;flex-direction:column;gap:6px}\n.cal .dows,.cal .wk-days{display:grid;grid-template-columns:repeat(7,1fr);gap:6px}\n.cal .dow{font-size:11px;text-align:center;color:var(--muted);padding:2px 0}\n.cal .wk{position:relative}\n.cal .day{min-height:76px;border-radius:12px;background:var(--card);border:1px solid var(--line);padding:6px;font-size:11px;cursor:pointer;position:relative;text-align:center;display:flex;flex-direction:column;align-items:center}\n/* jours d'un autre mois : sans fond, bord en pointillés, très effacés ; nom du mois sous le 1er */\n.cal .day.out{background:transparent;border:1px dashed var(--line);opacity:.4}\n.cal .day .mo{position:absolute;left:0;right:0;bottom:4px;font-size:9.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);line-height:1}\n.cal .bar.away{opacity:.4}\n.cal .day.past .n{color:var(--muted)}\n.cal .day .n{font-weight:600;font-size:14px;line-height:24px;width:26px;height:26px;border-radius:50%}\n.cal .day.today .n{background:var(--airbnb);color:#fff}\n.cal .day.blocked{background:var(--blocked);border-color:transparent}\n.cal .day.blocked .n{text-decoration:line-through;color:var(--muted);font-weight:500}\n.cal .day.unbook{background:var(--blocked-bg);border-color:transparent}\n.cal .day.unbook .n{color:var(--muted);font-weight:500}\n/* séjour en cours : le bandeau scintille */\n.cal .bar.now{animation:glow 1.6s ease-in-out infinite}\n@keyframes glow{0%,100%{box-shadow:0 1px 3px rgba(0,0,0,.18);filter:brightness(1)}50%{box-shadow:0 0 0 3px #ffc83d,0 0 14px 3px rgba(255,200,61,.75);filter:brightness(1.2)}}\n.sw.now{background:var(--card);box-shadow:0 0 0 2px #ffc83d}\n.cur{border:2px solid var(--ok);cursor:pointer}\n.cur-h{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--ok);margin-bottom:6px;display:flex;align-items:center}\n.cur-empty .cur-h{color:var(--muted)}\n.live{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--ok);margin-right:7px;animation:blink 1.4s ease-in-out infinite}\n@keyframes blink{50%{opacity:.2}}\n@media (prefers-reduced-motion: reduce){.cal .bar.now{animation:none;box-shadow:0 0 0 3px #ffc83d}.live{animation:none}}\n.mcard{cursor:pointer}\n.mcard>div+div{margin-top:2px}\n.cal .day .dot{position:absolute;right:6px;top:6px;width:7px;height:7px;border-radius:50%;background:var(--warn)}\n.cal .bar{position:absolute;top:34px;height:26px;border:0;padding:0 8px;color:#fff;font-size:12px;font-weight:600;line-height:26px;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;z-index:1;box-shadow:0 1px 3px rgba(0,0,0,.18)}\n.cal .bar.s{border-top-left-radius:13px;border-bottom-left-radius:13px}\n.cal .bar.e{border-top-right-radius:13px;border-bottom-right-radius:13px}\n.cal .bar.l1{top:46px;height:18px;line-height:18px;font-size:10.5px}\n.cal .bar.unk{background-image:linear-gradient(90deg,transparent 60%,rgba(255,255,255,.35))}\n.legend{display:flex;gap:12px;flex-wrap:wrap;font-size:12px;color:var(--muted);margin:8px 0}\n.sw{display:inline-block;width:11px;height:11px;border-radius:3px;vertical-align:-1px;margin-right:4px}\n/* listes */\n.item{display:flex;gap:10px;align-items:flex-start;padding:12px;border:1px solid var(--line);border-radius:12px;background:var(--card);margin:8px 0;cursor:pointer;width:100%;text-align:left}\n.item .bar{width:5px;align-self:stretch;border-radius:4px;flex:none}\n.item .main{flex:1;min-width:0}\n.item .t{font-weight:600}\n.item .amt{font-weight:700;white-space:nowrap}\n.badge{display:inline-block;font-size:11px;padding:2px 7px;border-radius:999px;background:var(--bg);border:1px solid var(--line);color:var(--muted);margin-right:4px}\n.badge.airbnb{background:var(--airbnb-soft);border-color:transparent;color:var(--ink)}\n.badge.booking{background:var(--booking-soft);border-color:transparent;color:var(--ink)}\n.badge.direct{background:var(--direct-soft);border-color:transparent;color:var(--ink)}\n.badge.warn{background:var(--warn-soft);border-color:transparent;color:var(--warn)}\n.badge.err{background:var(--err-soft);border-color:transparent;color:var(--err)}\n.empty{text-align:center;color:var(--muted);padding:26px 10px}\n/* revenus */\n.kpis{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}\n@media(min-width:620px){.kpis{grid-template-columns:repeat(4,1fr)}}\n.kpi{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px}\n.kpi .v{font-size:20px;font-weight:700}\n.kpi .l{font-size:12px;color:var(--muted)}\n.mrow{display:grid;grid-template-columns:44px 1fr auto;gap:8px;align-items:center;padding:8px 2px;border-bottom:1px solid var(--line);cursor:pointer}\n.mrow:last-child{border-bottom:0}\ndetails.mdet{margin:0;border-bottom:1px solid var(--line)}\ndetails.mdet:last-child{border-bottom:0}\ndetails.mdet>summary{list-style:none;color:var(--ink);font-size:inherit}\ndetails.mdet>summary::-webkit-details-marker{display:none}\ndetails.mdet>summary .mrow{border-bottom:0}\ndetails.mdet[open]>summary .mrow{font-weight:600}\n.pay{display:grid;grid-template-columns:1fr auto;gap:2px 8px;padding:7px 4px 7px 10px;border-left:3px solid var(--line);margin:0 0 6px 4px;font-size:13px;cursor:pointer}\n.pay .muted{font-size:12px}\n.sheet{background:var(--bg);border:1px solid var(--line);border-radius:14px;padding:12px;margin:6px 0 12px}\n.sh-head{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:10px}\n.sh-dates{display:grid;grid-template-columns:1fr auto 1fr;gap:8px;align-items:center;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px}\n.sh-dates>div{display:flex;flex-direction:column}\n.sh-dates>div:last-child{text-align:right}\n.sh-dates .l{font-size:12px;color:var(--muted)}\n.sh-dates b{font-size:17px}\n.sh-n{text-align:center;font-size:12px;color:var(--muted);line-height:1.2}\n.sh-info{display:grid;gap:6px;margin:10px 2px;font-size:15px}\n.sh-info>div{display:flex;gap:8px;align-items:baseline}\n.sh-actions{display:flex;gap:8px;flex-wrap:wrap;margin:4px 0 6px}\n.sh-actions .btn{flex:1;min-width:120px;text-align:center;text-decoration:none;color:inherit;font-weight:600}\n.btn.wa-btn{background:#25D366;border-color:#25D366;color:#fff !important}\n.sumbox{background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin:6px 0 10px;font-size:14px;line-height:1.6}\n.money{display:grid;grid-template-columns:1fr auto;gap:2px 10px;margin-top:6px;padding-top:6px;border-top:1px solid var(--line)}\n.money b{text-align:right}\n.wa{display:inline-block;font-size:12px;font-weight:600;padding:2px 8px;border-radius:999px;background:#25D366;color:#fff;margin-left:6px;cursor:pointer;text-decoration:none;vertical-align:1px}\n.dowhint{display:block;font-size:12px;color:var(--muted);margin-top:3px}\n.mbar{height:10px;border-radius:5px;background:var(--bg);overflow:hidden}\n.mbar>i{display:block;height:100%;background:var(--accent);border-radius:5px}\n/* formulaires */\nlabel.f{display:block;margin:10px 0}\nlabel.f>span{display:block;font-size:13px;color:var(--muted);margin-bottom:4px}\ninput[type=text],input[type=date],input[type=number],input[type=url],input[type=time],select,textarea{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--bg);min-height:42px}\ntextarea{min-height:80px;resize:vertical}\n.check{display:flex;gap:10px;align-items:flex-start;margin:10px 0;cursor:pointer}\n.check input{width:20px;height:20px;margin-top:1px;flex:none}\n.seg{display:flex;gap:6px;overflow-x:auto;padding-bottom:2px}\n.seg button{border:1px solid var(--line);background:var(--card);border-radius:999px;padding:6px 12px;font-size:13px;white-space:nowrap;cursor:pointer}\n.seg button.on{background:var(--ink);color:var(--bg);border-color:var(--ink)}\ndetails{margin:8px 0}\nsummary{cursor:pointer;color:var(--accent);font-size:14px}\n.help{font-size:13px;color:var(--muted)}\n.help ol{padding-left:20px;margin:6px 0}\n/* modale */\n.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.42);z-index:20;display:flex;align-items:flex-end;justify-content:center}\n@media(min-width:620px){.modal-bg{align-items:center}}\n.modal{background:var(--card);width:100%;max-width:560px;max-height:92vh;overflow:auto;border-radius:18px 18px 0 0;padding:16px 16px 22px}\n@media(min-width:620px){.modal{border-radius:18px}}\n.modal .actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}\n.modal .actions .btn{flex:1}\n#toast{position:fixed;left:50%;transform:translateX(-50%);bottom:84px;z-index:30;max-width:calc(100% - 32px)}\n#toast .t{background:var(--ink);color:var(--bg);padding:11px 16px;border-radius:12px;font-size:14px;box-shadow:0 6px 20px rgba(0,0,0,.25)}\n#toast .t.error{background:var(--err);color:#fff}\n.loading{display:flex;flex-direction:column;align-items:center;gap:12px;padding:60px 16px;color:var(--muted)}\n.spin{width:28px;height:28px;border-radius:50%;border:3px solid var(--line);border-top-color:var(--accent);animation:sp 0.8s linear infinite}\n@keyframes sp{to{transform:rotate(360deg)}}\n.linkbox{font-size:12px;word-break:break-all;background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:8px 10px;margin:6px 0}\n.sticky-save{position:sticky;bottom:70px;margin-top:14px}\n</style>\n</head>\n<body>\n<div id=\"app\"><div class=\"loading\"><div class=\"spin\"></div>Chargement…</div></div>\n<div id=\"toast\"></div>\n<div id=\"modal\"></div>\n<script>var BOOT = <?!= bootJson ?>;</script>\n<script>\n(function () {\n'use strict';\nvar S = { boot: BOOT, data: null, tab: 'planning', month: '', year: 0, resView: 'upcoming', resSource: '', resQuery: '', noteView: 'upcoming', busy: false, loadError: '',\n  preview: false, ownerData: null, loadedAt: 0 }; // preview : le propriétaire regarde la page de la gestionnaire (lecture seule)\nvar SRC = { airbnb: 'Airbnb', booking: 'Booking', direct: 'Direct' };\nvar MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];\nvar MONTHS_S = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];\nvar DOW = ['Dim.', 'Lun.', 'Mar.', 'Mer.', 'Jeu.', 'Ven.', 'Sam.'];\n\n// ---------- outils ----------\nfunction $(sel, root) { return (root || document).querySelector(sel); }\nfunction esc(s) { return String(s == null ? '' : s).replace(/[&<>\"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#39;' }[c]; }); }\nfunction pad(n) { return (n < 10 ? '0' : '') + n; }\nfunction utc(s) { var p = s.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }\nfunction addDays(s, n) { var d = new Date(utc(s) + n * 864e5); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }\nfunction dow(s) { return new Date(utc(s)).getUTCDay(); }\nfunction fmtDate(s, withYear) {\n  if (!s) return '?';\n  var p = s.split('-');\n  return DOW[dow(s)] + ' ' + (+p[2]) + ' ' + MONTHS_S[+p[1] - 1] + (withYear ? ' ' + p[0] : '');\n}\nvar DOW_L = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];\nfunction fmtLong(s) { if (!s) return ''; var p = s.split('-'); return DOW_L[dow(s)] + ' ' + (+p[2]) + ' ' + MONTHS[+p[1] - 1]; }\n// Lien WhatsApp d'un numéro complet (« +33 6… », « 0033… », « 06… » = France) ; vide pour « …9315 ».\n// text : message déjà écrit dans la conversation (la personne n'a plus qu'à appuyer sur Envoyer).\nfunction waLink(phone, text) {\n  var s = String(phone || '').trim();\n  if (!s || /…|\\.\\.\\./.test(s)) return '';\n  var d = s.replace(/[^\\d+]/g, '');\n  if (/^00/.test(d)) d = d.slice(2);\n  else if (/^\\+/.test(d)) d = d.slice(1);\n  else if (/^0\\d{9}$/.test(d)) d = '33' + d.slice(1);\n  d = d.replace(/\\D/g, '');\n  return d.length >= 8 ? 'https://wa.me/' + d + (text ? '?text=' + encodeURIComponent(text) : '') : '';\n}\nfunction waChip(phone, text) {\n  var u = waLink(phone, text);\n  return u ? '<span class=\"wa\" role=\"link\" tabindex=\"0\" data-wa=\"' + esc(u) + '\">WhatsApp</span>' : '';\n}\n// Message WhatsApp préparé pour la gestionnaire (texte réglable par le propriétaire dans Réglages).\nfunction waMessage(r, s) {\n  var tpl = String(s.managerWaMessage || '');\n  if (!tpl.trim()) return '';\n  var first = String(r.guest || '').trim().split(/\\s+/)[0] || '';\n  var map = { 'prénom': first, 'prenom': first, 'gestionnaire': s.managerLabel || '', 'arrivée': fmtLong(r.checkin), 'arrivee': fmtLong(r.checkin),\n    'départ': fmtLong(r.checkout), 'depart': fmtLong(r.checkout), 'heure': s.checkinTime || '', 'guide': String(s.arrivalGuide || '').trim() };\n  var t = tpl.replace(/\\{([^{}]+)\\}/g, function (m, k) { k = k.trim().toLowerCase(); return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : m; });\n  // Repère vide (pas de prénom, pas de guide) : pas de double espace ni de ligne vide en trop.\n  return t.split('\\n').map(function (l) { return l.replace(/[ \\t]{2,}/g, ' ').replace(/ +,/g, ',').replace(/\\s+$/, ''); }).join('\\n').replace(/\\n{3,}/g, '\\n\\n').trim();\n}\n// Brut / commission / net d'un séjour (Booking : prix client ; Airbnb : versement avant frais de service hôte).\nfunction moneyRows(r) {\n  if (r.net === null || r.net === undefined || !r.counted) return '';\n  var approx = r.amountKind === 'facture' || r.amountKind === 'estimé';\n  var c = r.commissionAmt;\n  var rows = '';\n  if (c !== null && c !== undefined) {\n    var gross = r.net + c;\n    rows += '<span>' + (r.source === 'booking' ? 'Prix payé par le client' : r.source === 'airbnb' ? 'Versement brut (avant frais Airbnb)' : 'Brut') + '</span><b>' + fmtMoney(gross) + '</b>' +\n      '<span>' + (r.source === 'booking' ? 'Commission + frais de paiement Booking' : r.source === 'airbnb' ? 'Frais de service hôte Airbnb' : 'Commission') + (gross ? ' (' + (Math.round(c / gross * 1000) / 10).toString().replace('.', ',') + ' %)' : '') + '</span><b>− ' + fmtMoney(c) + '</b>';\n  }\n  rows += '<span><b>Net pour toi</b>' + (approx ? ' <span class=\"muted\">(' + (r.amountKind === 'facture' ? 'part de la facture' : 'estimé') + ')</span>' : '') + '</span><b>' + (approx ? '≈ ' : '') + fmtMoney(r.net) + '</b>';\n  return '<div class=\"money\">' + rows + '</div>';\n}\nfunction fmtMoney(n) {\n  if (n === null || n === undefined || n === '' || isNaN(n)) return '—';\n  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: Math.abs(n) >= 1000 ? 0 : 2 }).format(n);\n}\nfunction ago(iso) {\n  if (!iso) return 'jamais';\n  var m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);\n  if (m < 1) return 'à l\\'instant';\n  if (m < 60) return 'il y a ' + m + ' min';\n  var h = Math.round(m / 60);\n  if (h < 24) return 'il y a ' + h + ' h';\n  return 'il y a ' + Math.round(h / 24) + ' j';\n}\nfunction monthOf(s) { return s.slice(0, 7); }\nfunction monthTitle(ym) { var p = ym.split('-'); return MONTHS[+p[1] - 1] + ' ' + p[0]; }\nfunction shiftMonth(ym, n) { var p = ym.split('-'); var d = new Date(Date.UTC(+p[0], +p[1] - 1 + n, 1)); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1); }\n// Couleur de la plateforme (aussi pour la gestionnaire : demandé par le propriétaire le 26 nov. 2026).\nfunction srcKey(src) { return SRC[src] ? src : 'direct'; }\nfunction srcColor(src) { return 'var(--' + srcKey(src) + ')'; }\nfunction srcSoft(src) { return 'var(--' + srcKey(src) + '-soft)'; }\nfunction cleanErr(e) {\n  var m = (e && (e.message || e)) + '';\n  return m.replace(/^(Exception|Error|Erreur)\\s*:\\s*/i, '').replace(/^ScriptError:\\s*/i, '');\n}\nfunction call(action, payload) {\n  return new Promise(function (resolve, reject) {\n    google.script.run.withSuccessHandler(resolve).withFailureHandler(reject).api(S.boot.token, action, payload || {});\n  });\n}\nvar toastTimer;\nfunction toast(msg, type) {\n  var el = $('#toast');\n  el.innerHTML = '<div class=\"t ' + (type || '') + '\" role=\"status\">' + esc(msg) + '</div>';\n  clearTimeout(toastTimer);\n  toastTimer = setTimeout(function () { el.innerHTML = ''; }, type === 'error' ? 7000 : 3200);\n}\nfunction isOwner() { return S.boot.mode === 'owner' && !S.preview; }\nfunction nightsOf(r) { return r.nights || 0; }\nfunction occupies(r, d) {\n  if (!r.checkin) return false;\n  if (!r.checkout) return r.checkin === d;\n  return r.checkin <= d && d < r.checkout;\n}\n// Nuit fermée (calculé sur le serveur) : 'manual' (fermé, gris foncé) ou 'unbookable' (trop court, gris clair).\nfunction closureOn(d) {\n  var c = (S.data.closures || []).filter(function (x) { return x.start <= d && d < x.end; })[0];\n  return c ? c.kind : '';\n}\n// Voyageur dans l'appartement en ce moment : arrivé (heure d'arrivée passée) et pas encore parti (heure de départ).\nfunction isCurrent(r) {\n  var d = S.data, s = d.settings, t = d.today, h = d.nowTime || '12:00';\n  if (!r || !r.checkin || r.status === 'cancelled' || r.status === 'blocked' || r.hidden === '1') return false;\n  var out = r.checkout || addDays(r.checkin, 1);\n  var started = r.checkin < t || (r.checkin === t && h >= (s.checkinTime || '15:00'));\n  var notGone = t < out || (t === out && h < (s.checkoutTime || '10:00'));\n  return started && notGone;\n}\nfunction currentRes() { return activeRes().filter(isCurrent)[0] || null; }\nfunction activeRes() {\n  return S.data.reservations.filter(function (r) { return r.status !== 'cancelled' && r.status !== 'blocked' && r.hidden !== '1'; });\n}\nfunction notesOn(d) {\n  return S.data.notes.filter(function (n) { return n.date <= d && d <= (n.endDate || n.date); });\n}\nfunction guestLabel(r) {\n  if (r.status === 'blocked') return 'Fermé sur ' + (SRC[r.source] || 'la plateforme');\n  if (r.guest) return r.guest;\n  if (!isOwner()) return 'Voyageur';\n  if (r.source === 'booking' && r.origin === 'ical') return 'Booking (sans e-mail)';\n  return SRC[r.source] || 'Réservation';\n}\n\n// ---------- modales ----------\nfunction openModal(html, onMount) {\n  var m = $('#modal');\n  m.innerHTML = '<div class=\"modal-bg\"><div class=\"modal\" role=\"dialog\" aria-modal=\"true\">' + html + '</div></div>';\n  $('.modal-bg', m).addEventListener('click', function (e) { if (e.target === this) closeModal(); });\n  if (onMount) onMount($('.modal', m));\n}\nfunction closeModal() { $('#modal').innerHTML = ''; }\nfunction confirmDialog(text, okLabel, danger) {\n  return new Promise(function (resolve) {\n    openModal('<h3>' + esc(text) + '</h3><div class=\"actions\"><button class=\"btn\" data-a=\"no\">Annuler</button>' +\n      '<button class=\"btn ' + (danger ? 'danger' : 'primary') + '\" data-a=\"yes\">' + esc(okLabel) + '</button></div>', function (m) {\n      m.querySelector('[data-a=no]').onclick = function () { closeModal(); resolve(false); };\n      m.querySelector('[data-a=yes]').onclick = function () { closeModal(); resolve(true); };\n    });\n  });\n}\n\n// ---------- actions serveur ----------\nfunction act(action, payload, okMsg, btn) {\n  if (S.busy) return Promise.resolve(false);\n  if (S.preview) { toast('Aperçu en lecture seule : reviens à ton espace pour modifier.', 'error'); return Promise.resolve(false); }\n  S.busy = true;\n  var label;\n  if (btn) { label = btn.textContent; btn.disabled = true; btn.textContent = '…'; }\n  return call(action, payload).then(function (data) {\n    S.data = data;\n    S.loadedAt = Date.now();\n    S.busy = false;\n    closeModal();\n    render();\n    if (okMsg) toast(okMsg);\n    return true;\n  }, function (e) {\n    S.busy = false;\n    if (btn) { btn.disabled = false; btn.textContent = label; }\n    toast(cleanErr(e), 'error');\n    return false;\n  });\n}\n\nfunction load() {\n  S.loadError = '';\n  render();\n  call('load').then(function (data) {\n    S.data = data;\n    S.loadedAt = Date.now();\n    if (!S.month) S.month = monthOf(data.today);\n    if (!S.year) S.year = +data.today.slice(0, 4);\n    render();\n    announceShareReady();\n  }, function (e) {\n    S.loadError = cleanErr(e);\n    render();\n  });\n}\n\n// ---------- rendu ----------\nfunction render() {\n  var app = $('#app');\n  var mode = S.boot.mode;\n  if (mode === 'install') return renderInstall(app);\n  if (mode === 'invalid') {\n    app.innerHTML = '<div class=\"wrap\"><div class=\"card\" style=\"margin-top:40px\"><h3>Lien invalide</h3>' +\n      '<p class=\"muted\">Ce lien n\\'est pas (ou plus) valable. Demande un nouveau lien au propriétaire.</p></div></div>';\n    return;\n  }\n  if (S.loadError) {\n    app.innerHTML = '<div class=\"wrap\"><div class=\"banner err\" style=\"margin-top:30px\"><b>Impossible de charger les données.</b><br>' + esc(S.loadError) +\n      '</div><button class=\"btn primary\" id=\"retry\">Réessayer</button></div>';\n    $('#retry').onclick = load;\n    return;\n  }\n  if (!S.data) { app.innerHTML = '<div class=\"loading\"><div class=\"spin\"></div>Chargement…</div>'; return; }\n  if (mode === 'manager' || S.preview) return renderManager(app);\n  renderOwner(app);\n}\n// Retour sur l'application après un moment (téléphone en veille, autre appli) : données rafraîchies\n// sans rien demander, pour que « locataire actuel » et le séjour qui scintille restent justes.\n// Jamais pendant une saisie (fenêtre ouverte, Réglages) pour ne rien effacer.\ndocument.addEventListener('visibilitychange', function () {\n  if (document.visibilityState !== 'visible' || !S.data || S.busy || $('#modal').innerHTML) return;\n  if ((S.boot.mode !== 'owner' && S.boot.mode !== 'manager') || (isOwner() && S.tab === 'reglages')) return;\n  if (Date.now() - S.loadedAt < 5 * 60000) return;\n  var wasPreview = S.preview;\n  call(wasPreview ? 'previewManager' : 'load').then(function (data) {\n    if (S.busy || $('#modal').innerHTML || S.preview !== wasPreview) return;\n    S.data = data;\n    S.loadedAt = Date.now();\n    render();\n  }, function () { /* hors connexion : on garde l'affichage actuel */ });\n});\n\nfunction renderInstall(app) {\n  app.innerHTML = '<div class=\"wrap\"><div class=\"card\" style=\"margin-top:30px\"><h3>Installation</h3>' +\n    '<p>Un clic suffit : je crée ta base de données (un Google Sheet dans ton Drive), tes liens d\\'accès et la synchronisation automatique, puis je lis tes e-mails Airbnb et Booking.</p>' +\n    '<button class=\"btn primary\" id=\"go\" style=\"width:100%\">Installer</button><p class=\"muted small\" id=\"st\"></p></div></div>';\n  $('#go').onclick = function () {\n    var b = this;\n    b.disabled = true;\n    b.textContent = 'Installation…';\n    google.script.run.withSuccessHandler(function (res) {\n      $('#st').textContent = 'Base créée. Lecture des e-mails en cours (jusqu\\'à 2 minutes)…';\n      S.boot = { mode: 'owner', token: res.directUrl.split('k=')[1] };\n      call('sync').then(function (data) { done(res, data.lastSync); }, function (e) { done(res, { ok: false, message: cleanErr(e) }); });\n    }).withFailureHandler(function (e) {\n      b.disabled = false;\n      b.textContent = 'Réessayer';\n      $('#st').textContent = cleanErr(e);\n    }).install();\n  };\n  function done(res, sync) {\n    var url = res.ownerUrl;\n    app.innerHTML = '<div class=\"wrap\"><div class=\"card\" style=\"margin-top:30px\"><h3>C\\'est installé ✅</h3>' +\n      (sync && sync.message ? '<p class=\"small ' + (sync.ok ? 'muted' : '') + '\">' + esc(sync.message) + '</p>' : '') +\n      '<p>Voici <b>ton lien propriétaire</b>. Il donne accès à tes revenus : garde-le pour toi. Je te l\\'ai aussi envoyé par e-mail.</p>' +\n      '<div class=\"linkbox\">' + esc(url) + '</div>' +\n      '<a class=\"btn primary\" style=\"display:block;text-align:center;text-decoration:none\" href=\"' + esc(url) + '\" target=\"_top\">Ouvrir mon tableau de bord</a>' +\n      '<p class=\"muted small\">Dans Chrome : menu ⋮ › « Installer l\\'application » (ou « Ajouter à l\\'écran d\\'accueil »).</p>' +\n      (res.directUrl !== url ? '<p class=\"muted small\">Si l\\'application ne s\\'ouvre pas : <a href=\"' + esc(res.directUrl) + '\" target=\"_top\">lien direct</a>.</p>' : '') + '</div></div>';\n  }\n}\n\n// ======== propriétaire ========\nvar TABS = [['planning', '📅', 'Planning'], ['revenus', '💶', 'Revenus'], ['resas', '🧾', 'Réservations'], ['notes', '📝', 'Notes'], ['reglages', '⚙️', 'Réglages']];\n\nfunction renderOwner(app) {\n  var d = S.data;\n  var ls = d.lastSync;\n  var chip = ls ? '<span class=\"chip ' + (ls.ok ? '' : 'err') + '\" title=\"' + esc(ls.message) + '\">' + (ls.ok ? '✓' : '⚠') + ' ' + esc(ago(ls.at)) + '</span>'\n    : '<span class=\"chip\">Jamais synchronisé</span>';\n  var html = '<header class=\"top\"><h1>' + esc(d.settings.apartmentName) + '</h1>' + chip +\n    '<button class=\"icon-btn\" id=\"syncBtn\" title=\"Synchroniser maintenant\" aria-label=\"Synchroniser maintenant\">↻</button></header><div class=\"wrap\">';\n  html += ({ planning: viewPlanning, revenus: viewRevenus, resas: viewResas, notes: viewNotes, reglages: viewSettings })[S.tab]();\n  html += '</div><nav class=\"tabs\">' + TABS.map(function (t) {\n    return '<button data-tab=\"' + t[0] + '\" class=\"' + (S.tab === t[0] ? 'on' : '') + '\"><span class=\"ic\">' + t[1] + '</span>' + t[2] + '</button>';\n  }).join('') + '</nav>';\n  app.innerHTML = html;\n  app.querySelectorAll('nav.tabs button').forEach(function (b) {\n    b.onclick = function () { S.tab = b.getAttribute('data-tab'); render(); window.scrollTo(0, 0); };\n  });\n  $('#syncBtn').onclick = function () { syncNow(this); };\n  bindCommon(app);\n  ({ planning: bindPlanning, revenus: bindRevenus, resas: bindResas, notes: bindNotes, reglages: bindSettings })[S.tab](app);\n}\n\nfunction syncNow(btn) {\n  toast('Synchronisation en cours…');\n  act('sync', {}, null, btn).then(function (ok) {\n    if (!ok) return;\n    var ls = S.data.lastSync;\n    toast(ls && ls.ok ? 'Synchronisé : ' + ls.message.split(' — ')[0] : 'Synchro avec erreurs, voir Réglages › Journal', ls && ls.ok ? '' : 'error');\n  });\n}\n\nfunction linkify(t) {\n  return esc(t).replace(/https:\\/\\/[^\\s)]+/g, function (u) { return '<a href=\"' + u + '\" target=\"_blank\" rel=\"noopener\">' + u + '</a>'; });\n}\n\nfunction banners() {\n  var d = S.data, out = '';\n  if (d.authUrl) {\n    out += '<div class=\"banner warn\"><b>Une autorisation Google est nécessaire</b> pour que l\\'outil se mette à jour tout seul. ' +\n      '<a class=\"btn small\" style=\"text-decoration:none\" target=\"_blank\" rel=\"noopener\" href=\"' + esc(d.authUrl) + '\">Autoriser</a><br>' +\n      '<span class=\"small muted\">Choisis ton compte › « Paramètres avancés » si Google avertit › Autoriser. Ensuite : Réglages › Vérifier maintenant.</span></div>';\n  }\n  if (!d.settings.icalAirbnb || !d.settings.icalBooking) {\n    out += '<div class=\"banner info\">Pour des dates toujours à jour, ajoute ' +\n      (!d.settings.icalAirbnb && !d.settings.icalBooking ? 'tes liens calendrier Airbnb et Booking' : !d.settings.icalAirbnb ? 'ton lien calendrier Airbnb' : 'ton lien calendrier Booking') +\n      '. <button class=\"btn small\" data-goto=\"reglages\">Les ajouter</button></div>';\n  }\n  if (d.lastSync && !d.lastSync.ok) {\n    var em = d.lastSync.message.split('| Erreurs : ')[1] || d.lastSync.message;\n    out += '<div class=\"banner err\"><b>Dernière synchro en erreur.</b> ' + esc(em.length > 160 ? em.slice(0, 160) + '…' : em) +\n      ' <button class=\"btn small\" data-goto=\"reglages\">Détails</button></div>';\n  }\n  if (d.overlaps && d.overlaps.length) {\n    var byId = {};\n    d.reservations.forEach(function (r) { byId[r.id] = r; });\n    out += '<div class=\"banner warn\"><b>⚠ Réservations qui se chevauchent</b> (double réservation ?)<br>' + d.overlaps.map(function (p) {\n      var a = byId[p[0]], b = byId[p[1]];\n      return esc(guestLabel(a)) + ' (' + fmtDate(a.checkin) + '→' + fmtDate(a.checkout) + ') et ' + esc(guestLabel(b)) + ' (' + fmtDate(b.checkin) + '→' + fmtDate(b.checkout) + ')';\n    }).join('<br>') + '</div>';\n  }\n  return out;\n}\n\n// Boutons WhatsApp (dans les cartes cliquables aussi) : ouvre la conversation sans ouvrir la réservation.\ndocument.addEventListener('click', function (e) {\n  var w = e.target && e.target.closest ? e.target.closest('[data-wa]') : null;\n  if (!w) return;\n  e.preventDefault();\n  e.stopPropagation();\n  window.open(w.getAttribute('data-wa'), '_blank', 'noopener');\n}, true);\nfunction bindCommon(root) {\n  root.querySelectorAll('[data-goto]').forEach(function (b) { b.onclick = function () { S.tab = b.getAttribute('data-goto'); render(); }; });\n  root.querySelectorAll('[data-missing]').forEach(function (b) { b.onclick = function () { S.tab = 'resas'; S.resView = 'missing'; render(); }; });\n  root.querySelectorAll('[data-res]').forEach(function (b) {\n    b.onclick = function () {\n      var r = S.data.reservations.filter(function (x) { return x.id === b.getAttribute('data-res'); })[0];\n      if (r) (isOwner() ? editReservation : showManagerRes)(r);\n    };\n  });\n  root.querySelectorAll('[data-note]').forEach(function (b) {\n    b.onclick = function () {\n      var n = S.data.notes.filter(function (x) { return x.id === b.getAttribute('data-note'); })[0];\n      if (n) editNote(n);\n    };\n  });\n}\n\n// ----- calendrier (commun) -----\nfunction calendarHtml() {\n  var ym = S.month, first = ym + '-01';\n  var startOffset = (dow(first) + 6) % 7; // semaine commençant lundi\n  var start = addDays(first, -startOffset);\n  var res = activeRes().filter(function (r) { return r.checkin; }).sort(function (a, b) { return a.checkin < b.checkin ? -1 : 1; });\n  var html = '<div class=\"cal-head\"><button class=\"icon-btn\" id=\"calPrev\" aria-label=\"Mois précédent\">‹</button><div class=\"title\">' + monthTitle(ym) +\n    '</div><button class=\"icon-btn\" id=\"calNext\" aria-label=\"Mois suivant\">›</button></div>' +\n    '<div class=\"row\" style=\"justify-content:center;margin-bottom:6px\"><button class=\"btn small\" id=\"calToday\">Aujourd\\'hui</button></div><div class=\"cal\"><div class=\"dows\">' +\n    ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'].map(function (x) { return '<div class=\"dow\">' + x + '</div>'; }).join('') + '</div>';\n  for (var w = 0; w < 6; w++) {\n    var ws = addDays(start, w * 7), we = addDays(ws, 7);\n    if (w === 5 && monthOf(ws) !== ym) break;\n    html += '<div class=\"wk\"><div class=\"wk-days\">';\n    for (var i = 0; i < 7; i++) {\n      var d = addDays(ws, i);\n      var busy = res.some(function (r) { return occupies(r, d); });\n      var cl = busy ? '' : closureOn(d);\n      var nn = notesOn(d).length;\n      html += '<button class=\"day' + (monthOf(d) !== ym ? ' out' : '') + (d === S.data.today ? ' today' : '') + (d < S.data.today ? ' past' : '') +\n        (cl === 'manual' ? ' blocked' : cl === 'unbookable' ? ' unbook' : '') + '\" data-day=\"' + d + '\"' +\n        (cl ? ' title=\"' + (cl === 'manual' ? 'Fermé' : 'Non réservable (durée minimale)') + '\"' : '') + '><span class=\"n\">' + (+d.slice(8)) + '</span>' +\n        // Nom du mois sous le 1er jour, et sous la première case quand elle appartient au mois précédent.\n        (d.slice(8) === '01' || (w === 0 && i === 0 && monthOf(d) !== ym) ? '<span class=\"mo\">' + MONTHS_S[+d.slice(5, 7) - 1] + '</span>' : '') +\n        (nn ? '<span class=\"dot\" title=\"' + nn + ' note(s)\"></span>' : '') + '</button>';\n    }\n    html += '</div>';\n    // Bandeaux de séjour, à la façon d'Airbnb : du milieu du jour d'arrivée au milieu du jour de départ.\n    var lanes = [];\n    res.forEach(function (r) {\n      var end = r.checkout || addDays(r.checkin, 1);\n      if (end < ws || (end === ws && !r.checkout) || r.checkin >= we) return;\n      var lane = 0;\n      while (lanes[lane] && lanes[lane] > r.checkin) lane++;\n      lanes[lane] = end;\n      if (lane > 1) return;\n      var startsHere = r.checkin >= ws, endsHere = end < we;\n      var a = startsHere ? (utc(r.checkin) - utc(ws)) / 864e5 + 0.5 : 0;\n      var b = end < we ? (utc(end) - utc(ws)) / 864e5 + (r.checkout ? 0.5 : 0.95) : 7;\n      var gap = 'calc((100% - 36px) / 7 + 6px)';\n      // Séjour entièrement dans un autre mois (ex. départ le 29 du mois précédent) : atténué.\n      var away = end <= first || r.checkin >= shiftMonth(ym, 1) + '-01';\n      html += '<button class=\"bar' + (startsHere ? ' s' : '') + (endsHere ? ' e' : '') + (lane ? ' l1' : '') + (r.checkout ? '' : ' unk') + (isCurrent(r) ? ' now' : '') + (away ? ' away' : '') + '\" data-res=\"' + esc(r.id) +\n        '\" data-bar-start=\"' + r.checkin + '\" style=\"background:' + srcColor(r.source) + ';left:calc(' + a + ' * ' + gap + ');width:calc(' + (b - a) + ' * ' + gap + ' - 6px)\">' +\n        (b - a >= 1.4 ? esc(guestLabel(r)) + (r.checkout ? '' : ' · départ ?') : '') + '</button>'; // trop court : le nom s'affiche sur la ligne suivante\n    });\n    html += '</div>';\n  }\n  var direct = isOwner() || res.some(function (r) { return srcKey(r.source) === 'direct'; });\n  html += '</div><div class=\"legend\"><span><i class=\"sw\" style=\"background:var(--airbnb)\"></i>Airbnb</span><span><i class=\"sw\" style=\"background:var(--booking)\"></i>Booking</span>' +\n    (direct ? '<span><i class=\"sw\" style=\"background:var(--direct)\"></i>Direct</span>' : '') +\n    '<span><i class=\"sw now\"></i>En cours</span><span><i class=\"sw\" style=\"border:1px solid var(--line)\"></i>Libre</span>' +\n    '<span><i class=\"sw\" style=\"background:var(--blocked)\"></i>Fermé</span><span><i class=\"sw\" style=\"background:var(--blocked-bg);border:1px solid var(--line)\"></i>Non réservable</span>' +\n    '<span><i class=\"sw\" style=\"background:var(--warn);border-radius:50%\"></i>Note</span></div>';\n  return html;\n}\nfunction bindCalendar(root) {\n  $('#calPrev', root).onclick = function () { S.month = shiftMonth(S.month, -1); render(); };\n  $('#calNext', root).onclick = function () { S.month = shiftMonth(S.month, 1); render(); };\n  $('#calToday', root).onclick = function () { S.month = monthOf(S.data.today); render(); };\n  root.querySelectorAll('[data-day]').forEach(function (b) { b.onclick = function () { showDay(b.getAttribute('data-day')); }; });\n}\n\nfunction resCard(r, opts) {\n  opts = opts || {};\n  var badges = '';\n  if (isOwner()) {\n    // La couleur de la barre dit déjà la plateforme, le « ≈ » dit déjà que le montant est estimé.\n    if (r.status === 'cancelled') badges += '<span class=\"badge err\">' + (r.autoStatus === 'absent' ? 'Annulée (plus dans le calendrier)' : 'Annulée') + '</span>';\n    if (r.hidden === '1') badges += '<span class=\"badge\">Masquée</span>';\n    if (r.missingAmount) badges += '<span class=\"badge warn\">Montant à saisir</span>';\n    if (!r.checkout && r.status === 'confirmed') badges += '<span class=\"badge warn\">Départ inconnu</span>';\n  }\n  var hasNet = isOwner() && r.net !== null && r.counted;\n  var amt = isOwner() ? '<span class=\"amt\">' + (hasNet ? (r.amountKind === 'facture' || r.amountKind === 'estimé' ? '≈ ' : '') + fmtMoney(r.net) : '') +\n    (hasNet && r.commissionAmt !== null && r.commissionAmt !== undefined ? '<span class=\"small muted\" style=\"display:block;text-align:right;font-weight:400\">comm. ' + fmtMoney(r.commissionAmt) + '</span>' : '') + '</span>' : '';\n  var sub = fmtDate(r.checkin) + ' → ' + (r.checkout ? fmtDate(r.checkout) : '?') + (r.nights ? ' · ' + r.nights + ' nuit' + (r.nights > 1 ? 's' : '') : '');\n  var contact = [r.guestsText ? '👥 ' + esc(r.guestsText) : (r.guestsCount ? '👥 ' + esc(r.guestsCount) + ' pers.' : ''), r.location ? '🌍 ' + esc(r.location) : '',\n    r.phone ? '📞 ' + esc(r.phone) + waChip(r.phone) : ''].filter(Boolean).join(' · ');\n  return '<button class=\"item\" data-res=\"' + esc(r.id) + '\"><span class=\"bar\" style=\"background:' + srcColor(r.source) + '\"></span><span class=\"main\"><span class=\"spread\"><span class=\"t\">' +\n    esc(guestLabel(r)) + '</span>' + amt + '</span><span class=\"small muted\" style=\"display:block\">' + sub + '</span>' +\n    (contact ? '<span class=\"small\" style=\"display:block\">' + contact + '</span>' : '') +\n    (badges ? '<span style=\"display:block;margin-top:4px\">' + badges + '</span>' : '') +\n    (r.sharedNote && !opts.noShared ? '<span class=\"small\" style=\"display:block;margin-top:4px\">💬 ' + esc(r.sharedNote) + '</span>' : '') + '</span></button>';\n}\nfunction noteCard(n) {\n  var who = n.author === 'manager' ? '<span class=\"badge\">' + esc(S.data.settings.managerLabel || 'Gestionnaire') + '</span>' : '';\n  var vis = isOwner() && n.author !== 'manager' ? (n.visible === '1' ? '<span class=\"badge direct\">Visible gestionnaire</span>' : '<span class=\"badge\">Privée</span>') : '';\n  return '<button class=\"item\" data-note=\"' + esc(n.id) + '\"><span class=\"bar\" style=\"background:var(--warn)\"></span><span class=\"main\"><span class=\"small muted\" style=\"display:block\">📝 ' +\n    fmtDate(n.date) + (n.endDate ? ' → ' + fmtDate(n.endDate) : '') + '</span><span style=\"display:block;white-space:pre-wrap\">' + esc(n.text) + '</span>' +\n    (who || vis ? '<span style=\"display:block;margin-top:4px\">' + who + vis + '</span>' : '') + '</span></button>';\n}\n\nfunction showDay(d) {\n  var res = S.data.reservations.filter(function (r) {\n    return r.hidden !== '1' && r.status !== 'cancelled' && (r.status !== 'blocked' || isOwner()) && (occupies(r, d) || r.checkout === d);\n  });\n  var notes = notesOn(d);\n  var canNote = !S.preview && (isOwner() || S.data.settings.managerCanAddNotes);\n  var cl = closureOn(d);\n  var html = '<div class=\"spread\"><h3>' + fmtDate(d, true) + '</h3><button class=\"btn ghost small\" data-close>✕</button></div>';\n  if (cl === 'unbookable' && !res.some(function (r) { return r.status !== 'blocked' && occupies(r, d); })) {\n    html += '<p class=\"muted\">Non réservable : trou trop court entre deux séjours (durée minimale' + (isOwner() ? ' : ' + esc(S.data.settings.minNights) + ' nuits, réglable dans Réglages' : '') + ').</p>';\n  } else if (cl === 'manual' && !isOwner()) {\n    html += '<p class=\"muted\">Fermé à la réservation ce jour-là.</p>';\n  } else if (!res.length && !notes.length) html += '<p class=\"muted\">Rien ce jour-là : logement libre.</p>';\n  res.forEach(function (r) {\n    var what = r.status === 'blocked' ? 'Fermé' : r.checkin === d ? 'Arrivée' : r.checkout === d ? 'Départ' : 'Séjour en cours';\n    html += '<div class=\"small muted\" style=\"margin-top:8px\">' + what + '</div>' + resCard(r);\n  });\n  notes.forEach(function (n) { html += noteCard(n); });\n  html += '<div class=\"actions\">' + (canNote ? '<button class=\"btn\" data-addnote>+ Note ce jour</button>' : '') +\n    (isOwner() ? '<button class=\"btn\" data-addres>+ Réservation</button>' : '') + '</div>';\n  openModal(html, function (m) {\n    m.querySelector('[data-close]').onclick = closeModal;\n    bindCommon(m);\n    var an = m.querySelector('[data-addnote]');\n    if (an) an.onclick = function () { editNote({ date: d, visible: '1' }); };\n    var ar = m.querySelector('[data-addres]');\n    if (ar) ar.onclick = function () { editReservation({ checkin: d, checkout: addDays(d, 1), source: 'direct', origin: 'manual', status: 'confirmed' }); };\n  });\n}\n\n// ----- planning -----\nfunction viewPlanning() {\n  var ym = S.month;\n  var res = S.data.reservations.filter(function (r) {\n    return r.hidden !== '1' && r.status !== 'blocked' && r.checkin && (monthOf(r.checkin) === ym || (r.checkout && monthOf(r.checkout) === ym) || (r.checkin < ym + '-01' && r.checkout > ym + '-31'));\n  });\n  var notes = S.data.notes.filter(function (n) { return monthOf(n.date) === ym || (n.endDate && n.date < ym + '-01' && n.endDate >= ym + '-01'); });\n  var html = banners() + '<div class=\"card\">' + calendarHtml() + '</div>';\n  html += '<div class=\"row\"><button class=\"btn primary\" id=\"addRes\">+ Réservation</button><button class=\"btn\" id=\"addNote\">+ Note</button></div>';\n  // Les annulations ne polluent pas la liste : elles sont regroupées dans un volet repliable.\n  var cancelled = res.filter(function (r) { return r.status === 'cancelled'; });\n  res = res.filter(function (r) { return r.status !== 'cancelled'; });\n  html += '<h2>En ' + monthTitle(ym) + '</h2>';\n  if (!res.length && !notes.length) html += '<div class=\"empty\">Aucune réservation ni note ce mois-ci.</div>';\n  html += res.map(function (r) { return resCard(r); }).join('') + notes.map(noteCard).join('');\n  if (cancelled.length) html += '<details class=\"card\" id=\"cancelBox\"><summary>Annulations du mois (' + cancelled.length + ')</summary>' +\n    cancelled.map(function (r) { return resCard(r); }).join('') + '</details>';\n  return html;\n}\nfunction bindPlanning(root) {\n  bindCalendar(root);\n  $('#addRes', root).onclick = function () { var d = S.data.today; editReservation({ checkin: d, checkout: addDays(d, 1), source: 'direct', origin: 'manual', status: 'confirmed' }); };\n  $('#addNote', root).onclick = function () { editNote({ date: S.data.today, visible: '1' }); };\n}\n\n// ----- revenus -----\n// Ordre : chiffres de l'année, revenus nets par mois (déroulant = paiements séjour par séjour),\n// par plateforme, puis factures Booking repliées (contrôle).\nfunction viewRevenus() {\n  var y = S.year;\n  var st = S.data.stats[y];\n  var years = Object.keys(S.data.stats).map(Number);\n  var html = banners() + '<div class=\"cal-head\"><button class=\"icon-btn\" id=\"yPrev\" aria-label=\"Année précédente\"' + (years.length && y <= Math.min.apply(null, years) ? ' disabled' : '') + '>‹</button><div class=\"title\">' + y +\n    '</div><button class=\"icon-btn\" id=\"yNext\" aria-label=\"Année suivante\">›</button></div>';\n  if (!st) return html + '<div class=\"empty\">Aucune réservation en ' + y + '.</div>';\n  var t = st.total;\n  var occ = t.days ? Math.round(t.nights / t.days * 100) : 0;\n  html += (t.missing ? '<div class=\"banner warn\">' + t.missing + ' séjour(s) de ' + y + ' sans montant : total incomplet. <button class=\"btn small\" data-missing=\"1\">Voir</button></div>' : '') +\n    '<div class=\"kpis\"><div class=\"kpi\"><div class=\"v\">' + fmtMoney(t.revenue) + '</div><div class=\"l\">Revenu net ' + y + (t.estimated ? ' · dont ' + fmtMoney(t.estimated) + ' estimés' : '') + '</div></div>' +\n    '<div class=\"kpi\"><div class=\"v\">' + t.nights + '</div><div class=\"l\">Nuits louées</div></div>' +\n    '<div class=\"kpi\"><div class=\"v\">' + occ + ' %</div><div class=\"l\">Occupation</div></div>' +\n    '<div class=\"kpi\"><div class=\"v\">' + (t.nights ? fmtMoney(t.revenueWithNights / t.nights) : '—') + '</div><div class=\"l\">Net moyen / nuit</div></div></div>';\n  var max = Math.max.apply(null, st.months.map(function (m) { return m.revenue; })) || 1;\n  var byId = {};\n  S.data.reservations.forEach(function (r) { byId[r.id] = r; });\n  html += '<div class=\"card\"><h3>Revenus nets par mois</h3><p class=\"help\" style=\"margin-top:-4px\">Après commissions, comptés par nuit. Touche un mois pour le détail.</p>' +\n    st.months.map(function (m, i) {\n      var items = (m.items || []).slice().sort(function (a, b) { return ((byId[a.id] || {}).checkin || '9') < ((byId[b.id] || {}).checkin || '9') ? -1 : 1; });\n      return '<details class=\"mdet\" data-mdet=\"' + y + '-' + pad(i + 1) + '\"><summary><div class=\"mrow\"><span class=\"small\">' + MONTHS_S[i] + '</span><span><span class=\"mbar\"><i style=\"width:' + Math.round(m.revenue / max * 100) + '%\"></i></span>' +\n        '<span class=\"small muted\">' + m.nights + ' nuit' + (m.nights > 1 ? 's' : '') + ' · ' + Math.round(m.nights / m.days * 100) + ' %' + (m.missing ? ' · <span style=\"color:var(--warn)\">' + m.missing + ' à compléter</span>' : '') +\n        '</span></span><b class=\"small\">' + fmtMoney(m.revenue) + '</b></div></summary>' +\n        (items.length ? items.map(function (it) {\n          var r = byId[it.id];\n          var label = r ? esc(guestLabel(r)) : 'Facture Booking : ventes sans séjour identifié';\n          var dates = r ? fmtDate(r.checkin) + ' → ' + (r.checkout ? fmtDate(r.checkout) : '?') + (it.nights && r.nights && r.nights !== it.nights ? ' · ' + it.nights + ' nuit' + (it.nights > 1 ? 's' : '') + ' sur ' + r.nights + ' ce mois' : r && r.nights ? ' · ' + r.nights + ' nuit' + (r.nights > 1 ? 's' : '') : '') : '';\n          var approx = it.kind === 'facture' || it.kind === 'estimé';\n          var detail = it.commission !== null && it.commission !== undefined ? fmtMoney(it.net + it.commission) + ' − comm. ' + fmtMoney(it.commission)\n            : approx ? (it.kind === 'facture' ? 'part de la facture du mois' : 'estimé') : '';\n          return '<div class=\"pay\"' + (r ? ' data-res=\"' + esc(r.id) + '\"' : '') + ' style=\"border-left-color:' + srcColor(it.source) + '\"><span><b>' + label + '</b>' +\n            (dates ? '<br><span class=\"muted\">' + dates + '</span>' : '') + (detail ? '<br><span class=\"muted\">' + detail + '</span>' : '') + '</span>' +\n            '<b style=\"text-align:right\">' + (it.net === null ? '<span style=\"color:var(--warn)\">à saisir</span>' : (approx ? '≈ ' : '') + fmtMoney(it.net)) + '</b></div>';\n        }).join('') : '<p class=\"small muted\" style=\"margin:4px 0 8px 10px\">Aucun séjour.</p>') +\n        '<p style=\"margin:2px 0 8px 10px\"><button class=\"btn small\" data-month=\"' + y + '-' + pad(i + 1) + '\">Voir dans le planning</button></p></details>';\n    }).join('') + '</div>';\n  var bs = t.bySource, cs = t.commissionBySource || {}, gs = t.grossKnownBySource || {};\n  html += '<div class=\"card\"><h3>Par plateforme</h3>' + ['airbnb', 'booking', 'direct'].filter(function (k) { return bs[k]; }).map(function (k) {\n    var c = cs[k], g = gs[k];\n    return '<div style=\"padding:5px 0\"><div class=\"spread\"><span><i class=\"sw\" style=\"background:' + srcColor(k) + '\"></i>' + SRC[k] + '</span><b>' + fmtMoney(bs[k]) + ' net</b></div>' +\n      (c ? '<div class=\"small muted\">Commissions ' + fmtMoney(c) + ' (' + String(Math.round(c / g * 1000) / 10).replace('.', ',') + ' % du brut' +\n        (Math.abs(g - c - bs[k]) > 1 ? ', sur ' + fmtMoney(g - c) + ' de net connus' : '') + ')</div>' : '') + '</div>';\n  }).join('') + '</div>';\n  html += bookingCard(y);\n  return html;\n}\nfunction bookingCard(y) {\n  var b = S.data.booking;\n  var inv = b.invoices.filter(function (i) { return i.periodEnd.slice(0, 4) === String(y); });\n  if (!inv.length) return '';\n  return '<details class=\"card\" id=\"invoices\"><summary>Factures Booking ' + y + ' (' + inv.length + ')</summary><p class=\"help\">Net de chaque facture mensuelle (séjours partis ce mois-là) : il sert de contrôle de l\\'import.</p>' + inv.map(function (i) {\n    var p = i.periodEnd.split('-');\n    return '<div class=\"spread small\" style=\"padding:5px 0;border-bottom:1px solid var(--line)\"><span>' + MONTHS[+p[1] - 1] + '<br><span class=\"muted\">ventes ' + fmtMoney(i.sales) + ' − frais ' + fmtMoney(i.fees) + '</span></span><b>' + fmtMoney(i.net) + '</b></div>';\n  }).join('') + '</details>';\n}\nfunction bindRevenus(root) {\n  var p = $('#yPrev', root), n = $('#yNext', root);\n  if (p) p.onclick = function () { S.year--; render(); };\n  if (n) n.onclick = function () { S.year++; render(); };\n  root.querySelectorAll('[data-month]').forEach(function (b) { b.onclick = function () { S.month = b.getAttribute('data-month'); S.tab = 'planning'; render(); window.scrollTo(0, 0); }; });\n}\n\n// ----- réservations -----\nfunction viewResas() {\n  var today = S.data.today;\n  var q = S.resQuery.trim().toLowerCase();\n  var list = S.data.reservations.filter(function (r) {\n    var v = S.resView;\n    if (v === 'hidden') { if (r.hidden !== '1') return false; } else if (r.hidden === '1') return false;\n    if (v === 'blocked') { if (r.status !== 'blocked') return false; } else if (v !== 'all' && r.status === 'blocked') return false;\n    if (v === 'upcoming' && (r.status === 'cancelled' || (r.checkout || r.checkin) < today)) return false;\n    if (v === 'past' && (r.status === 'cancelled' || (r.checkout || r.checkin) >= today)) return false;\n    if (v === 'cancelled' && r.status !== 'cancelled') return false;\n    if (v === 'missing' && !r.missingAmount) return false;\n    if (S.resSource && r.source !== S.resSource) return false;\n    if (q && (guestLabel(r) + ' ' + (r.code || '') + ' ' + (r.note || '') + ' ' + (r.sharedNote || '')).toLowerCase().indexOf(q) < 0) return false;\n    return true;\n  });\n  if (S.resView === 'past' || S.resView === 'cancelled') list = list.slice().reverse();\n  var views = [['upcoming', 'À venir'], ['past', 'Passées'], ['all', 'Toutes'], ['missing', 'Montant à saisir'], ['cancelled', 'Annulées'], ['blocked', 'Bloquées'], ['hidden', 'Masquées']];\n  var html = banners() + '<div class=\"row\"><input type=\"text\" id=\"resQ\" placeholder=\"Rechercher…\" value=\"' + esc(S.resQuery) + '\" style=\"flex:1\"><button class=\"btn primary\" id=\"addRes2\">+ Réservation</button></div>' +\n    '<div class=\"seg\" style=\"margin-top:10px\">' + views.map(function (v) { return '<button data-view=\"' + v[0] + '\" class=\"' + (S.resView === v[0] ? 'on' : '') + '\">' + v[1] + '</button>'; }).join('') + '</div>' +\n    '<div class=\"seg\" style=\"margin-top:6px\">' + [['', 'Toutes plateformes'], ['airbnb', 'Airbnb'], ['booking', 'Booking'], ['direct', 'Direct']].map(function (v) {\n      return '<button data-src=\"' + v[0] + '\" class=\"' + (S.resSource === v[0] ? 'on' : '') + '\">' + v[1] + '</button>';\n    }).join('') + '</div>';\n  html += '<p class=\"small muted\">' + list.length + ' réservation(s)' + (list.length ? ' · total net ' + fmtMoney(list.reduce(function (s, r) { return s + (r.counted && r.net ? r.net : 0); }, 0)) : '') + '</p>';\n  if (!list.length) html += '<div class=\"empty\">' + (S.data.reservations.length ? 'Aucune réservation ne correspond.' : 'Aucune réservation pour l\\'instant. Lance une synchro (↻) ou ajoute une réservation directe.') + '</div>';\n  html += list.map(function (r) { return resCard(r); }).join('');\n  return html;\n}\nfunction bindResas(root) {\n  var qi = $('#resQ', root);\n  qi.oninput = function () {\n    S.resQuery = qi.value;\n    var pos = qi.selectionStart;\n    render();\n    var n = $('#resQ');\n    n.focus();\n    try { n.setSelectionRange(pos, pos); } catch (e) {}\n  };\n  root.querySelectorAll('[data-view]').forEach(function (b) { b.onclick = function () { S.resView = b.getAttribute('data-view'); render(); }; });\n  root.querySelectorAll('[data-src]').forEach(function (b) { b.onclick = function () { S.resSource = b.getAttribute('data-src'); render(); }; });\n  $('#addRes2', root).onclick = function () { var d = S.data.today; editReservation({ checkin: d, checkout: addDays(d, 1), source: 'direct', origin: 'manual', status: 'confirmed' }); };\n}\n\n// Fiche d'un séjour : qui, quand, combien de personnes, d'où, comment le joindre, combien il rapporte.\nfunction resCode(r) { return r.code || String(r.key || '').replace(/^(airbnb|booking):/, ''); }\nfunction platformLink(r) {\n  var code = resCode(r);\n  if (r.source === 'airbnb' && /^HM[A-Z0-9]{6,}$/.test(code)) return { label: 'Écrire sur Airbnb', url: 'https://www.airbnb.fr/hosting/reservations/details/' + code };\n  if (r.source === 'booking' && /^\\d{6,14}$/.test(code)) {\n    var hid = S.data.settings.bookingHotelId;\n    return { label: 'Écrire sur Booking', url: hid ? 'https://admin.booking.com/hotel/hoteladmin/extranet_ng/manage/booking.html?res_id=' + code + '&hotel_id=' + hid + '&lang=fr' : 'https://admin.booking.com/' };\n  }\n  return null;\n}\nfunction resSheet(r) {\n  var s = S.data.settings;\n  var wa = waLink(r.phone);\n  var pl = platformLink(r);\n  var head = '<div class=\"sh-head\"><span class=\"badge ' + esc(r.source) + '\">' + esc(SRC[r.source] || 'Direct') + '</span>' +\n    (r.status === 'cancelled' ? '<span class=\"badge err\">Annulée</span>' : '') +\n    (resCode(r) && r.source !== 'direct' ? '<span class=\"small muted\">n° ' + esc(resCode(r)) + '</span>' : '') + '</div>';\n  var dates = '<div class=\"sh-dates\"><div><span class=\"l\">Arrivée</span><b>' + fmtDate(r.checkin) + '</b><span class=\"small muted\">dès ' + esc(s.checkinTime) + '</span></div>' +\n    '<div class=\"sh-n\">' + (r.nights ? r.nights + '<br>nuit' + (r.nights > 1 ? 's' : '') : '') + '</div>' +\n    '<div><span class=\"l\">Départ</span><b>' + (r.checkout ? fmtDate(r.checkout) : 'inconnu') + '</b><span class=\"small muted\">' + (r.checkout ? 'avant ' + esc(s.checkoutTime) : '') + '</span></div></div>';\n  var info = '<div class=\"sh-info\">' +\n    '<div><span>👥</span>' + (r.guestsText ? esc(r.guestsText) : r.guestsCount ? esc(r.guestsCount) + ' personne(s)' : '<span class=\"muted\">Voyageurs non indiqués</span>') + '</div>' +\n    '<div><span>🌍</span>' + (r.location ? esc(r.location) : '<span class=\"muted\">Pays non indiqué</span>') + '</div>' +\n    '<div><span>📞</span>' + (wa ? '<a href=\"tel:' + esc(r.phone.replace(/[^\\d+]/g, '')) + '\">' + esc(r.phone) + '</a>'\n      : r.phone ? esc(r.phone) + ' <span class=\"muted\">(numéro incomplet)</span>' : '<span class=\"muted\">Pas de numéro</span>') + '</div></div>';\n  var actions = '<div class=\"sh-actions\">' +\n    (wa ? '<a class=\"btn wa-btn\" target=\"_blank\" rel=\"noopener\" href=\"' + esc(wa) + '\">WhatsApp</a><a class=\"btn\" href=\"tel:' + esc(r.phone.replace(/[^\\d+]/g, '')) + '\">Appeler</a>' : '') +\n    (pl ? '<a class=\"btn\" target=\"_blank\" rel=\"noopener\" href=\"' + esc(pl.url) + '\">' + esc(pl.label) + '</a>' : '') +\n    (!wa ? '<button type=\"button\" class=\"btn\" data-addphone>+ Ajouter le numéro</button>' : '') + '</div>';\n  return '<div class=\"sheet\">' + head + dates + info + (isOwner() ? actions + moneyRows(r) : '') + '</div>';\n}\nfunction editReservation(r) {\n  var isNew = !r.id;\n  var manual = isNew || r.origin === 'manual';\n  var locked = r.lockedFields || [];\n  var src = r.source || 'direct';\n  var originTxt = r.origin === 'email' ? 'Lue dans les e-mails ' + (SRC[src] || '') + (r.code ? ' · code ' + esc(r.code) : '')\n    : r.origin === 'ical' ? 'Vue dans le calendrier ' + (SRC[src] || '') + ' (pas d\\'e-mail correspondant)'\n    : r.origin === 'export' ? 'Importée de l\\'export Booking' + (r.code ? ' · n° ' + esc(r.code) : '') : 'Saisie à la main';\n  var html = '<div class=\"spread\"><h3>' + (isNew ? 'Nouvelle réservation' : esc(guestLabel(r))) + '</h3><button class=\"btn ghost small\" data-close>✕</button></div>' +\n    (isNew || r.status === 'blocked' ? '' : resSheet(r)) +\n    '<form id=\"resForm\">' +\n    (isNew ? '' : '<details id=\"resEdit\"' + (r.status === 'blocked' ? ' open' : '') + '><summary>Modifier les informations</summary><p class=\"small muted\">' + originTxt + (locked.filter(function (f) { return f !== 'hidden'; }).length ? ' · modifiée à la main' : '') + '</p>') +\n    (manual ? '<label class=\"f\"><span>Plateforme</span><select name=\"source\">' + ['direct', 'airbnb', 'booking'].map(function (k) { return '<option value=\"' + k + '\"' + (src === k ? ' selected' : '') + '>' + (k === 'direct' ? 'Direct (sans plateforme)' : SRC[k]) + '</option>'; }).join('') + '</select></label>' : '') +\n    '<label class=\"f\"><span>Voyageur</span><input type=\"text\" name=\"guest\" value=\"' + esc(r.guest || '') + '\" placeholder=\"Nom du voyageur\"></label>' +\n    '<div class=\"row\" style=\"flex-wrap:nowrap\"><label class=\"f\" style=\"flex:1\"><span>Arrivée</span><input type=\"date\" name=\"checkin\" required value=\"' + esc(r.checkin || '') + '\"><span class=\"dowhint\" data-dow=\"checkin\">' + (r.checkin ? fmtDate(r.checkin, true) : '') + '</span></label>' +\n    '<label class=\"f\" style=\"flex:1\"><span>Départ</span><input type=\"date\" name=\"checkout\" value=\"' + esc(r.checkout || '') + '\"><span class=\"dowhint\" data-dow=\"checkout\">' + (r.checkout ? fmtDate(r.checkout, true) : '') + '</span></label></div>' +\n    '<label class=\"f\"><span>Voyageurs</span><input type=\"text\" name=\"guestsText\" value=\"' + esc(r.guestsText || '') + '\" placeholder=\"ex. 2 adultes, 1 enfant\"></label>' +\n    '<div class=\"row\" style=\"flex-wrap:nowrap\"><label class=\"f\" style=\"flex:1\"><span>Téléphone</span><input type=\"tel\" name=\"phone\" value=\"' + esc(r.phone || '') + '\" placeholder=\"+33 6 …\"></label>' +\n    '<label class=\"f\" style=\"flex:1\"><span>Provenance</span><input type=\"text\" name=\"location\" value=\"' + esc(r.location || '') + '\" placeholder=\"Ville, pays\"></label></div>' +\n    '<label class=\"f\"><span>' + (src === 'airbnb' ? 'Montant net reçu (« Vous gagnez »)' : 'Montant net reçu (optionnel si prix client rempli)') + '</span><input type=\"text\" inputmode=\"decimal\" name=\"amountNet\" value=\"' + esc(r.amountNet || '') + '\" placeholder=\"ex. 399,41\"></label>' +\n    (src !== 'airbnb' ? '<label class=\"f\"><span>Prix payé par le client' + (src === 'booking' ? ' (net calculé avec ' + esc(String(S.data.booking.ratePct).replace('.', ',')) + ' % de commission)' : '') + '</span><input type=\"text\" inputmode=\"decimal\" name=\"amountGross\" value=\"' + esc(r.amountGross || '') + '\" placeholder=\"ex. 450\"></label>' : '') +\n    '<label class=\"f\"><span>Statut</span><select name=\"status\"><option value=\"confirmed\"' + (r.status !== 'cancelled' && r.status !== 'blocked' ? ' selected' : '') + '>Confirmée</option><option value=\"cancelled\"' + (r.status === 'cancelled' ? ' selected' : '') + '>Annulée</option>' +\n      '<option value=\"blocked\"' + (r.status === 'blocked' ? ' selected' : '') + '>Dates bloquées (pas une réservation)</option></select></label>' +\n    (r.status === 'blocked' ? '<p class=\"small muted\">Dates bloquées sur ' + esc(SRC[r.source] || 'la plateforme') + ' sans e-mail de réservation : en général un blocage à la main. Si c\\'est une vraie réservation, choisis « Confirmée ».</p>' : '') +\n    '<label class=\"check\" id=\"keepRow\"' + (r.status === 'cancelled' ? '' : ' style=\"display:none\"') + '><input type=\"checkbox\" name=\"keepRevenue\"' + (r.keepRevenue === '1' ? ' checked' : '') + '><span>Annulée mais payée quand même (compter le montant dans mes revenus)</span></label>' +\n    (isNew ? '' : '</details>') +\n    '<label class=\"f\"><span>Note pour la gestionnaire (visible sur sa page)</span><textarea name=\"sharedNote\" placeholder=\"ex. arrivée tardive, lit bébé à préparer\">' + esc(r.sharedNote || '') + '</textarea></label>' +\n    '<label class=\"f\"><span>Note privée (visible par toi seul)</span><textarea name=\"note\">' + esc(r.note || '') + '</textarea></label>' +\n    '<div class=\"actions\"><button type=\"submit\" class=\"btn primary\" id=\"resSave\">' + (isNew ? 'Ajouter' : 'Enregistrer') + '</button></div>' +\n    (isNew ? '' : '<div class=\"actions\">' +\n      (r.hidden === '1' ? '<button type=\"button\" class=\"btn\" data-restore>Réafficher</button>'\n        : '<button type=\"button\" class=\"btn danger\" data-del>' + (manual ? 'Supprimer' : 'Masquer') + '</button>') +\n      (!manual && locked.filter(function (f) { return f !== 'hidden'; }).length ? '<button type=\"button\" class=\"btn\" data-reset>Revenir aux valeurs synchronisées</button>' : '') + '</div>') +\n    '</form>';\n  openModal(html, function (m) {\n    m.querySelector('[data-close]').onclick = closeModal;\n    var f = m.querySelector('#resForm');\n    f.querySelector('[name=status]').onchange = function () { m.querySelector('#keepRow').style.display = this.value === 'cancelled' ? '' : 'none'; };\n    var ap = m.querySelector('[data-addphone]');\n    if (ap) ap.onclick = function () { var d = m.querySelector('#resEdit'); if (d) d.open = true; var i = f.querySelector('[name=phone]'); if (i) { i.focus(); i.scrollIntoView({ block: 'center' }); } };\n    ['checkin', 'checkout'].forEach(function (k) {\n      f.querySelector('[name=' + k + ']').addEventListener('input', function () {\n        f.querySelector('[data-dow=' + k + ']').textContent = /^\\d{4}-\\d{2}-\\d{2}$/.test(this.value) ? fmtDate(this.value, true) : '';\n      });\n    });\n    f.onsubmit = function (e) {\n      e.preventDefault();\n      var fd = new FormData(f);\n      var p = { id: r.id || '', source: fd.get('source') || src };\n      ['guest', 'checkin', 'checkout', 'guestsText', 'amountNet', 'amountGross', 'status', 'sharedNote', 'note', 'phone', 'location'].forEach(function (k) { p[k] = fd.get(k) == null ? (r[k] || '') : fd.get(k); });\n      p.keepRevenue = !!fd.get('keepRevenue');\n      if (!p.checkin) { toast('Indique la date d\\'arrivée.', 'error'); return; }\n      if (p.checkout && p.checkout <= p.checkin) { toast('Le départ doit être après l\\'arrivée.', 'error'); return; }\n      act('saveReservation', p, isNew ? 'Réservation ajoutée' : 'Réservation enregistrée', m.querySelector('#resSave'));\n    };\n    var del = m.querySelector('[data-del]');\n    if (del) del.onclick = function () {\n      confirmDialog(manual ? 'Supprimer définitivement cette réservation ?' : 'Masquer cette réservation ? Elle disparaîtra du planning et des revenus (réversible dans Réservations › Masquées).', manual ? 'Supprimer' : 'Masquer', true).then(function (ok) {\n        if (ok) act('deleteReservation', { id: r.id }, manual ? 'Réservation supprimée' : 'Réservation masquée');\n      });\n    };\n    var rs = m.querySelector('[data-restore]');\n    if (rs) rs.onclick = function () { act('restoreReservation', { id: r.id }, 'Réservation réaffichée', rs); };\n    var rt = m.querySelector('[data-reset]');\n    if (rt) rt.onclick = function () {\n      confirmDialog('Effacer tes modifications sur cette réservation et reprendre les valeurs des e-mails et calendriers ?', 'Revenir aux valeurs synchronisées', true).then(function (ok) {\n        if (ok) act('resetReservation', { id: r.id }, 'Valeurs synchronisées rétablies');\n      });\n    };\n  });\n}\n\n// ----- notes -----\nfunction viewNotes() {\n  var today = S.data.today;\n  var list = S.data.notes.filter(function (n) {\n    var end = n.endDate || n.date;\n    if (S.noteView === 'upcoming') return end >= today;\n    if (S.noteView === 'past') return end < today;\n    if (S.noteView === 'manager') return n.author === 'manager';\n    return true;\n  }).sort(function (a, b) { return S.noteView === 'past' ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date); });\n  var views = [['upcoming', 'À venir'], ['past', 'Passées'], ['all', 'Toutes']];\n  if (isOwner()) views.push(['manager', 'De la gestionnaire']);\n  var html = '<div class=\"spread\"><h2 style=\"margin:6px 0\">Notes</h2><button class=\"btn primary\" id=\"addNote2\">+ Note</button></div>' +\n    '<div class=\"seg\">' + views.map(function (v) { return '<button data-nview=\"' + v[0] + '\" class=\"' + (S.noteView === v[0] ? 'on' : '') + '\">' + v[1] + '</button>'; }).join('') + '</div>';\n  if (!list.length) html += '<div class=\"empty\">Aucune note ici. Les notes s\\'affichent sur le planning (point orange).</div>';\n  return html + list.map(noteCard).join('');\n}\nfunction bindNotes(root) {\n  root.querySelectorAll('[data-nview]').forEach(function (b) { b.onclick = function () { S.noteView = b.getAttribute('data-nview'); render(); }; });\n  $('#addNote2', root).onclick = function () { editNote({ date: S.data.today, visible: '1' }); };\n}\nfunction editNote(n) {\n  var isNew = !n.id;\n  var mine = isOwner() ? true : n.author === 'manager';\n  var canEdit = !S.preview && (isNew || (isOwner() ? true : (mine && S.data.settings.managerCanAddNotes)));\n  var html = '<div class=\"spread\"><h3>' + (isNew ? 'Nouvelle note' : 'Note') + '</h3><button class=\"btn ghost small\" data-close>✕</button></div>';\n  if (!canEdit) {\n    html += '<p class=\"small muted\">' + fmtDate(n.date, true) + (n.endDate ? ' → ' + fmtDate(n.endDate, true) : '') + '</p><p style=\"white-space:pre-wrap\">' + esc(n.text) + '</p>';\n    return openModal(html, function (m) { m.querySelector('[data-close]').onclick = closeModal; });\n  }\n  html += '<form id=\"noteForm\"><div class=\"row\" style=\"flex-wrap:nowrap\"><label class=\"f\" style=\"flex:1\"><span>Date</span><input type=\"date\" name=\"date\" required value=\"' + esc(n.date || '') + '\"></label>' +\n    '<label class=\"f\" style=\"flex:1\"><span>Jusqu\\'au (optionnel)</span><input type=\"date\" name=\"endDate\" value=\"' + esc(n.endDate || '') + '\"></label></div>' +\n    '<label class=\"f\"><span>Texte</span><textarea name=\"text\" required placeholder=\"ex. Changer les draps, plombier à 14h, plus de café…\">' + esc(n.text || '') + '</textarea></label>' +\n    (isOwner() && n.author !== 'manager' ? '<label class=\"check\"><input type=\"checkbox\" name=\"visible\"' + (n.visible === '1' ? ' checked' : '') + '><span>Visible par la gestionnaire</span></label>' : '') +\n    (isOwner() && n.author === 'manager' ? '<p class=\"small muted\">Note écrite par la gestionnaire.</p>' : '') +\n    '<div class=\"actions\"><button type=\"submit\" class=\"btn primary\" id=\"noteSave\">' + (isNew ? 'Ajouter' : 'Enregistrer') + '</button></div>' +\n    (isNew ? '' : '<div class=\"actions\"><button type=\"button\" class=\"btn danger\" data-del>Supprimer</button></div>') + '</form>';\n  openModal(html, function (m) {\n    m.querySelector('[data-close]').onclick = closeModal;\n    var f = m.querySelector('#noteForm');\n    f.onsubmit = function (e) {\n      e.preventDefault();\n      var fd = new FormData(f);\n      var p = { id: n.id || '', date: fd.get('date'), endDate: fd.get('endDate') || '', text: fd.get('text') || '', visible: isOwner() ? (n.author === 'manager' ? true : !!fd.get('visible')) : true };\n      if (!p.text.trim()) { toast('La note est vide.', 'error'); return; }\n      if (p.endDate && p.endDate < p.date) { toast('La date de fin doit être après la date de début.', 'error'); return; }\n      act('saveNote', p, isNew ? 'Note ajoutée' : 'Note enregistrée', m.querySelector('#noteSave'));\n    };\n    var del = m.querySelector('[data-del]');\n    if (del) del.onclick = function () {\n      confirmDialog('Supprimer cette note ?', 'Supprimer', true).then(function (ok) { if (ok) act('deleteNote', { id: n.id }, 'Note supprimée'); });\n    };\n  });\n}\n\n// ----- réglages -----\nfunction viewSettings() {\n  var s = S.data.settings, d = S.data;\n  var chk = function (name, label, help) {\n    return '<label class=\"check\"><input type=\"checkbox\" name=\"' + name + '\"' + (s[name] ? ' checked' : '') + '><span>' + label + (help ? '<br><span class=\"help\">' + help + '</span>' : '') + '</span></label>';\n  };\n  var waText = encodeURIComponent('Voici le planning de l\\'appartement (à garder dans tes favoris) : ' + d.managerUrl);\n  return '<form id=\"setForm\">' +\n    '<div class=\"card\"><h3>Appartement</h3><label class=\"f\"><span>Nom affiché</span><input type=\"text\" name=\"apartmentName\" value=\"' + esc(s.apartmentName) + '\"></label>' +\n    '<div class=\"row\" style=\"flex-wrap:nowrap\"><label class=\"f\" style=\"flex:1\"><span>Heure d\\'arrivée</span><input type=\"time\" name=\"checkinTime\" value=\"' + esc(s.checkinTime) + '\"></label>' +\n    '<label class=\"f\" style=\"flex:1\"><span>Heure de départ</span><input type=\"time\" name=\"checkoutTime\" value=\"' + esc(s.checkoutTime) + '\"></label></div>' +\n    '<label class=\"f\"><span>Durée minimale de séjour (nuits)</span><input type=\"number\" min=\"1\" max=\"30\" step=\"1\" inputmode=\"numeric\" name=\"minNights\" value=\"' + esc(s.minNights) + '\"></label>' +\n    '<p class=\"help\">Un trou plus court entre deux séjours ne peut pas être réservé : il est grisé clair (« Non réservable ») dans le calendrier. Gris foncé = dates fermées.</p></div>' +\n    '<div class=\"card\"><h3>Calendriers (dates à jour)</h3>' +\n    '<label class=\"f\"><span>Lien calendrier Airbnb (.ics)</span><input type=\"url\" name=\"icalAirbnb\" value=\"' + esc(s.icalAirbnb) + '\" placeholder=\"https://www.airbnb.fr/calendar/ical/….ics?s=…\"></label>' +\n    '<label class=\"f\"><span>Lien calendrier Booking (.ics)</span><input type=\"url\" name=\"icalBooking\" value=\"' + esc(s.icalBooking) + '\" placeholder=\"https://ical.booking.com/v1/export?t=…\"></label>' +\n    '<label class=\"f\"><span>N° d\\'établissement Booking (pour « Écrire sur Booking »)</span><input type=\"text\" inputmode=\"numeric\" name=\"bookingHotelId\" value=\"' + esc(s.bookingHotelId || '') + '\" placeholder=\"ex. 1234567 (en haut de l\\'extranet)\"></label>' +\n    '<details><summary>Où trouver ces liens ?</summary><div class=\"help\"><b>Airbnb</b> (appli ou site) :<ol><li>Annonces › ton logement › Disponibilités</li><li>« Associer des calendriers » (ou « Synchronisation des calendriers »)</li><li>« Exporter le calendrier » › copier le lien</li></ol>' +\n    '<b>Booking</b> (extranet admin.booking.com) :<ol><li>Tarifs et disponibilités › Synchroniser les calendriers</li><li>« Exporter le calendrier » › copier le lien</li></ol>Colle chaque lien ici puis Enregistrer : la synchro se lance toute seule.</div></details></div>' +\n    '<div class=\"card\"><h3>Revenus</h3><label class=\"f\"><span>Commission Booking totale (%)</span><input type=\"text\" inputmode=\"decimal\" name=\"bookingCommissionPct\" value=\"' + esc(String(s.bookingCommissionPct).replace('.', ',')) + '\" placeholder=\"Automatique\"></label>' +\n    '<p class=\"help\">Laisse vide : le taux réel (commission + frais de paiement) est calculé sur tes factures Booking' + (d.booking.rateSource === 'factures' ? ', actuellement ' + esc(String(d.booking.ratePct).replace('.', ',')) + ' %' : ' (17 % en attendant la première facture)') +\n    '. Il sert quand tu saisis le prix payé par un client Booking. Les montants Airbnb sont déjà nets.</p></div>' +\n    importCard() +\n    '<div class=\"card\"><h3>Synchronisation</h3><label class=\"f\"><span>Fréquence automatique</span><select name=\"syncEveryHours\">' + [1, 2, 4, 6, 12, 24].map(function (h) {\n      return '<option value=\"' + h + '\"' + (+s.syncEveryHours === h ? ' selected' : '') + '>' + (h === 24 ? 'Une fois par jour' : 'Toutes les ' + (h === 1 ? 'heures' : h + ' heures')) + '</option>';\n    }).join('') + '</select></label>' +\n    chk('emailScanEnabled', 'Lire mes e-mails Airbnb et Booking', 'Lecture seule. Crée les réservations et récupère les montants Airbnb.') +\n    '<p class=\"small\">Dernière synchro : ' + (d.lastSync ? esc(ago(d.lastSync.at)) + ' — ' + esc(d.lastSync.message) : 'jamais') + '</p>' +\n    '<details><summary>Journal des synchros</summary>' + (d.log.length ? d.log.map(function (l) {\n      return '<p class=\"small\"><b>' + (l.ok === '1' ? '✓' : '⚠') + ' ' + esc(new Date(l.at).toLocaleString('fr-FR')) + '</b> (' + esc(l.kind) + ')<br>' + esc(l.message) + '</p>';\n    }).join('') : '<p class=\"small muted\">Vide.</p>') + '</details></div>' +\n    '<div class=\"card\"><h3>Page de la gestionnaire</h3><p class=\"help\">Elle voit le planning, les arrivées/départs et les notes que tu rends visibles. Jamais tes montants (filtré sur le serveur).</p>' +\n    '<label class=\"f\"><span>Nom affiché</span><input type=\"text\" name=\"managerLabel\" value=\"' + esc(s.managerLabel) + '\"></label>' +\n    chk('managerShowGuestName', 'Montrer le prénom du voyageur') + chk('managerShowGuestCount', 'Montrer le nombre de voyageurs') +\n    chk('managerShowPhone', 'Montrer le téléphone du voyageur', 'Pratique pour organiser l\\'arrivée. Nécessaire pour son bouton WhatsApp.') +\n    '<label class=\"f\"><span>Message WhatsApp préparé pour elle</span><textarea name=\"managerWaMessage\" rows=\"6\">' + esc(s.managerWaMessage) + '</textarea></label>' +\n    '<p class=\"help\">Quand elle touche « WhatsApp » sur un voyageur, ce message est déjà écrit : elle n\\'a plus qu\\'à l\\'envoyer. Repères remplacés tout seuls : {prénom} {gestionnaire} {arrivée} {départ} {heure} {guide}.</p>' +\n    '<label class=\"f\"><span>Guide d\\'arrivée (mis à la place de {guide})</span><textarea name=\"arrivalGuide\" rows=\"8\" placeholder=\"Colle ici le texte de ton message automatique : adresse, accès, boîte à clés, Wi-Fi…\">' + esc(s.arrivalGuide) + '</textarea></label>' +\n    '<p class=\"small\" style=\"margin:2px 0 4px\">Aperçu du message :</p><div class=\"sumbox\" id=\"waPreview\" style=\"white-space:pre-wrap;margin-top:0\"></div>' +\n    '<label class=\"f\"><span>Ce qu\\'elle touche à chaque départ (€)</span><input type=\"text\" inputmode=\"decimal\" name=\"managerFee\" value=\"' + esc(s.managerFee ? String(s.managerFee).replace('.', ',') : '') + '\" placeholder=\"Vide = pas affiché\"></label>' +\n    '<p class=\"help\">Affiché en haut de sa page, mois par mois : total, déjà perçu et à venir.</p>' +\n    chk('managerCanAddNotes', 'Elle peut ajouter des notes', 'Ex. « plus de lessive ». Elle ne peut modifier que les siennes.') +\n    '<label class=\"f\"><span>Jours passés visibles</span><input type=\"number\" min=\"0\" max=\"365\" name=\"managerPastDays\" value=\"' + esc(s.managerPastDays) + '\"></label>' +\n    '<div class=\"linkbox\" id=\"mgrLink\">' + esc(d.managerUrl) + '</div><div class=\"row\">' +\n    '<button type=\"button\" class=\"btn small\" data-copy=\"' + esc(d.managerUrl) + '\">Copier le lien</button>' +\n    '<a class=\"btn small\" style=\"text-decoration:none\" target=\"_blank\" href=\"https://wa.me/?text=' + waText + '\">Envoyer par WhatsApp</a>' +\n    '<button type=\"button\" class=\"btn small\" id=\"previewMgr\">Aperçu de sa page</button>' +\n    (d.managerDirectUrl !== d.managerUrl ? '<button type=\"button\" class=\"btn small\" data-copy=\"' + esc(d.managerDirectUrl) + '\">Copier le lien direct</button>' : '') +\n    '<button type=\"button\" class=\"btn small danger\" id=\"regen\">Changer le lien</button></div></div>' +\n    '<div class=\"card\"><h3>Mon lien propriétaire</h3><p class=\"help\">À garder pour toi : il donne accès à tes revenus. Perdu ? Il est dans ton e-mail « Ton lien propriétaire ».</p>' +\n    '<div class=\"row\"><button type=\"button\" class=\"btn small\" data-copy=\"' + esc(d.ownerUrl) + '\">Copier mon lien</button>' +\n    (d.ownerDirectUrl !== d.ownerUrl ? '<button type=\"button\" class=\"btn small\" data-copy=\"' + esc(d.ownerDirectUrl) + '\">Copier le lien direct</button>' : '') + '</div></div>' +\n    '<div class=\"card\"><h3>Application installable</h3><label class=\"f\"><span>Adresse de l\\'application</span><input type=\"url\" name=\"appUrl\" value=\"' + esc(s.appUrl) + '\" placeholder=\"Vide = liens directs\"></label>' +\n    '<p class=\"help\">Les liens partagés passent par cette page pour qu\\'on puisse installer l\\'application depuis Chrome (menu ⋮ › Installer l\\'application). Vide : liens directs Google.</p></div>' +\n    '<div class=\"card\"><h3>Mises à jour</h3>' +\n    chk('autoUpdateEnabled', 'Mettre à jour l\\'outil automatiquement (chaque nuit)', 'Seulement les versions qui ont passé tous les tests. Jamais de nouvel accès Google sans ton accord.') +\n    '<p class=\"small\">Version ' + esc(d.version) + (d.lastUpdate ? ' — dernière vérification ' + esc(ago(d.lastUpdate.at)) + ' : ' + (d.lastUpdate.ok ? '' : '⚠ ') + linkify(d.lastUpdate.message) : '') + '</p>' +\n    '<p class=\"small\">' + (d.updaterReady ? '✓ Accès de mise à jour installé.' : 'Accès de mise à jour pas encore installé.') + '</p>' +\n    '<button type=\"button\" class=\"btn small\" id=\"updBtn\">Vérifier maintenant</button></div>' +\n    '<div class=\"card\"><h3>Mes données</h3><p class=\"help\">Tout est stocké dans un Google Sheet de ton Drive (export, sauvegarde, filtres…).</p>' +\n    '<a class=\"btn small\" style=\"text-decoration:none\" target=\"_blank\" href=\"' + esc(d.sheetUrl) + '\">Ouvrir le Google Sheet</a></div>' +\n    '<div class=\"sticky-save\"><button type=\"submit\" class=\"btn primary\" style=\"width:100%\" id=\"setSave\">Enregistrer les réglages</button></div></form>';\n}\nvar IMPORT_ACCEPT = '.csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';\nfunction importCard() {\n  return '<div class=\"card\" id=\"importCard\"><h3>Importer l\\'export Booking</h3>' +\n    '<p class=\"help\">Complète les séjours Booking : nom, départ, pays, voyageurs, téléphone (s\\'il est dans le fichier), annulations et montant net exact (prix − commission − frais de paiement au taux réel de tes factures). Tes saisies à la main ne sont jamais écrasées ; réimporter le même fichier ne crée pas de doublon.</p>' +\n    '<details><summary>Où trouver le fichier ?</summary><div class=\"help\"><ol><li>Extranet admin.booking.com › Réservations</li><li>Date de : « Départ », du … au … (jusqu\\'à 12 mois), sans filtre de statut (annulations comprises)</li><li>« Télécharger » › « Télécharger le relevé de réservations » (fichier .xls)</li></ol>Puis choisis-le ici. Sur Android, avec l\\'application installée : depuis le fichier, Partager › Gestion location.</div></details>' +\n    '<label class=\"btn\" style=\"display:inline-block;margin-top:8px\">📄 Choisir le fichier…<input type=\"file\" id=\"bkFile\" accept=\"' + IMPORT_ACCEPT + '\" style=\"display:none\"></label>' +\n    '<div id=\"importRes\">' + importResultHtml(S.data.lastImport) + '</div></div>';\n}\nfunction importResultHtml(li) {\n  if (!li) return '';\n  return '<div class=\"banner ' + (li.ok ? 'info' : 'warn') + '\" id=\"importLast\"><b>' + (li.ok ? '✓ ' : '⚠ ') + esc(li.message) + '</b><br><span class=\"small muted\">' +\n    esc(li.file || 'fichier') + ' · ' + esc(ago(li.at)) + '</span>' +\n    (li.details && li.details.length ? '<ul class=\"small\" style=\"margin:6px 0 0;padding-left:18px\">' + li.details.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '') + '</div>';\n}\nfunction importBookingFile(file) {\n  if (!file) return;\n  if (file.size > 10 * 1024 * 1024) { toast('Fichier trop gros (10 Mo maximum).', 'error'); return; }\n  var rd = new FileReader();\n  rd.onload = function () { sendImport(file.name, String(rd.result).split(',')[1] || ''); };\n  rd.onerror = function () { toast('Lecture du fichier impossible.', 'error'); };\n  rd.readAsDataURL(file);\n}\nfunction sendImport(name, b64) {\n  if (S.busy) return;\n  S.busy = true;\n  var box = $('#importRes');\n  if (box) box.innerHTML = '<p class=\"small muted\">Import de « ' + esc(name) + ' » en cours…</p>';\n  call('importBookingExport', { name: name, data: b64 }).then(function (data) {\n    S.busy = false;\n    S.data = data;\n    S.tab = 'reglages';\n    render();\n    var r = data.importResult;\n    toast((r.ok ? 'Import : ' : 'Import avec erreurs : ') + r.message, r.ok ? '' : 'error');\n    var card = $('#importCard');\n    if (card && card.scrollIntoView) card.scrollIntoView({ block: 'center' });\n  }, function (e) {\n    S.busy = false;\n    var msg = cleanErr(e);\n    var b = $('#importRes');\n    if (b) b.innerHTML = '<div class=\"banner err\" id=\"importLast\"><b>⚠ Import impossible</b><br>' + esc(msg) + '</div>';\n    toast(msg, 'error');\n  });\n}\n// Fichier partagé sur Android (Partager › Gestion location) : l'application installable (docs/)\n// le transmet à cette page. Accepté seulement depuis son adresse, et après confirmation.\nvar shareReady = false;\nfunction appOrigin() { var m = String((S.data && S.data.settings && S.data.settings.appUrl) || '').match(/^https?:\\/\\/[^\\/]+/); return m ? m[0] : ''; }\nfunction announceShareReady() {\n  if (shareReady || !isOwner() || window.top === window || !appOrigin()) return;\n  shareReady = true;\n  try { window.top.postMessage({ type: 'gl-ready' }, appOrigin()); } catch (e) {}\n}\nwindow.addEventListener('message', function (e) {\n  if (!isOwner() || !S.data || e.source !== window.top || e.origin !== appOrigin()) return;\n  var m = e.data;\n  if (!m || m.type !== 'gl-shared-file' || typeof m.data !== 'string') return;\n  var name = String(m.name || 'export').slice(0, 120);\n  S.tab = 'reglages';\n  render();\n  confirmDialog('Importer « ' + name + ' » (export des réservations Booking) ?', 'Importer').then(function (ok) { if (ok) sendImport(name, m.data); });\n});\nfunction copyText(t) {\n  function fallback() {\n    var ta = document.createElement('textarea');\n    ta.value = t; document.body.appendChild(ta); ta.select();\n    var ok = false;\n    try { ok = document.execCommand('copy'); } catch (e) {}\n    document.body.removeChild(ta);\n    toast(ok ? 'Lien copié' : 'Copie impossible : appuie longuement sur le lien pour le copier', ok ? '' : 'error');\n  }\n  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function () { toast('Lien copié'); }, fallback);\n  else fallback();\n}\nfunction bindSettings(root) {\n  root.querySelectorAll('[data-copy]').forEach(function (b) { b.onclick = function () { copyText(b.getAttribute('data-copy')); }; });\n  $('#bkFile', root).onchange = function () { var file = this.files && this.files[0]; this.value = ''; importBookingFile(file); };\n  $('#updBtn', root).onclick = function () { act('checkUpdate', {}, 'Vérification terminée', this).then(function (ok) { if (ok && S.data.lastUpdate) toast(S.data.lastUpdate.message); }); };\n  $('#regen', root).onclick = function () {\n    confirmDialog('Changer le lien de la gestionnaire ? L\\'ancien lien ne marchera plus : il faudra lui envoyer le nouveau.', 'Changer le lien', true).then(function (ok) {\n      if (ok) act('regenerateManagerLink', {}, 'Nouveau lien créé : pense à l\\'envoyer');\n    });\n  };\n  var f = $('#setForm', root);\n  $('#previewMgr', root).onclick = function () { openPreview(this); };\n  // Aperçu du message WhatsApp avec les valeurs en cours de saisie, sur le prochain séjour (ou un exemple).\n  function waPrev() {\n    var fd = new FormData(f);\n    var t = S.data.today;\n    var r = activeRes().filter(function (x) { return x.checkin && x.checkin >= t; })[0] || { guest: 'Marie', checkin: addDays(t, 3), checkout: addDays(t, 5) };\n    var st = { managerWaMessage: fd.get('managerWaMessage') || '', arrivalGuide: fd.get('arrivalGuide') || '', managerLabel: fd.get('managerLabel') || '', checkinTime: fd.get('checkinTime') || '' };\n    $('#waPreview', root).textContent = waMessage(r, st) || '(message vide)';\n  }\n  ['managerWaMessage', 'arrivalGuide', 'managerLabel', 'checkinTime'].forEach(function (k) { f.querySelector('[name=' + k + ']').addEventListener('input', waPrev); });\n  waPrev();\n  f.onsubmit = function (e) {\n    e.preventDefault();\n    var fd = new FormData(f);\n    var p = {};\n    ['apartmentName', 'checkinTime', 'checkoutTime', 'icalAirbnb', 'icalBooking', 'bookingHotelId', 'bookingCommissionPct', 'syncEveryHours', 'managerLabel', 'managerPastDays', 'appUrl',\n      'minNights', 'managerWaMessage', 'arrivalGuide', 'managerFee'].forEach(function (k) { p[k] = (fd.get(k) || '').trim(); });\n    p.syncEveryHours = +p.syncEveryHours;\n    ['emailScanEnabled', 'managerShowGuestName', 'managerShowGuestCount', 'managerShowPhone', 'managerCanAddNotes', 'autoUpdateEnabled'].forEach(function (k) { p[k] = !!fd.get(k); });\n    var before = S.data.settings;\n    var icalChanged = p.icalAirbnb !== before.icalAirbnb || p.icalBooking !== before.icalBooking || (p.emailScanEnabled && !before.emailScanEnabled);\n    act('saveSettings', p, 'Réglages enregistrés', $('#setSave')).then(function (ok) {\n      if (ok && icalChanged) syncNow($('#syncBtn'));\n    });\n  };\n}\n\n// ======== gestionnaire ========\n// Contenu d'un séjour pour la gestionnaire : le même dans « Locataire actuel », « Prochains passages »\n// et la fenêtre ouverte en touchant le calendrier (full : dates avec l'année + gros boutons).\nfunction mgrBody(r, full) {\n  var s = S.data.settings;\n  var next = r.checkout ? S.data.reservations.filter(function (x) { return x.checkin === r.checkout && x.id !== r.id; })[0] : null;\n  var wa = waLink(r.phone, waMessage(r, s));\n  var tel = String(r.phone || '').replace(/[^\\d+]/g, '');\n  return '<div class=\"spread\"><b>' + esc(r.guest || 'Voyageur') + '</b><span class=\"small muted\">' +\n      (SRC[r.source] && r.source !== 'direct' ? '<span class=\"badge ' + esc(r.source) + '\">' + SRC[r.source] + '</span>' : '') +\n      (r.nights ? r.nights + ' nuit' + (r.nights > 1 ? 's' : '') : '') + '</span></div>' +\n    '<div class=\"small\">🟢 Arrivée ' + fmtDate(r.checkin, full) + ' à partir de ' + esc(s.checkinTime) + '</div>' +\n    '<div class=\"small\">🔴 Départ ' + (r.checkout ? fmtDate(r.checkout, full) + ' avant ' + esc(s.checkoutTime) : 'date à confirmer') + '</div>' +\n    (r.guestsText ? '<div class=\"small muted\">👥 ' + esc(r.guestsText) + '</div>' : '') +\n    (r.phone ? '<div class=\"small\">📞 ' + (wa ? '<a href=\"tel:' + esc(tel) + '\">' + esc(r.phone) + '</a>' + (full ? '' : waChip(r.phone, waMessage(r, s)))\n      : esc(r.phone) + ' <span class=\"muted\">(numéro incomplet)</span>') + '</div>' : '') +\n    (full && wa ? '<div class=\"sh-actions\" style=\"margin-top:10px\"><a class=\"btn wa-btn\" target=\"_blank\" rel=\"noopener\" href=\"' + esc(wa) + '\">WhatsApp</a><a class=\"btn\" href=\"tel:' + esc(tel) + '\">Appeler</a></div>' : '') +\n    (r.checkout ? '<div class=\"small\" style=\"margin-top:6px\"><b>🧹 Ménage ' + fmtDate(r.checkout) + ' après ' + esc(s.checkoutTime) + '</b>' +\n      (next ? ' — <span style=\"color:var(--err)\">nouvelle arrivée le même jour à ' + esc(s.checkinTime) + '</span>' : '') + '</div>' : '') +\n    (r.sharedNote ? '<div class=\"small\" style=\"margin-top:6px\">💬 ' + esc(r.sharedNote) + '</div>' : '');\n}\n// Ses revenus du mois affiché dans le calendrier (forfait à chaque départ, réglé par le propriétaire) :\n// le total, puis déjà perçu / à venir. Changer de mois dans le calendrier change la case.\nfunction fmtEur(n) {\n  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(n);\n}\nfunction payHtml(p) {\n  if (!p || !p.months) return '';\n  var ym = S.month || S.data.today.slice(0, 7);\n  var m = p.months.filter(function (x) { return x.ym === ym; })[0] || { count: 0, amount: 0, paid: 0, toCome: 0 };\n  var mo = +ym.slice(5) - 1;\n  var label = MONTHS[mo].charAt(0).toUpperCase() + MONTHS[mo].slice(1) + (ym.slice(0, 4) !== S.data.today.slice(0, 4) ? ' ' + ym.slice(0, 4) : '');\n  return '<div class=\"card\" id=\"payCard\"><div class=\"spread\"><h3 style=\"margin:0\">💶 Tes revenus · ' + label + '</h3><b style=\"font-size:22px\">' + fmtEur(m.amount) + '</b></div>' +\n    '<div class=\"small muted\">' + (m.count ? m.count + ' départ' + (m.count > 1 ? 's' : '') + ' × ' + fmtEur(p.fee) : 'Aucun départ ce mois-ci') + '</div>' +\n    '<div class=\"spread small\" style=\"margin-top:8px;padding-top:8px;border-top:1px solid var(--line)\"><span>✅ Déjà perçu <b>' + fmtEur(m.paid) + '</b></span><span>⏳ À venir <b>' + fmtEur(m.toCome) + '</b></span></div></div>';\n}\nfunction renderManager(app) {\n  var d = S.data, s = d.settings, today = d.today;\n  var cur = currentRes();\n  // Le séjour en cours a sa propre case : pas répété dessous (un départ du jour reste, pour son ménage).\n  var upcoming = activeRes().filter(function (r) { return (r.checkout || r.checkin) >= today && (!cur || r.id !== cur.id); });\n  var html = '<header class=\"top\"><h1>' + esc(s.apartmentName) + '</h1>' +\n    (S.preview ? '<button class=\"btn small\" id=\"exitPreview\">← Mon espace</button>' : '<span class=\"chip\">Planning</span>') +\n    '<button class=\"icon-btn\" id=\"reload\" title=\"Actualiser\" aria-label=\"Actualiser\">↻</button></header><div class=\"wrap\">';\n  if (S.preview) html += '<div class=\"banner info\"><b>Aperçu</b> : voici exactement ce que voit ' + esc(s.managerLabel || 'la gestionnaire') + ' (lecture seule). « ← Mon espace » pour revenir.</div>';\n  html += payHtml(d.pay);\n  html += '<div class=\"card\">' + calendarHtml() + '</div>';\n  // Locataire actuel : qui est dans l'appartement en ce moment.\n  if (cur) {\n    html += '<div class=\"card cur mcard\" id=\"curCard\" data-mres=\"' + esc(cur.id) + '\" role=\"button\" tabindex=\"0\"><div class=\"cur-h\"><span class=\"live\"></span>Locataire actuel</div>' + mgrBody(cur) + '</div>';\n  } else {\n    var nx = upcoming.filter(function (r) { return r.checkin >= today; })[0];\n    html += '<div class=\"card cur-empty\" id=\"curCard\"><div class=\"cur-h\">Locataire actuel</div><div class=\"small muted\">Personne dans l\\'appartement en ce moment' +\n      (nx ? '. Prochaine arrivée : <b>' + esc(nx.guest || 'Voyageur') + '</b>, ' + fmtDate(nx.checkin) + ' dès ' + esc(s.checkinTime) : '') + '.</div></div>';\n  }\n  html += '<h2>Prochains passages</h2>';\n  if (!upcoming.length) html += '<div class=\"empty\">Aucune réservation à venir.</div>';\n  upcoming.forEach(function (r) { html += '<div class=\"card mcard\" data-mres=\"' + esc(r.id) + '\" role=\"button\" tabindex=\"0\">' + mgrBody(r) + '</div>'; });\n  var notes = d.notes.filter(function (n) { return (n.endDate || n.date) >= today; }).sort(function (a, b) { return a.date.localeCompare(b.date); });\n  html += '<div class=\"spread\"><h2>Notes</h2>' + (s.managerCanAddNotes && !S.preview ? '<button class=\"btn primary small\" id=\"mAddNote\">+ Note</button>' : '') + '</div>';\n  if (!notes.length) html += '<div class=\"empty\">Aucune note à venir.</div>';\n  html += notes.map(noteCard).join('');\n  html += '<p class=\"help\" style=\"text-align:center;margin-top:24px\">Touche un séjour ou un jour du calendrier pour le détail.</p></div>';\n  app.innerHTML = html;\n  bindCalendar(app);\n  bindCommon(app);\n  app.querySelectorAll('[data-mres]').forEach(function (c) {\n    c.onclick = function (e) {\n      if (e.target.closest('a,[data-wa]')) return; // appeler / WhatsApp : sans ouvrir la fiche\n      var r = S.data.reservations.filter(function (x) { return x.id === c.getAttribute('data-mres'); })[0];\n      if (r) showManagerRes(r);\n    };\n  });\n  $('#reload').onclick = function () {\n    var b = this; b.disabled = true;\n    call(S.preview ? 'previewManager' : 'load').then(function (data) { S.data = data; S.loadedAt = Date.now(); render(); toast('Planning à jour'); }, function (e) { b.disabled = false; toast(cleanErr(e), 'error'); });\n  };\n  var xp = $('#exitPreview');\n  if (xp) xp.onclick = exitPreview;\n  var an = $('#mAddNote');\n  if (an) an.onclick = function () { editNote({ date: today, author: 'manager' }); };\n}\nfunction showManagerRes(r) {\n  openModal('<div class=\"spread\"><h3>' + (isCurrent(r) ? '🟢 Locataire actuel' : 'Séjour') + '</h3><button class=\"btn ghost small\" data-close>✕</button></div>' +\n    '<div class=\"sheet\">' + mgrBody(r, true) + '</div>', function (m) {\n    m.querySelector('[data-close]').onclick = closeModal;\n  });\n}\n// Aperçu de la page de la gestionnaire dans l'application du propriétaire : on n'ouvre plus son lien,\n// qui remplaçait l'accès propriétaire enregistré dans l'application installée (bug du 26 nov. 2026).\nfunction openPreview(btn) {\n  if (S.busy) return;\n  S.busy = true;\n  var label = btn.textContent; btn.disabled = true; btn.textContent = '…';\n  call('previewManager').then(function (data) {\n    S.busy = false;\n    S.ownerData = S.data;\n    S.data = data;\n    S.preview = true;\n    S.loadedAt = Date.now();\n    render();\n    window.scrollTo(0, 0);\n  }, function (e) {\n    S.busy = false; btn.disabled = false; btn.textContent = label;\n    toast(cleanErr(e), 'error');\n  });\n}\nfunction exitPreview() {\n  if (!S.preview) return;\n  closeModal();\n  S.data = S.ownerData;\n  S.ownerData = null;\n  S.preview = false;\n  S.tab = 'reglages';\n  render();\n  var c = $('#previewMgr');\n  if (c && c.scrollIntoView) c.scrollIntoView({ block: 'center' });\n}\n\nif (S.boot.mode === 'owner' || S.boot.mode === 'manager') load(); else render();\n})();\n</script>\n</body>\n</html>\n";
