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

var APP_VERSION = '1.0.0';

var SHEET_RES = 'Reservations';
var SHEET_NOTES = 'Notes';
var SHEET_LOG = 'Journal';
var SHEET_EMAILS = '_emails_lus';
var SHEET_INVOICES = 'FacturesBooking';

var RES_COLS = ['id', 'key', 'source', 'origin', 'status', 'hidden', 'code', 'guest',
  'guestsText', 'guestsCount', 'checkin', 'checkout', 'amountNet', 'amountGross',
  'paidByGuest', 'keepRevenue', 'note', 'sharedNote', 'locked', 'emailId',
  'createdAt', 'updatedAt', 'seenAt', 'autoStatus'];
var NOTE_COLS = ['id', 'date', 'endDate', 'text', 'visible', 'author', 'createdAt', 'updatedAt'];
var LOG_COLS = ['at', 'kind', 'ok', 'message'];
var INVOICE_COLS = ['number', 'periodStart', 'periodEnd', 'sales', 'commission', 'paymentFees', 'total', 'emailId', 'readAt'];
// Taux utilisé tant qu'aucune facture Booking n'a été lue.
var BOOKING_FALLBACK_PCT = 17;

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
  managerCanAddNotes: true,
  managerPastDays: 30,
  // Page installable (GitHub Pages) qui affiche l'application : les liens partagés
  // passent par elle pour pouvoir « Installer l'application » depuis Chrome. Vide = liens directs.
  appUrl: 'https://rnab26.github.io/Gestion-Airbnb-Booking/'
};
var SYNC_HOURS_ALLOWED = [1, 2, 4, 6, 12, 24];
// Champs qu'une modification à la main protège contre la synchronisation.
var EDITABLE_RES_FIELDS = ['guest', 'guestsText', 'checkin', 'checkout', 'amountNet',
  'amountGross', 'status', 'keepRevenue', 'note', 'sharedNote', 'source'];

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
    settings: settings,
    reservations: rows,
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
    version: APP_VERSION
  };
}

/** Données de la gestionnaire : aucun montant, aucun code, aucune note privée. */
function managerData_() {
  var s = getSettings_();
  var today = todayYmd_();
  var from = addDays_(today, -Math.max(0, Number(s.managerPastDays) || 0));
  var res = readRows_(SHEET_RES, RES_COLS)
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
        sharedNote: r.sharedNote || ''
      };
    });
  res.sort(function (a, b) { return a.checkin.localeCompare(b.checkin); });
  var notes = readRows_(SHEET_NOTES, NOTE_COLS).filter(function (n) {
    return n.author === 'manager' || n.visible === '1';
  });
  return {
    role: 'manager',
    today: today,
    settings: {
      apartmentName: s.apartmentName,
      checkinTime: s.checkinTime,
      checkoutTime: s.checkoutTime,
      managerLabel: s.managerLabel,
      managerCanAddNotes: !!s.managerCanAddNotes
    },
    reservations: res,
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
  next.managerCanAddNotes = !!p.managerCanAddNotes;
  var past = Number(p.managerPastDays);
  if (isNaN(past) || past < 0 || past > 365) throw new Error('Historique gestionnaire : entre 0 et 365 jours.');
  next.managerPastDays = Math.round(past);
  var app = String(p.appUrl || '').trim();
  if (app && !/^https:\/\/[^\s#?]+\/$/.test(app)) throw new Error('Adresse de l\'application : https://… se terminant par /, ou vide.');
  next.appUrl = app;
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
  events.forEach(function (ev) {
    if (!isYmd_(ev.start) || !isYmd_(ev.end) || ev.end <= ev.start) return;
    if (src === 'airbnb') {
      if (/not available|indisponible|blocked|bloqu/i.test(ev.summary || '')) return;
      booked++;
      var m = ((ev.description || '') + ' ' + (ev.summary || '')).match(/\b(HM[A-Z0-9]{6,})\b/);
      var key = m ? 'airbnb:' + m[1] : 'airbnb-ical:' + (ev.uid || ev.start);
      var r = upsert_(ctx, key, { source: 'airbnb', origin: 'ical', status: 'confirmed' },
        { code: m ? m[1] : '', checkin: ev.start, checkout: ev.end });
      revive_(ctx, r);
      r.seenAt = ctx.now;
      seen[key] = true;
      return;
    }
    booked++;
    // Booking : l'iCal ne donne que des dates. On le rattache à la réservation
    // connue par e-mail qui arrive le même jour, pour récupérer le départ.
    var match = ctx.rows.filter(function (r) {
      return r.source === 'booking' && r.origin === 'email' && (r.status !== 'cancelled' || r.autoStatus === 'absent') && r.checkin === ev.start;
    })[0];
    if (match) {
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
    var dup = ctx.rows.filter(function (r) {
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
      return r.source === 'booking' && r.origin === 'ical' && seen[r.key] && !r.mergedInto && r.status !== 'cancelled' && r.createdAt === ctx.now;
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

function scanEmails_(ctx) {
  var props = PropertiesService.getScriptProperties();
  var tz = Session.getScriptTimeZone() || 'Europe/Paris';
  var last = props.getProperty('lastEmailScan');
  // Seuls les e-mails utiles (expéditeurs et sujets vérifiés sur les vrais e-mails) : moins de lectures Gmail.
  var q = '{(from:automated@airbnb.com subject:(confirmée OR confirmed OR annulation OR annulée OR canceled OR cancelled))' +
    ' (from:noreply@booking.com subject:("nouvelle réservation" OR annulée OR modification OR "new booking" OR cancelled OR cancellation))}' +
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
      ctx.errors.push('e-mail « ' + m.subject.slice(0, 60) + ' » : ' + e.message);
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
      var text = pdfToText_(Utilities.base64DecodeWebSafe(data), att.filename || 'facture.pdf');
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

/** Texte d'un PDF via la conversion Google Drive (fichier temporaire supprimé aussitôt). */
function pdfToText_(bytes, name) {
  var token = ScriptApp.getOAuthToken();
  var auth = { Authorization: 'Bearer ' + token };
  var boundary = 'gl' + Utilities.getUuid().replace(/-/g, '');
  var meta = JSON.stringify({ name: 'tmp-' + name, mimeType: 'application/vnd.google-apps.document' });
  var payload = Utilities.newBlob('--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + meta +
    '\r\n--' + boundary + '\r\nContent-Type: application/pdf\r\n\r\n').getBytes()
    .concat(bytes)
    .concat(Utilities.newBlob('\r\n--' + boundary + '--').getBytes());
  var up = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'post', contentType: 'multipart/related; boundary=' + boundary, payload: payload, headers: auth, muteHttpExceptions: true
  });
  if (up.getResponseCode() !== 200) throw new Error('conversion du PDF refusée (' + up.getResponseCode() + ')');
  var id = JSON.parse(up.getContentText()).id;
  try {
    var ex = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + id + '/export?mimeType=text%2Fplain', { headers: auth, muteHttpExceptions: true });
    if (ex.getResponseCode() !== 200) throw new Error('lecture du PDF converti impossible (' + ex.getResponseCode() + ')');
    return ex.getContentText();
  } finally {
    UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + id, { method: 'delete', headers: auth, muteHttpExceptions: true });
  }
}

function handleAirbnbEmail_(ctx, m, ymd) {
  if (isAirbnbConfirmationSubject_(m.subject)) {
    var body = plainBody_(gmail_(function () { return Gmail.Users.Messages.get('me', m.id, { format: 'full' }); }));
    var p = parseAirbnbConfirmation_(m.subject, body, ymd);
    if (!p) { ctx.warnings.push('format Airbnb non reconnu : « ' + m.subject.slice(0, 60) + ' »'); return; }
    var r = upsert_(ctx, 'airbnb:' + p.code, { source: 'airbnb', origin: 'email', status: 'confirmed' }, {
      code: p.code, guest: p.guest, guestsText: p.guestsText, guestsCount: p.guestsCount,
      amountNet: p.amountNet, paidByGuest: p.paidByGuest, emailId: m.id
    }, { checkin: p.checkin, checkout: p.checkout });
    if (r.origin === 'ical') r.origin = 'email';
    return;
  }
  var code = parseAirbnbCancellationSubject_(m.subject);
  if (code) cancel_(ctx, 'airbnb:' + code);
}

function handleBookingEmail_(ctx, m, ymd) {
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
  var out = { code: cm[1], guest: sm[1].trim(), checkin: '', checkout: '', guestsText: '', guestsCount: '',
    amountNet: '', paidByGuest: '' };
  var dm = text.match(/(?:Arriv[ée]e\s+D[ée]part|Check-?in\s+Check-?out)\s*\n+\s*([^\n]+)/i);
  if (dm) {
    var d = extractDates_(dm[1]);
    if (d.length >= 2) {
      out.checkin = inferDate_(d[0].day, d[0].month, d[0].year, emailYmd);
      out.checkout = inferDate_(d[1].day, d[1].month, d[1].year, out.checkin);
    }
  }
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
  var am = text.match(/(?:VOUS GAGNEZ|YOU EARN)\s*(?:€|EUR)?\s*(-?\d[\d   .,]*)/i);
  if (am) { var a = parseAmount_(am[1]); if (a !== null) out.amountNet = String(a); }
  var pm = text.match(/TOTAL\s*\((?:EUR|€)\)\s*(?:€)?\s*(\d[\d   .,]*)/i);
  if (pm) { var b = parseAmount_(pm[1]); if (b !== null) out.paidByGuest = String(b); }
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
// Revenus (seule source de vérité du calcul)
// =====================================================================

/** Réservation qui occupe le logement (ni annulée, ni simple fermeture de dates, ni masquée). */
function isActive_(r) {
  return r.status !== 'cancelled' && r.status !== 'blocked' && r.hidden !== '1';
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
    return o;
  });
  var byMonth = {};
  invoices.forEach(function (i) {
    var ym = String(i.periodEnd).slice(0, 7);
    var m = byMonth[ym] || (byMonth[ym] = { net: 0 });
    m.net += (Number(i.sales) || 0) - (Number(i.commission) || 0) - (Number(i.paymentFees) || 0);
  });
  var unallocated = {};
  var allocNet = 0, allocNights = 0;
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
        if (r.nights) { allocNet += r.net; allocNights += r.nights; }
      });
    } else if (remaining > 0.5) {
      unallocated[ym] = remaining; // ventes facturées sans réservation identifiée
    }
  });
  var perNight = allocNights ? allocNet / allocNights : 0;
  rows.forEach(function (r) {
    if (r.source === 'booking' && r.counted && r.net === null && perNight && !byMonth[bookingMonth_(r)]) {
      r.net = round2_(perNight * Math.max(1, r.nights));
      r.amountKind = 'estimé';
    }
    r.missingAmount = r.counted && r.net === null;
  });
  return { rows: rows, unallocated: unallocated, ratePct: rate.pct, rateSource: rate.source, perNight: round2_(perNight) };
}

/**
 * Revenus par année et par mois. Le montant d'un séjour est réparti nuit par
 * nuit sur les mois concernés ; un séjour sans date de départ compte sur son
 * mois d'arrivée.
 */
function computeStats_(rows, unallocated) {
  var years = {};
  function bucket(y) {
    if (!years[y]) {
      years[y] = { months: [], total: { revenue: 0, estimated: 0, nights: 0, bookings: 0, missing: 0, bySource: {} } };
      for (var i = 0; i < 12; i++) years[y].months.push({ revenue: 0, estimated: 0, nights: 0, bookings: 0, missing: 0, days: daysInMonth_(Number(y), i + 1) });
    }
    return years[y];
  }
  Object.keys(unallocated || {}).forEach(function (ym) {
    addRev_(bucket(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, unallocated[ym], 'booking', false);
  });
  rows.forEach(function (r) {
    if (!r.counted || !isYmd_(r.checkin)) return;
    var net = r.net;
    var y0 = r.checkin.slice(0, 4);
    var m0 = Number(r.checkin.slice(5, 7)) - 1;
    var b0 = bucket(y0);
    b0.months[m0].bookings++;
    b0.total.bookings++;
    if (net === null) { b0.months[m0].missing++; b0.total.missing++; }
    var n = r.nights;
    var est = r.amountKind === 'estimé';
    if (!n) {
      if (net) addRev_(b0, m0, net, r.source, est);
      return;
    }
    var perNight = net === null ? 0 : net / n;
    for (var i = 0; i < n; i++) {
      var d = addDays_(r.checkin, i);
      var b = bucket(d.slice(0, 4));
      var mi = Number(d.slice(5, 7)) - 1;
      b.months[mi].nights++;
      b.total.nights++;
      if (perNight) addRev_(b, mi, perNight, r.source, est);
    }
  });
  Object.keys(years).forEach(function (y) {
    var t = years[y].total;
    t.revenue = round2_(t.revenue);
    t.estimated = round2_(t.estimated);
    Object.keys(t.bySource).forEach(function (k) { t.bySource[k] = round2_(t.bySource[k]); });
    years[y].months.forEach(function (m) { m.revenue = round2_(m.revenue); m.estimated = round2_(m.estimated); });
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

function decode_(data) {
  var bytes = Utilities.base64DecodeWebSafe(data);
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


// Page de l'application (copie de apps-script/Index.html).
var INDEX_HTML_ = "<!DOCTYPE html>\n<html lang=\"fr\">\n<head>\n<base target=\"_top\">\n<meta charset=\"utf-8\">\n<style>\n:root{\n  --bg:#f6f5f2;--card:#fff;--ink:#1d1d1f;--muted:#6b6b70;--line:#e4e2dc;--accent:#1f6f5c;--accent-ink:#fff;\n  --airbnb:#ff6b6b;--airbnb-soft:#ffe1e1;--booking:#3b6fd8;--booking-soft:#dde7fb;--direct:#2f9d6a;--direct-soft:#d9f1e5;\n  --warn:#b26a00;--warn-soft:#fff3dc;--err:#c0392b;--err-soft:#fde4e1;--ok:#2f9d6a;--radius:14px;\n}\n@media (prefers-color-scheme: dark){\n  :root{--bg:#141416;--card:#1f1f23;--ink:#f1f1f3;--muted:#a0a0a8;--line:#33333a;--accent:#3fb394;--accent-ink:#0d1f1a;\n  --airbnb-soft:#4a2526;--booking-soft:#1f2c4a;--direct-soft:#1c3a2c;--warn-soft:#3d2e12;--err-soft:#47201c;}\n}\n*{box-sizing:border-box}\nhtml,body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 -apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,Helvetica,Arial,sans-serif}\nbutton,input,select,textarea{font:inherit;color:inherit}\n.wrap{max-width:760px;margin:0 auto;padding:12px 16px 96px}\nheader.top{display:flex;align-items:center;gap:10px;padding:14px 16px 6px;max-width:760px;margin:0 auto}\nheader.top h1{font-size:19px;margin:0;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.chip{display:inline-flex;align-items:center;gap:6px;font-size:12px;padding:4px 10px;border-radius:999px;background:var(--card);border:1px solid var(--line);color:var(--muted);white-space:nowrap}\n.chip.err{color:var(--err);border-color:var(--err)}\n.btn{border:1px solid var(--line);background:var(--card);border-radius:10px;padding:10px 14px;cursor:pointer;min-height:42px}\n.btn.primary{background:var(--accent);color:var(--accent-ink);border-color:var(--accent);font-weight:600}\n.btn.danger{color:var(--err);border-color:var(--err)}\n.btn.ghost{background:transparent;border-color:transparent}\n.btn.small{padding:6px 10px;min-height:34px;font-size:13px}\n.btn[disabled]{opacity:.55;cursor:default}\n.icon-btn{border:1px solid var(--line);background:var(--card);border-radius:10px;width:42px;height:42px;cursor:pointer;font-size:18px}\n.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:14px;margin:10px 0}\n.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}\n.spread{display:flex;justify-content:space-between;align-items:center;gap:8px}\n.muted{color:var(--muted)}\n.small{font-size:13px}\nh2{font-size:17px;margin:18px 0 8px}\nh3{font-size:15px;margin:0 0 8px}\n.banner{border-radius:12px;padding:12px 14px;margin:10px 0;font-size:14px}\n.banner.info{background:var(--booking-soft)}\n.banner.warn{background:var(--warn-soft)}\n.banner.err{background:var(--err-soft)}\nnav.tabs{position:fixed;left:0;right:0;bottom:0;background:var(--card);border-top:1px solid var(--line);display:flex;justify-content:center;z-index:5;padding-bottom:env(safe-area-inset-bottom)}\nnav.tabs button{flex:1;max-width:150px;border:0;background:none;padding:9px 2px 10px;font-size:11.5px;color:var(--muted);cursor:pointer}\nnav.tabs button .ic{display:block;font-size:19px;line-height:1.2}\nnav.tabs button.on{color:var(--accent);font-weight:600}\n/* calendrier */\n.cal-head{display:flex;align-items:center;gap:6px;margin:6px 0}\n.cal-head .title{flex:1;text-align:center;font-weight:600;text-transform:capitalize}\n.cal{display:grid;grid-template-columns:repeat(7,1fr);gap:3px}\n.cal .dow{font-size:11px;text-align:center;color:var(--muted);padding:2px 0}\n.cal .day{min-height:58px;border-radius:8px;background:var(--card);border:1px solid var(--line);padding:3px 4px;font-size:11px;cursor:pointer;position:relative;overflow:hidden;text-align:left}\n.cal .day.out{opacity:.35}\n.cal .day.today{outline:2px solid var(--accent);outline-offset:-2px}\n.cal .day .n{font-weight:600;font-size:12px;position:relative}\n.cal .day .lab{position:relative;display:block;font-size:10.5px;line-height:1.2;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600}\n.cal .day .dot{position:absolute;right:4px;top:4px;width:7px;height:7px;border-radius:50%;background:var(--warn)}\n.legend{display:flex;gap:12px;flex-wrap:wrap;font-size:12px;color:var(--muted);margin:8px 0}\n.sw{display:inline-block;width:11px;height:11px;border-radius:3px;vertical-align:-1px;margin-right:4px}\n/* listes */\n.item{display:flex;gap:10px;align-items:flex-start;padding:12px;border:1px solid var(--line);border-radius:12px;background:var(--card);margin:8px 0;cursor:pointer;width:100%;text-align:left}\n.item .bar{width:5px;align-self:stretch;border-radius:4px;flex:none}\n.item .main{flex:1;min-width:0}\n.item .t{font-weight:600}\n.item .amt{font-weight:700;white-space:nowrap}\n.badge{display:inline-block;font-size:11px;padding:2px 7px;border-radius:999px;background:var(--bg);border:1px solid var(--line);color:var(--muted);margin-right:4px}\n.badge.airbnb{background:var(--airbnb-soft);border-color:transparent;color:var(--ink)}\n.badge.booking{background:var(--booking-soft);border-color:transparent;color:var(--ink)}\n.badge.direct{background:var(--direct-soft);border-color:transparent;color:var(--ink)}\n.badge.warn{background:var(--warn-soft);border-color:transparent;color:var(--warn)}\n.badge.err{background:var(--err-soft);border-color:transparent;color:var(--err)}\n.empty{text-align:center;color:var(--muted);padding:26px 10px}\n/* revenus */\n.kpis{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}\n@media(min-width:620px){.kpis{grid-template-columns:repeat(4,1fr)}}\n.kpi{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px}\n.kpi .v{font-size:20px;font-weight:700}\n.kpi .l{font-size:12px;color:var(--muted)}\n.mrow{display:grid;grid-template-columns:44px 1fr auto;gap:8px;align-items:center;padding:8px 2px;border-bottom:1px solid var(--line);cursor:pointer}\n.mrow:last-child{border-bottom:0}\n.mbar{height:10px;border-radius:5px;background:var(--bg);overflow:hidden}\n.mbar>i{display:block;height:100%;background:var(--accent);border-radius:5px}\n/* formulaires */\nlabel.f{display:block;margin:10px 0}\nlabel.f>span{display:block;font-size:13px;color:var(--muted);margin-bottom:4px}\ninput[type=text],input[type=date],input[type=number],input[type=url],input[type=time],select,textarea{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--bg);min-height:42px}\ntextarea{min-height:80px;resize:vertical}\n.check{display:flex;gap:10px;align-items:flex-start;margin:10px 0;cursor:pointer}\n.check input{width:20px;height:20px;margin-top:1px;flex:none}\n.seg{display:flex;gap:6px;overflow-x:auto;padding-bottom:2px}\n.seg button{border:1px solid var(--line);background:var(--card);border-radius:999px;padding:6px 12px;font-size:13px;white-space:nowrap;cursor:pointer}\n.seg button.on{background:var(--ink);color:var(--bg);border-color:var(--ink)}\ndetails{margin:8px 0}\nsummary{cursor:pointer;color:var(--accent);font-size:14px}\n.help{font-size:13px;color:var(--muted)}\n.help ol{padding-left:20px;margin:6px 0}\n/* modale */\n.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.42);z-index:20;display:flex;align-items:flex-end;justify-content:center}\n@media(min-width:620px){.modal-bg{align-items:center}}\n.modal{background:var(--card);width:100%;max-width:560px;max-height:92vh;overflow:auto;border-radius:18px 18px 0 0;padding:16px 16px 22px}\n@media(min-width:620px){.modal{border-radius:18px}}\n.modal .actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}\n.modal .actions .btn{flex:1}\n#toast{position:fixed;left:50%;transform:translateX(-50%);bottom:84px;z-index:30;max-width:calc(100% - 32px)}\n#toast .t{background:var(--ink);color:var(--bg);padding:11px 16px;border-radius:12px;font-size:14px;box-shadow:0 6px 20px rgba(0,0,0,.25)}\n#toast .t.error{background:var(--err);color:#fff}\n.loading{display:flex;flex-direction:column;align-items:center;gap:12px;padding:60px 16px;color:var(--muted)}\n.spin{width:28px;height:28px;border-radius:50%;border:3px solid var(--line);border-top-color:var(--accent);animation:sp 0.8s linear infinite}\n@keyframes sp{to{transform:rotate(360deg)}}\n.linkbox{font-size:12px;word-break:break-all;background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:8px 10px;margin:6px 0}\n.sticky-save{position:sticky;bottom:70px;margin-top:14px}\n</style>\n</head>\n<body>\n<div id=\"app\"><div class=\"loading\"><div class=\"spin\"></div>Chargement…</div></div>\n<div id=\"toast\"></div>\n<div id=\"modal\"></div>\n<script>var BOOT = <?!= bootJson ?>;</script>\n<script>\n(function () {\n'use strict';\nvar S = { boot: BOOT, data: null, tab: 'planning', month: '', year: 0, resView: 'upcoming', resSource: '', resQuery: '', noteView: 'upcoming', busy: false, loadError: '' };\nvar SRC = { airbnb: 'Airbnb', booking: 'Booking', direct: 'Direct' };\nvar MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];\nvar MONTHS_S = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];\nvar DOW = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];\n\n// ---------- outils ----------\nfunction $(sel, root) { return (root || document).querySelector(sel); }\nfunction esc(s) { return String(s == null ? '' : s).replace(/[&<>\"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#39;' }[c]; }); }\nfunction pad(n) { return (n < 10 ? '0' : '') + n; }\nfunction utc(s) { var p = s.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }\nfunction addDays(s, n) { var d = new Date(utc(s) + n * 864e5); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }\nfunction dow(s) { return new Date(utc(s)).getUTCDay(); }\nfunction fmtDate(s, withYear) {\n  if (!s) return '?';\n  var p = s.split('-');\n  return DOW[dow(s)] + ' ' + (+p[2]) + ' ' + MONTHS_S[+p[1] - 1] + (withYear ? ' ' + p[0] : '');\n}\nfunction fmtMoney(n) {\n  if (n === null || n === undefined || n === '' || isNaN(n)) return '—';\n  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: Math.abs(n) >= 1000 ? 0 : 2 }).format(n);\n}\nfunction ago(iso) {\n  if (!iso) return 'jamais';\n  var m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);\n  if (m < 1) return 'à l\\'instant';\n  if (m < 60) return 'il y a ' + m + ' min';\n  var h = Math.round(m / 60);\n  if (h < 24) return 'il y a ' + h + ' h';\n  return 'il y a ' + Math.round(h / 24) + ' j';\n}\nfunction monthOf(s) { return s.slice(0, 7); }\nfunction monthTitle(ym) { var p = ym.split('-'); return MONTHS[+p[1] - 1] + ' ' + p[0]; }\nfunction shiftMonth(ym, n) { var p = ym.split('-'); var d = new Date(Date.UTC(+p[0], +p[1] - 1 + n, 1)); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1); }\n// La gestionnaire voit une seule couleur « occupé » : la plateforme ne la concerne pas.\nfunction srcKey(src) { return !isOwner() ? 'booking' : (SRC[src] ? src : 'direct'); }\nfunction srcColor(src) { return 'var(--' + srcKey(src) + ')'; }\nfunction srcSoft(src) { return 'var(--' + srcKey(src) + '-soft)'; }\nfunction cleanErr(e) {\n  var m = (e && (e.message || e)) + '';\n  return m.replace(/^(Exception|Error|Erreur)\\s*:\\s*/i, '').replace(/^ScriptError:\\s*/i, '');\n}\nfunction call(action, payload) {\n  return new Promise(function (resolve, reject) {\n    google.script.run.withSuccessHandler(resolve).withFailureHandler(reject).api(S.boot.token, action, payload || {});\n  });\n}\nvar toastTimer;\nfunction toast(msg, type) {\n  var el = $('#toast');\n  el.innerHTML = '<div class=\"t ' + (type || '') + '\" role=\"status\">' + esc(msg) + '</div>';\n  clearTimeout(toastTimer);\n  toastTimer = setTimeout(function () { el.innerHTML = ''; }, type === 'error' ? 7000 : 3200);\n}\nfunction isOwner() { return S.boot.mode === 'owner'; }\nfunction nightsOf(r) { return r.nights || 0; }\nfunction occupies(r, d) {\n  if (!r.checkin) return false;\n  if (!r.checkout) return r.checkin === d;\n  return r.checkin <= d && d < r.checkout;\n}\nfunction activeRes() {\n  return S.data.reservations.filter(function (r) { return r.status !== 'cancelled' && r.status !== 'blocked' && r.hidden !== '1'; });\n}\nfunction blockedRes() {\n  return S.data.reservations.filter(function (r) { return r.status === 'blocked' && r.hidden !== '1'; });\n}\nfunction notesOn(d) {\n  return S.data.notes.filter(function (n) { return n.date <= d && d <= (n.endDate || n.date); });\n}\nfunction guestLabel(r) {\n  if (r.status === 'blocked') return 'Dates fermées (Booking)';\n  if (r.guest) return r.guest;\n  if (!isOwner()) return 'Voyageur';\n  if (r.source === 'booking' && r.origin === 'ical') return 'Booking (sans e-mail)';\n  return SRC[r.source] || 'Réservation';\n}\n\n// ---------- modales ----------\nfunction openModal(html, onMount) {\n  var m = $('#modal');\n  m.innerHTML = '<div class=\"modal-bg\"><div class=\"modal\" role=\"dialog\" aria-modal=\"true\">' + html + '</div></div>';\n  $('.modal-bg', m).addEventListener('click', function (e) { if (e.target === this) closeModal(); });\n  if (onMount) onMount($('.modal', m));\n}\nfunction closeModal() { $('#modal').innerHTML = ''; }\nfunction confirmDialog(text, okLabel, danger) {\n  return new Promise(function (resolve) {\n    openModal('<h3>' + esc(text) + '</h3><div class=\"actions\"><button class=\"btn\" data-a=\"no\">Annuler</button>' +\n      '<button class=\"btn ' + (danger ? 'danger' : 'primary') + '\" data-a=\"yes\">' + esc(okLabel) + '</button></div>', function (m) {\n      m.querySelector('[data-a=no]').onclick = function () { closeModal(); resolve(false); };\n      m.querySelector('[data-a=yes]').onclick = function () { closeModal(); resolve(true); };\n    });\n  });\n}\n\n// ---------- actions serveur ----------\nfunction act(action, payload, okMsg, btn) {\n  if (S.busy) return Promise.resolve(false);\n  S.busy = true;\n  var label;\n  if (btn) { label = btn.textContent; btn.disabled = true; btn.textContent = '…'; }\n  return call(action, payload).then(function (data) {\n    S.data = data;\n    S.busy = false;\n    closeModal();\n    render();\n    if (okMsg) toast(okMsg);\n    return true;\n  }, function (e) {\n    S.busy = false;\n    if (btn) { btn.disabled = false; btn.textContent = label; }\n    toast(cleanErr(e), 'error');\n    return false;\n  });\n}\n\nfunction load() {\n  S.loadError = '';\n  render();\n  call('load').then(function (data) {\n    S.data = data;\n    if (!S.month) S.month = monthOf(data.today);\n    if (!S.year) S.year = +data.today.slice(0, 4);\n    render();\n  }, function (e) {\n    S.loadError = cleanErr(e);\n    render();\n  });\n}\n\n// ---------- rendu ----------\nfunction render() {\n  var app = $('#app');\n  var mode = S.boot.mode;\n  if (mode === 'install') return renderInstall(app);\n  if (mode === 'invalid') {\n    app.innerHTML = '<div class=\"wrap\"><div class=\"card\" style=\"margin-top:40px\"><h3>Lien invalide</h3>' +\n      '<p class=\"muted\">Ce lien n\\'est pas (ou plus) valable. Demande un nouveau lien au propriétaire.</p></div></div>';\n    return;\n  }\n  if (S.loadError) {\n    app.innerHTML = '<div class=\"wrap\"><div class=\"banner err\" style=\"margin-top:30px\"><b>Impossible de charger les données.</b><br>' + esc(S.loadError) +\n      '</div><button class=\"btn primary\" id=\"retry\">Réessayer</button></div>';\n    $('#retry').onclick = load;\n    return;\n  }\n  if (!S.data) { app.innerHTML = '<div class=\"loading\"><div class=\"spin\"></div>Chargement…</div>'; return; }\n  if (mode === 'manager') return renderManager(app);\n  renderOwner(app);\n}\n\nfunction renderInstall(app) {\n  app.innerHTML = '<div class=\"wrap\"><div class=\"card\" style=\"margin-top:30px\"><h3>Installation</h3>' +\n    '<p>Un clic suffit : je crée ta base de données (un Google Sheet dans ton Drive), tes liens d\\'accès et la synchronisation automatique, puis je lis tes e-mails Airbnb et Booking.</p>' +\n    '<button class=\"btn primary\" id=\"go\" style=\"width:100%\">Installer</button><p class=\"muted small\" id=\"st\"></p></div></div>';\n  $('#go').onclick = function () {\n    var b = this;\n    b.disabled = true;\n    b.textContent = 'Installation…';\n    google.script.run.withSuccessHandler(function (res) {\n      $('#st').textContent = 'Base créée. Lecture des e-mails en cours (jusqu\\'à 2 minutes)…';\n      S.boot = { mode: 'owner', token: res.directUrl.split('k=')[1] };\n      call('sync').then(function (data) { done(res, data.lastSync); }, function (e) { done(res, { ok: false, message: cleanErr(e) }); });\n    }).withFailureHandler(function (e) {\n      b.disabled = false;\n      b.textContent = 'Réessayer';\n      $('#st').textContent = cleanErr(e);\n    }).install();\n  };\n  function done(res, sync) {\n    var url = res.ownerUrl;\n    app.innerHTML = '<div class=\"wrap\"><div class=\"card\" style=\"margin-top:30px\"><h3>C\\'est installé ✅</h3>' +\n      (sync && sync.message ? '<p class=\"small ' + (sync.ok ? 'muted' : '') + '\">' + esc(sync.message) + '</p>' : '') +\n      '<p>Voici <b>ton lien propriétaire</b>. Il donne accès à tes revenus : garde-le pour toi. Je te l\\'ai aussi envoyé par e-mail.</p>' +\n      '<div class=\"linkbox\">' + esc(url) + '</div>' +\n      '<a class=\"btn primary\" style=\"display:block;text-align:center;text-decoration:none\" href=\"' + esc(url) + '\" target=\"_top\">Ouvrir mon tableau de bord</a>' +\n      '<p class=\"muted small\">Dans Chrome : menu ⋮ › « Installer l\\'application » (ou « Ajouter à l\\'écran d\\'accueil »).</p>' +\n      (res.directUrl !== url ? '<p class=\"muted small\">Si l\\'application ne s\\'ouvre pas : <a href=\"' + esc(res.directUrl) + '\" target=\"_top\">lien direct</a>.</p>' : '') + '</div></div>';\n  }\n}\n\n// ======== propriétaire ========\nvar TABS = [['planning', '📅', 'Planning'], ['revenus', '💶', 'Revenus'], ['resas', '🧾', 'Réservations'], ['notes', '📝', 'Notes'], ['reglages', '⚙️', 'Réglages']];\n\nfunction renderOwner(app) {\n  var d = S.data;\n  var ls = d.lastSync;\n  var chip = ls ? '<span class=\"chip ' + (ls.ok ? '' : 'err') + '\" title=\"' + esc(ls.message) + '\">' + (ls.ok ? '✓' : '⚠') + ' ' + esc(ago(ls.at)) + '</span>'\n    : '<span class=\"chip\">Jamais synchronisé</span>';\n  var html = '<header class=\"top\"><h1>' + esc(d.settings.apartmentName) + '</h1>' + chip +\n    '<button class=\"icon-btn\" id=\"syncBtn\" title=\"Synchroniser maintenant\" aria-label=\"Synchroniser maintenant\">↻</button></header><div class=\"wrap\">';\n  html += ({ planning: viewPlanning, revenus: viewRevenus, resas: viewResas, notes: viewNotes, reglages: viewSettings })[S.tab]();\n  html += '</div><nav class=\"tabs\">' + TABS.map(function (t) {\n    return '<button data-tab=\"' + t[0] + '\" class=\"' + (S.tab === t[0] ? 'on' : '') + '\"><span class=\"ic\">' + t[1] + '</span>' + t[2] + '</button>';\n  }).join('') + '</nav>';\n  app.innerHTML = html;\n  app.querySelectorAll('nav.tabs button').forEach(function (b) {\n    b.onclick = function () { S.tab = b.getAttribute('data-tab'); render(); window.scrollTo(0, 0); };\n  });\n  $('#syncBtn').onclick = function () { syncNow(this); };\n  bindCommon(app);\n  ({ planning: bindPlanning, revenus: bindRevenus, resas: bindResas, notes: bindNotes, reglages: bindSettings })[S.tab](app);\n}\n\nfunction syncNow(btn) {\n  toast('Synchronisation en cours…');\n  act('sync', {}, null, btn).then(function (ok) {\n    if (!ok) return;\n    var ls = S.data.lastSync;\n    toast(ls && ls.ok ? 'Synchronisé : ' + ls.message.split(' — ')[0] : 'Synchro avec erreurs, voir Réglages › Journal', ls && ls.ok ? '' : 'error');\n  });\n}\n\nfunction banners() {\n  var d = S.data, out = '';\n  if (!d.settings.icalAirbnb || !d.settings.icalBooking) {\n    out += '<div class=\"banner info\">Pour des dates toujours à jour, ajoute ' +\n      (!d.settings.icalAirbnb && !d.settings.icalBooking ? 'tes liens calendrier Airbnb et Booking' : !d.settings.icalAirbnb ? 'ton lien calendrier Airbnb' : 'ton lien calendrier Booking') +\n      '. <button class=\"btn small\" data-goto=\"reglages\">Les ajouter</button></div>';\n  }\n  if (d.lastSync && !d.lastSync.ok) {\n    out += '<div class=\"banner err\"><b>Dernière synchro en erreur.</b> ' + esc(d.lastSync.message.split('| Erreurs : ')[1] || d.lastSync.message) + '</div>';\n  }\n  if (d.overlaps && d.overlaps.length) {\n    var byId = {};\n    d.reservations.forEach(function (r) { byId[r.id] = r; });\n    out += '<div class=\"banner warn\"><b>⚠ Réservations qui se chevauchent</b> (double réservation ?)<br>' + d.overlaps.map(function (p) {\n      var a = byId[p[0]], b = byId[p[1]];\n      return esc(guestLabel(a)) + ' (' + fmtDate(a.checkin) + '→' + fmtDate(a.checkout) + ') et ' + esc(guestLabel(b)) + ' (' + fmtDate(b.checkin) + '→' + fmtDate(b.checkout) + ')';\n    }).join('<br>') + '</div>';\n  }\n  var missing = d.reservations.filter(function (r) { return r.missingAmount; }).length;\n  if (missing) {\n    out += '<div class=\"banner warn\">' + missing + ' réservation(s) sans montant : total incomplet. <button class=\"btn small\" data-missing=\"1\">Compléter</button></div>';\n  }\n  return out;\n}\n\nfunction bindCommon(root) {\n  root.querySelectorAll('[data-goto]').forEach(function (b) { b.onclick = function () { S.tab = b.getAttribute('data-goto'); render(); }; });\n  root.querySelectorAll('[data-missing]').forEach(function (b) { b.onclick = function () { S.tab = 'resas'; S.resView = 'missing'; render(); }; });\n  root.querySelectorAll('[data-res]').forEach(function (b) {\n    b.onclick = function () {\n      var r = S.data.reservations.filter(function (x) { return x.id === b.getAttribute('data-res'); })[0];\n      if (r) (isOwner() ? editReservation : showManagerRes)(r);\n    };\n  });\n  root.querySelectorAll('[data-note]').forEach(function (b) {\n    b.onclick = function () {\n      var n = S.data.notes.filter(function (x) { return x.id === b.getAttribute('data-note'); })[0];\n      if (n) editNote(n);\n    };\n  });\n}\n\n// ----- calendrier (commun) -----\nfunction calendarHtml() {\n  var ym = S.month, first = ym + '-01';\n  var startOffset = (dow(first) + 6) % 7; // semaine commençant lundi\n  var start = addDays(first, -startOffset);\n  var res = activeRes();\n  var blk = isOwner() ? blockedRes() : [];\n  var html = '<div class=\"cal-head\"><button class=\"icon-btn\" id=\"calPrev\" aria-label=\"Mois précédent\">‹</button><div class=\"title\">' + monthTitle(ym) +\n    '</div><button class=\"icon-btn\" id=\"calNext\" aria-label=\"Mois suivant\">›</button></div>' +\n    '<div class=\"row\" style=\"justify-content:center;margin-bottom:6px\"><button class=\"btn small\" id=\"calToday\">Aujourd\\'hui</button></div><div class=\"cal\">' +\n    ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'].map(function (x) { return '<div class=\"dow\">' + x + '</div>'; }).join('');\n  for (var i = 0; i < 42; i++) {\n    var d = addDays(start, i);\n    if (i === 35 && monthOf(d) !== ym) break;\n    var night = res.filter(function (r) { return occupies(r, d); })[0];\n    var dep = res.filter(function (r) { return r.checkout === d; })[0];\n    var arr = res.filter(function (r) { return r.checkin === d; })[0];\n    // Moitié gauche = matinée (départ éventuel), moitié droite = nuit occupée.\n    var left = dep ? srcSoft(dep.source) : (night && night.checkin !== d ? srcSoft(night.source) : 'transparent');\n    var right = night ? srcSoft(night.source) : 'transparent';\n    var bg = (left === 'transparent' && right === 'transparent') ? '' :\n      'background:linear-gradient(90deg,' + left + ' 0 50%,' + right + ' 50% 100%);border-color:transparent;';\n    var closed = !night && blk.filter(function (r) { return occupies(r, d); })[0];\n    if (closed) bg = 'background:repeating-linear-gradient(135deg,var(--line) 0 4px,transparent 4px 9px);';\n    var lab = arr ? '<span class=\"lab\" style=\"color:' + srcColor(arr.source) + '\">▸ ' + esc(guestLabel(arr).split(' ')[0]) + '</span>'\n      : (dep && !night ? '<span class=\"lab muted\">◂</span>' : (closed && (closed.checkin === d || d.slice(8) === '01') ? '<span class=\"lab muted\">fermé</span>' : ''));\n    var nn = notesOn(d).length;\n    html += '<button class=\"day' + (monthOf(d) !== ym ? ' out' : '') + (d === S.data.today ? ' today' : '') + '\" data-day=\"' + d + '\" style=\"' + bg + '\">' +\n      '<span class=\"n\">' + (+d.slice(8)) + '</span>' + lab + (nn ? '<span class=\"dot\" title=\"' + nn + ' note(s)\"></span>' : '') + '</button>';\n  }\n  html += '</div><div class=\"legend\">' + (isOwner() ? '<span><i class=\"sw\" style=\"background:var(--airbnb-soft)\"></i>Airbnb</span><span><i class=\"sw\" style=\"background:var(--booking-soft)\"></i>Booking</span><span><i class=\"sw\" style=\"background:var(--direct-soft)\"></i>Direct</span><span><i class=\"sw\" style=\"background:repeating-linear-gradient(135deg,var(--line) 0 3px,transparent 3px 6px);border:1px solid var(--line)\"></i>Fermé</span>'\n    : '<span><i class=\"sw\" style=\"background:var(--booking-soft)\"></i>Occupé</span>') +\n    '<span><i class=\"sw\" style=\"background:var(--warn);border-radius:50%\"></i>Note</span><span>▸ arrivée</span><span>◂ départ</span></div>';\n  return html;\n}\nfunction bindCalendar(root) {\n  $('#calPrev', root).onclick = function () { S.month = shiftMonth(S.month, -1); render(); };\n  $('#calNext', root).onclick = function () { S.month = shiftMonth(S.month, 1); render(); };\n  $('#calToday', root).onclick = function () { S.month = monthOf(S.data.today); render(); };\n  root.querySelectorAll('[data-day]').forEach(function (b) { b.onclick = function () { showDay(b.getAttribute('data-day')); }; });\n}\n\nfunction resCard(r, opts) {\n  opts = opts || {};\n  var badges = '';\n  if (isOwner()) {\n    badges += '<span class=\"badge ' + esc(r.source) + '\">' + esc(SRC[r.source] || r.source) + '</span>';\n    if (r.status === 'blocked') badges += '<span class=\"badge\">Pas une réservation : dates fermées sur Booking</span>';\n    if (r.status === 'cancelled') badges += '<span class=\"badge err\">' + (r.autoStatus === 'absent' ? 'Annulée (plus dans le calendrier)' : 'Annulée') + '</span>';\n    if (r.hidden === '1') badges += '<span class=\"badge\">Masquée</span>';\n    if (r.missingAmount) badges += '<span class=\"badge warn\">Montant à saisir</span>';\n    if (r.amountKind === 'facture') badges += '<span class=\"badge\">≈ part de la facture</span>';\n    if (r.amountKind === 'estimé') badges += '<span class=\"badge warn\">≈ estimé</span>';\n    if (!r.checkout && r.status === 'confirmed') badges += '<span class=\"badge warn\">Départ inconnu</span>';\n  }\n  var amt = isOwner() ? '<span class=\"amt\">' + (r.net === null || !r.counted ? '' : (r.amountKind === 'facture' || r.amountKind === 'estimé' ? '≈ ' : '') + fmtMoney(r.net)) + '</span>' : '';\n  var sub = fmtDate(r.checkin) + ' → ' + (r.checkout ? fmtDate(r.checkout) : '?') + (r.nights ? ' · ' + r.nights + ' nuit' + (r.nights > 1 ? 's' : '') : '') +\n    (r.guestsText ? ' · ' + esc(r.guestsText) : '');\n  return '<button class=\"item\" data-res=\"' + esc(r.id) + '\"><span class=\"bar\" style=\"background:' + srcColor(r.source) + '\"></span><span class=\"main\"><span class=\"spread\"><span class=\"t\">' +\n    esc(guestLabel(r)) + '</span>' + amt + '</span><span class=\"small muted\" style=\"display:block\">' + sub + '</span>' +\n    (badges ? '<span style=\"display:block;margin-top:4px\">' + badges + '</span>' : '') +\n    (r.sharedNote && !opts.noShared ? '<span class=\"small\" style=\"display:block;margin-top:4px\">💬 ' + esc(r.sharedNote) + '</span>' : '') + '</span></button>';\n}\nfunction noteCard(n) {\n  var who = n.author === 'manager' ? '<span class=\"badge\">' + esc(S.data.settings.managerLabel || 'Gestionnaire') + '</span>' : '';\n  var vis = isOwner() && n.author !== 'manager' ? (n.visible === '1' ? '<span class=\"badge direct\">Visible gestionnaire</span>' : '<span class=\"badge\">Privée</span>') : '';\n  return '<button class=\"item\" data-note=\"' + esc(n.id) + '\"><span class=\"bar\" style=\"background:var(--warn)\"></span><span class=\"main\"><span class=\"small muted\" style=\"display:block\">📝 ' +\n    fmtDate(n.date) + (n.endDate ? ' → ' + fmtDate(n.endDate) : '') + '</span><span style=\"display:block;white-space:pre-wrap\">' + esc(n.text) + '</span>' +\n    (who || vis ? '<span style=\"display:block;margin-top:4px\">' + who + vis + '</span>' : '') + '</span></button>';\n}\n\nfunction showDay(d) {\n  var res = S.data.reservations.filter(function (r) {\n    return r.hidden !== '1' && r.status !== 'cancelled' && (r.status !== 'blocked' || isOwner()) && (occupies(r, d) || r.checkout === d);\n  });\n  var notes = notesOn(d);\n  var canNote = isOwner() || S.data.settings.managerCanAddNotes;\n  var html = '<div class=\"spread\"><h3>' + fmtDate(d, true) + '</h3><button class=\"btn ghost small\" data-close>✕</button></div>';\n  if (!res.length && !notes.length) html += '<p class=\"muted\">Rien ce jour-là : logement libre.</p>';\n  res.forEach(function (r) {\n    var what = r.status === 'blocked' ? 'Fermé' : r.checkin === d ? 'Arrivée' : r.checkout === d ? 'Départ' : 'Séjour en cours';\n    html += '<div class=\"small muted\" style=\"margin-top:8px\">' + what + '</div>' + resCard(r);\n  });\n  notes.forEach(function (n) { html += noteCard(n); });\n  html += '<div class=\"actions\">' + (canNote ? '<button class=\"btn\" data-addnote>+ Note ce jour</button>' : '') +\n    (isOwner() ? '<button class=\"btn\" data-addres>+ Réservation</button>' : '') + '</div>';\n  openModal(html, function (m) {\n    m.querySelector('[data-close]').onclick = closeModal;\n    bindCommon(m);\n    var an = m.querySelector('[data-addnote]');\n    if (an) an.onclick = function () { editNote({ date: d, visible: '1' }); };\n    var ar = m.querySelector('[data-addres]');\n    if (ar) ar.onclick = function () { editReservation({ checkin: d, checkout: addDays(d, 1), source: 'direct', origin: 'manual', status: 'confirmed' }); };\n  });\n}\n\n// ----- planning -----\nfunction viewPlanning() {\n  var ym = S.month;\n  var res = S.data.reservations.filter(function (r) {\n    return r.hidden !== '1' && r.status !== 'blocked' && r.checkin && (monthOf(r.checkin) === ym || (r.checkout && monthOf(r.checkout) === ym) || (r.checkin < ym + '-01' && r.checkout > ym + '-31'));\n  });\n  var notes = S.data.notes.filter(function (n) { return monthOf(n.date) === ym || (n.endDate && n.date < ym + '-01' && n.endDate >= ym + '-01'); });\n  var html = banners() + '<div class=\"card\">' + calendarHtml() + '</div>';\n  html += '<div class=\"row\"><button class=\"btn primary\" id=\"addRes\">+ Réservation</button><button class=\"btn\" id=\"addNote\">+ Note</button></div>';\n  html += '<h2>En ' + monthTitle(ym) + '</h2>';\n  if (!res.length && !notes.length) html += '<div class=\"empty\">Aucune réservation ni note ce mois-ci.</div>';\n  html += res.map(function (r) { return resCard(r); }).join('') + notes.map(noteCard).join('');\n  return html;\n}\nfunction bindPlanning(root) {\n  bindCalendar(root);\n  $('#addRes', root).onclick = function () { var d = S.data.today; editReservation({ checkin: d, checkout: addDays(d, 1), source: 'direct', origin: 'manual', status: 'confirmed' }); };\n  $('#addNote', root).onclick = function () { editNote({ date: S.data.today, visible: '1' }); };\n}\n\n// ----- revenus -----\nfunction viewRevenus() {\n  var y = S.year;\n  var st = S.data.stats[y];\n  var years = Object.keys(S.data.stats).map(Number);\n  var html = banners() + '<div class=\"cal-head\"><button class=\"icon-btn\" id=\"yPrev\" aria-label=\"Année précédente\"' + (years.length && y <= Math.min.apply(null, years) ? ' disabled' : '') + '>‹</button><div class=\"title\">' + y +\n    '</div><button class=\"icon-btn\" id=\"yNext\" aria-label=\"Année suivante\">›</button></div>';\n  if (!st) return html + '<div class=\"empty\">Aucune réservation en ' + y + '.</div>';\n  var t = st.total;\n  var occ = t.days ? Math.round(t.nights / t.days * 100) : 0;\n  html += '<div class=\"kpis\"><div class=\"kpi\"><div class=\"v\">' + fmtMoney(t.revenue) + '</div><div class=\"l\">Revenu net ' + y + '</div></div>' +\n    '<div class=\"kpi\"><div class=\"v\">' + t.nights + '</div><div class=\"l\">Nuits louées</div></div>' +\n    '<div class=\"kpi\"><div class=\"v\">' + occ + ' %</div><div class=\"l\">Occupation</div></div>' +\n    '<div class=\"kpi\"><div class=\"v\">' + (t.nights ? fmtMoney(t.revenue / t.nights) : '—') + '</div><div class=\"l\">Net moyen / nuit</div></div></div>';\n  var bs = t.bySource;\n  html += '<div class=\"card\"><h3>Par plateforme</h3>' + ['airbnb', 'booking', 'direct'].map(function (k) {\n    return '<div class=\"spread\" style=\"padding:4px 0\"><span><i class=\"sw\" style=\"background:' + srcColor(k) + '\"></i>' + SRC[k] + '</span><b>' + fmtMoney(bs[k] || 0) + '</b></div>';\n  }).join('') + (t.missing ? '<p class=\"small\" style=\"color:var(--warn)\">⚠ ' + t.missing + ' réservation(s) sans montant : total incomplet.</p>' : '') +\n    (t.estimated ? '<p class=\"small muted\">Dont ' + fmtMoney(t.estimated) + ' estimés (séjours Booking pas encore facturés).</p>' : '') + '</div>';\n  html += bookingCard(y);\n  var max = Math.max.apply(null, st.months.map(function (m) { return m.revenue; })) || 1;\n  html += '<div class=\"card\"><h3>Par mois</h3><p class=\"help\" style=\"margin-top:-4px\">Montants nets (après commissions), répartis par nuit. Touche un mois pour voir ses réservations.</p>' +\n    st.months.map(function (m, i) {\n      return '<div class=\"mrow\" data-month=\"' + y + '-' + pad(i + 1) + '\"><span class=\"small\">' + MONTHS_S[i] + '</span><span><span class=\"mbar\"><i style=\"width:' + Math.round(m.revenue / max * 100) + '%\"></i></span>' +\n        '<span class=\"small muted\">' + m.nights + ' nuit' + (m.nights > 1 ? 's' : '') + ' · ' + Math.round(m.nights / m.days * 100) + ' %' + (m.missing ? ' · <span style=\"color:var(--warn)\">' + m.missing + ' à compléter</span>' : '') +\n        '</span></span><b class=\"small\">' + fmtMoney(m.revenue) + '</b></div>';\n    }).join('') + '</div>';\n  return html;\n}\nfunction bookingCard(y) {\n  var b = S.data.booking;\n  var inv = b.invoices.filter(function (i) { return i.periodEnd.slice(0, 4) === String(y); });\n  var src = b.rateSource === 'factures' ? 'taux réel de tes factures' : b.rateSource === 'réglage' ? 'fixé dans Réglages' : 'par défaut, en attendant une facture';\n  var html = '<div class=\"card\"><h3>Booking : factures lues</h3><p class=\"help\" style=\"margin-top:-4px\">Booking n\\'envoie pas le prix par e-mail. Chaque facture mensuelle (PDF reçu par e-mail) donne le net réel du mois, réparti entre les séjours partis ce mois-là. Les mois pas encore facturés sont estimés' +\n    (b.perNight ? ' à ' + fmtMoney(b.perNight) + ' net par nuit' : '') + '. Commission : ' + esc(String(b.ratePct).replace('.', ',')) + ' % (' + src + ').</p>';\n  if (!inv.length) return html + '<p class=\"small muted\">Aucune facture Booking pour ' + y + '.</p></div>';\n  return html + inv.map(function (i) {\n    var p = i.periodEnd.split('-');\n    return '<div class=\"spread small\" style=\"padding:5px 0;border-bottom:1px solid var(--line)\"><span>' + MONTHS[+p[1] - 1] + '<br><span class=\"muted\">ventes ' + fmtMoney(i.sales) + ' − frais ' + fmtMoney(i.fees) + '</span></span><b>' + fmtMoney(i.net) + '</b></div>';\n  }).join('') + '</div>';\n}\nfunction bindRevenus(root) {\n  var p = $('#yPrev', root), n = $('#yNext', root);\n  if (p) p.onclick = function () { S.year--; render(); };\n  if (n) n.onclick = function () { S.year++; render(); };\n  root.querySelectorAll('[data-month]').forEach(function (b) { b.onclick = function () { S.month = b.getAttribute('data-month'); S.tab = 'planning'; render(); window.scrollTo(0, 0); }; });\n}\n\n// ----- réservations -----\nfunction viewResas() {\n  var today = S.data.today;\n  var q = S.resQuery.trim().toLowerCase();\n  var list = S.data.reservations.filter(function (r) {\n    var v = S.resView;\n    if (v === 'hidden') { if (r.hidden !== '1') return false; } else if (r.hidden === '1') return false;\n    if (v === 'blocked') { if (r.status !== 'blocked') return false; } else if (v !== 'all' && r.status === 'blocked') return false;\n    if (v === 'upcoming' && (r.status === 'cancelled' || (r.checkout || r.checkin) < today)) return false;\n    if (v === 'past' && (r.status === 'cancelled' || (r.checkout || r.checkin) >= today)) return false;\n    if (v === 'cancelled' && r.status !== 'cancelled') return false;\n    if (v === 'missing' && !r.missingAmount) return false;\n    if (S.resSource && r.source !== S.resSource) return false;\n    if (q && (guestLabel(r) + ' ' + (r.code || '') + ' ' + (r.note || '') + ' ' + (r.sharedNote || '')).toLowerCase().indexOf(q) < 0) return false;\n    return true;\n  });\n  if (S.resView === 'past' || S.resView === 'cancelled') list = list.slice().reverse();\n  var views = [['upcoming', 'À venir'], ['past', 'Passées'], ['all', 'Toutes'], ['missing', 'Montant à saisir'], ['cancelled', 'Annulées'], ['blocked', 'Dates fermées'], ['hidden', 'Masquées']];\n  var html = banners() + '<div class=\"row\"><input type=\"text\" id=\"resQ\" placeholder=\"Rechercher…\" value=\"' + esc(S.resQuery) + '\" style=\"flex:1\"><button class=\"btn primary\" id=\"addRes2\">+ Réservation</button></div>' +\n    '<div class=\"seg\" style=\"margin-top:10px\">' + views.map(function (v) { return '<button data-view=\"' + v[0] + '\" class=\"' + (S.resView === v[0] ? 'on' : '') + '\">' + v[1] + '</button>'; }).join('') + '</div>' +\n    '<div class=\"seg\" style=\"margin-top:6px\">' + [['', 'Toutes plateformes'], ['airbnb', 'Airbnb'], ['booking', 'Booking'], ['direct', 'Direct']].map(function (v) {\n      return '<button data-src=\"' + v[0] + '\" class=\"' + (S.resSource === v[0] ? 'on' : '') + '\">' + v[1] + '</button>';\n    }).join('') + '</div>';\n  html += '<p class=\"small muted\">' + list.length + ' réservation(s)' + (list.length ? ' · total net ' + fmtMoney(list.reduce(function (s, r) { return s + (r.counted && r.net ? r.net : 0); }, 0)) : '') + '</p>';\n  if (!list.length) html += '<div class=\"empty\">' + (S.data.reservations.length ? 'Aucune réservation ne correspond.' : 'Aucune réservation pour l\\'instant. Lance une synchro (↻) ou ajoute une réservation directe.') + '</div>';\n  html += list.map(function (r) { return resCard(r); }).join('');\n  return html;\n}\nfunction bindResas(root) {\n  var qi = $('#resQ', root);\n  qi.oninput = function () {\n    S.resQuery = qi.value;\n    var pos = qi.selectionStart;\n    render();\n    var n = $('#resQ');\n    n.focus();\n    try { n.setSelectionRange(pos, pos); } catch (e) {}\n  };\n  root.querySelectorAll('[data-view]').forEach(function (b) { b.onclick = function () { S.resView = b.getAttribute('data-view'); render(); }; });\n  root.querySelectorAll('[data-src]').forEach(function (b) { b.onclick = function () { S.resSource = b.getAttribute('data-src'); render(); }; });\n  $('#addRes2', root).onclick = function () { var d = S.data.today; editReservation({ checkin: d, checkout: addDays(d, 1), source: 'direct', origin: 'manual', status: 'confirmed' }); };\n}\n\nfunction editReservation(r) {\n  var isNew = !r.id;\n  var manual = isNew || r.origin === 'manual';\n  var locked = r.lockedFields || [];\n  var src = r.source || 'direct';\n  var originTxt = r.origin === 'email' ? 'Lue dans les e-mails ' + (SRC[src] || '') + (r.code ? ' · code ' + esc(r.code) : '')\n    : r.origin === 'ical' ? 'Vue dans le calendrier ' + (SRC[src] || '') + ' (pas d\\'e-mail correspondant)' : 'Saisie à la main';\n  var html = '<div class=\"spread\"><h3>' + (isNew ? 'Nouvelle réservation' : esc(guestLabel(r))) + '</h3><button class=\"btn ghost small\" data-close>✕</button></div>' +\n    (isNew ? '' : '<p class=\"small muted\" style=\"margin-top:-4px\">' + originTxt + (locked.filter(function (f) { return f !== 'hidden'; }).length ? ' · modifiée à la main' : '') + '</p>') +\n    '<form id=\"resForm\">' +\n    (manual ? '<label class=\"f\"><span>Plateforme</span><select name=\"source\">' + ['direct', 'airbnb', 'booking'].map(function (k) { return '<option value=\"' + k + '\"' + (src === k ? ' selected' : '') + '>' + (k === 'direct' ? 'Direct (sans plateforme)' : SRC[k]) + '</option>'; }).join('') + '</select></label>' : '') +\n    '<label class=\"f\"><span>Voyageur</span><input type=\"text\" name=\"guest\" value=\"' + esc(r.guest || '') + '\" placeholder=\"Nom du voyageur\"></label>' +\n    '<div class=\"row\" style=\"flex-wrap:nowrap\"><label class=\"f\" style=\"flex:1\"><span>Arrivée</span><input type=\"date\" name=\"checkin\" required value=\"' + esc(r.checkin || '') + '\"></label>' +\n    '<label class=\"f\" style=\"flex:1\"><span>Départ</span><input type=\"date\" name=\"checkout\" value=\"' + esc(r.checkout || '') + '\"></label></div>' +\n    '<label class=\"f\"><span>Voyageurs</span><input type=\"text\" name=\"guestsText\" value=\"' + esc(r.guestsText || '') + '\" placeholder=\"ex. 2 adultes, 1 enfant\"></label>' +\n    '<label class=\"f\"><span>' + (src === 'airbnb' ? 'Montant net reçu (« Vous gagnez »)' : 'Montant net reçu (optionnel si prix client rempli)') + '</span><input type=\"text\" inputmode=\"decimal\" name=\"amountNet\" value=\"' + esc(r.amountNet || '') + '\" placeholder=\"ex. 399,41\"></label>' +\n    (src !== 'airbnb' ? '<label class=\"f\"><span>Prix payé par le client' + (src === 'booking' ? ' (net calculé avec ' + esc(String(S.data.booking.ratePct).replace('.', ',')) + ' % de commission)' : '') + '</span><input type=\"text\" inputmode=\"decimal\" name=\"amountGross\" value=\"' + esc(r.amountGross || '') + '\" placeholder=\"ex. 450\"></label>' : '') +\n    (r.paidByGuest ? '<p class=\"small muted\">Le voyageur a payé ' + fmtMoney(+r.paidByGuest) + ' au total (taxes comprises).</p>' : '') +\n    (r.amountKind === 'facture' ? '<p class=\"small muted\">Montant affiché : ≈ ' + fmtMoney(r.net) + ', part de la facture Booking du mois de départ (net réel réparti au prorata des nuits). Saisis le montant exact pour le remplacer.</p>' : '') +\n    (r.amountKind === 'estimé' ? '<p class=\"small muted\">Montant affiché : ≈ ' + fmtMoney(r.net) + ', estimé (net moyen par nuit de tes factures Booking) en attendant la facture du mois.</p>' : '') +\n    '<label class=\"f\"><span>Statut</span><select name=\"status\"><option value=\"confirmed\"' + (r.status !== 'cancelled' && r.status !== 'blocked' ? ' selected' : '') + '>Confirmée</option><option value=\"cancelled\"' + (r.status === 'cancelled' ? ' selected' : '') + '>Annulée</option>' +\n      '<option value=\"blocked\"' + (r.status === 'blocked' ? ' selected' : '') + '>Dates fermées (pas une réservation)</option></select></label>' +\n    (r.status === 'blocked' ? '<p class=\"small muted\">Booking a fermé ces dates sans e-mail de réservation : en général une fermeture. Si c\\'est une vraie réservation, choisis « Confirmée ».</p>' : '') +\n    '<label class=\"check\" id=\"keepRow\"' + (r.status === 'cancelled' ? '' : ' style=\"display:none\"') + '><input type=\"checkbox\" name=\"keepRevenue\"' + (r.keepRevenue === '1' ? ' checked' : '') + '><span>Annulée mais payée quand même (compter le montant dans mes revenus)</span></label>' +\n    '<label class=\"f\"><span>Note pour la gestionnaire (visible sur sa page)</span><textarea name=\"sharedNote\" placeholder=\"ex. arrivée tardive, lit bébé à préparer\">' + esc(r.sharedNote || '') + '</textarea></label>' +\n    '<label class=\"f\"><span>Note privée (visible par toi seul)</span><textarea name=\"note\">' + esc(r.note || '') + '</textarea></label>' +\n    '<div class=\"actions\"><button type=\"submit\" class=\"btn primary\" id=\"resSave\">' + (isNew ? 'Ajouter' : 'Enregistrer') + '</button></div>' +\n    (isNew ? '' : '<div class=\"actions\">' +\n      (r.hidden === '1' ? '<button type=\"button\" class=\"btn\" data-restore>Réafficher</button>'\n        : '<button type=\"button\" class=\"btn danger\" data-del>' + (manual ? 'Supprimer' : 'Masquer') + '</button>') +\n      (!manual && locked.filter(function (f) { return f !== 'hidden'; }).length ? '<button type=\"button\" class=\"btn\" data-reset>Revenir aux valeurs synchronisées</button>' : '') + '</div>') +\n    (!isNew && !manual ? '<p class=\"help\">Une réservation synchronisée ne peut pas être supprimée (elle reviendrait à la prochaine synchro) : « Masquer » la retire des écrans et des revenus.</p>' : '') +\n    '</form>';\n  openModal(html, function (m) {\n    m.querySelector('[data-close]').onclick = closeModal;\n    var f = m.querySelector('#resForm');\n    f.querySelector('[name=status]').onchange = function () { m.querySelector('#keepRow').style.display = this.value === 'cancelled' ? '' : 'none'; };\n    f.onsubmit = function (e) {\n      e.preventDefault();\n      var fd = new FormData(f);\n      var p = { id: r.id || '', source: fd.get('source') || src };\n      ['guest', 'checkin', 'checkout', 'guestsText', 'amountNet', 'amountGross', 'status', 'sharedNote', 'note'].forEach(function (k) { p[k] = fd.get(k) == null ? (r[k] || '') : fd.get(k); });\n      p.keepRevenue = !!fd.get('keepRevenue');\n      if (!p.checkin) { toast('Indique la date d\\'arrivée.', 'error'); return; }\n      if (p.checkout && p.checkout <= p.checkin) { toast('Le départ doit être après l\\'arrivée.', 'error'); return; }\n      act('saveReservation', p, isNew ? 'Réservation ajoutée' : 'Réservation enregistrée', m.querySelector('#resSave'));\n    };\n    var del = m.querySelector('[data-del]');\n    if (del) del.onclick = function () {\n      confirmDialog(manual ? 'Supprimer définitivement cette réservation ?' : 'Masquer cette réservation ? Elle disparaîtra du planning et des revenus (réversible dans Réservations › Masquées).', manual ? 'Supprimer' : 'Masquer', true).then(function (ok) {\n        if (ok) act('deleteReservation', { id: r.id }, manual ? 'Réservation supprimée' : 'Réservation masquée');\n      });\n    };\n    var rs = m.querySelector('[data-restore]');\n    if (rs) rs.onclick = function () { act('restoreReservation', { id: r.id }, 'Réservation réaffichée', rs); };\n    var rt = m.querySelector('[data-reset]');\n    if (rt) rt.onclick = function () {\n      confirmDialog('Effacer tes modifications sur cette réservation et reprendre les valeurs des e-mails et calendriers ?', 'Revenir aux valeurs synchronisées', true).then(function (ok) {\n        if (ok) act('resetReservation', { id: r.id }, 'Valeurs synchronisées rétablies');\n      });\n    };\n  });\n}\n\n// ----- notes -----\nfunction viewNotes() {\n  var today = S.data.today;\n  var list = S.data.notes.filter(function (n) {\n    var end = n.endDate || n.date;\n    if (S.noteView === 'upcoming') return end >= today;\n    if (S.noteView === 'past') return end < today;\n    if (S.noteView === 'manager') return n.author === 'manager';\n    return true;\n  }).sort(function (a, b) { return S.noteView === 'past' ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date); });\n  var views = [['upcoming', 'À venir'], ['past', 'Passées'], ['all', 'Toutes']];\n  if (isOwner()) views.push(['manager', 'De la gestionnaire']);\n  var html = '<div class=\"spread\"><h2 style=\"margin:6px 0\">Notes</h2><button class=\"btn primary\" id=\"addNote2\">+ Note</button></div>' +\n    '<div class=\"seg\">' + views.map(function (v) { return '<button data-nview=\"' + v[0] + '\" class=\"' + (S.noteView === v[0] ? 'on' : '') + '\">' + v[1] + '</button>'; }).join('') + '</div>';\n  if (!list.length) html += '<div class=\"empty\">Aucune note ici. Les notes s\\'affichent sur le planning (point orange).</div>';\n  return html + list.map(noteCard).join('');\n}\nfunction bindNotes(root) {\n  root.querySelectorAll('[data-nview]').forEach(function (b) { b.onclick = function () { S.noteView = b.getAttribute('data-nview'); render(); }; });\n  $('#addNote2', root).onclick = function () { editNote({ date: S.data.today, visible: '1' }); };\n}\nfunction editNote(n) {\n  var isNew = !n.id;\n  var mine = isOwner() ? true : n.author === 'manager';\n  var canEdit = isNew || (isOwner() ? true : (mine && S.data.settings.managerCanAddNotes));\n  var html = '<div class=\"spread\"><h3>' + (isNew ? 'Nouvelle note' : 'Note') + '</h3><button class=\"btn ghost small\" data-close>✕</button></div>';\n  if (!canEdit) {\n    html += '<p class=\"small muted\">' + fmtDate(n.date, true) + (n.endDate ? ' → ' + fmtDate(n.endDate, true) : '') + '</p><p style=\"white-space:pre-wrap\">' + esc(n.text) + '</p>';\n    return openModal(html, function (m) { m.querySelector('[data-close]').onclick = closeModal; });\n  }\n  html += '<form id=\"noteForm\"><div class=\"row\" style=\"flex-wrap:nowrap\"><label class=\"f\" style=\"flex:1\"><span>Date</span><input type=\"date\" name=\"date\" required value=\"' + esc(n.date || '') + '\"></label>' +\n    '<label class=\"f\" style=\"flex:1\"><span>Jusqu\\'au (optionnel)</span><input type=\"date\" name=\"endDate\" value=\"' + esc(n.endDate || '') + '\"></label></div>' +\n    '<label class=\"f\"><span>Texte</span><textarea name=\"text\" required placeholder=\"ex. Changer les draps, plombier à 14h, plus de café…\">' + esc(n.text || '') + '</textarea></label>' +\n    (isOwner() && n.author !== 'manager' ? '<label class=\"check\"><input type=\"checkbox\" name=\"visible\"' + (n.visible === '1' ? ' checked' : '') + '><span>Visible par la gestionnaire</span></label>' : '') +\n    (isOwner() && n.author === 'manager' ? '<p class=\"small muted\">Note écrite par la gestionnaire.</p>' : '') +\n    '<div class=\"actions\"><button type=\"submit\" class=\"btn primary\" id=\"noteSave\">' + (isNew ? 'Ajouter' : 'Enregistrer') + '</button></div>' +\n    (isNew ? '' : '<div class=\"actions\"><button type=\"button\" class=\"btn danger\" data-del>Supprimer</button></div>') + '</form>';\n  openModal(html, function (m) {\n    m.querySelector('[data-close]').onclick = closeModal;\n    var f = m.querySelector('#noteForm');\n    f.onsubmit = function (e) {\n      e.preventDefault();\n      var fd = new FormData(f);\n      var p = { id: n.id || '', date: fd.get('date'), endDate: fd.get('endDate') || '', text: fd.get('text') || '', visible: isOwner() ? (n.author === 'manager' ? true : !!fd.get('visible')) : true };\n      if (!p.text.trim()) { toast('La note est vide.', 'error'); return; }\n      if (p.endDate && p.endDate < p.date) { toast('La date de fin doit être après la date de début.', 'error'); return; }\n      act('saveNote', p, isNew ? 'Note ajoutée' : 'Note enregistrée', m.querySelector('#noteSave'));\n    };\n    var del = m.querySelector('[data-del]');\n    if (del) del.onclick = function () {\n      confirmDialog('Supprimer cette note ?', 'Supprimer', true).then(function (ok) { if (ok) act('deleteNote', { id: n.id }, 'Note supprimée'); });\n    };\n  });\n}\n\n// ----- réglages -----\nfunction viewSettings() {\n  var s = S.data.settings, d = S.data;\n  var chk = function (name, label, help) {\n    return '<label class=\"check\"><input type=\"checkbox\" name=\"' + name + '\"' + (s[name] ? ' checked' : '') + '><span>' + label + (help ? '<br><span class=\"help\">' + help + '</span>' : '') + '</span></label>';\n  };\n  var waText = encodeURIComponent('Voici le planning de l\\'appartement (à garder dans tes favoris) : ' + d.managerUrl);\n  return '<form id=\"setForm\">' +\n    '<div class=\"card\"><h3>Appartement</h3><label class=\"f\"><span>Nom affiché</span><input type=\"text\" name=\"apartmentName\" value=\"' + esc(s.apartmentName) + '\"></label>' +\n    '<div class=\"row\" style=\"flex-wrap:nowrap\"><label class=\"f\" style=\"flex:1\"><span>Heure d\\'arrivée</span><input type=\"time\" name=\"checkinTime\" value=\"' + esc(s.checkinTime) + '\"></label>' +\n    '<label class=\"f\" style=\"flex:1\"><span>Heure de départ</span><input type=\"time\" name=\"checkoutTime\" value=\"' + esc(s.checkoutTime) + '\"></label></div></div>' +\n    '<div class=\"card\"><h3>Calendriers (dates à jour)</h3>' +\n    '<label class=\"f\"><span>Lien calendrier Airbnb (.ics)</span><input type=\"url\" name=\"icalAirbnb\" value=\"' + esc(s.icalAirbnb) + '\" placeholder=\"https://www.airbnb.fr/calendar/ical/….ics?s=…\"></label>' +\n    '<label class=\"f\"><span>Lien calendrier Booking (.ics)</span><input type=\"url\" name=\"icalBooking\" value=\"' + esc(s.icalBooking) + '\" placeholder=\"https://ical.booking.com/v1/export?t=…\"></label>' +\n    '<details><summary>Où trouver ces liens ?</summary><div class=\"help\"><b>Airbnb</b> (appli ou site) :<ol><li>Annonces › ton logement › Disponibilités</li><li>« Associer des calendriers » (ou « Synchronisation des calendriers »)</li><li>« Exporter le calendrier » › copier le lien</li></ol>' +\n    '<b>Booking</b> (extranet admin.booking.com) :<ol><li>Tarifs et disponibilités › Synchroniser les calendriers</li><li>« Exporter le calendrier » › copier le lien</li></ol>Colle chaque lien ici puis Enregistrer : la synchro se lance toute seule.</div></details></div>' +\n    '<div class=\"card\"><h3>Revenus</h3><label class=\"f\"><span>Commission Booking totale (%)</span><input type=\"text\" inputmode=\"decimal\" name=\"bookingCommissionPct\" value=\"' + esc(String(s.bookingCommissionPct).replace('.', ',')) + '\" placeholder=\"Automatique\"></label>' +\n    '<p class=\"help\">Laisse vide : le taux réel (commission + frais de paiement) est calculé sur tes factures Booking' + (d.booking.rateSource === 'factures' ? ', actuellement ' + esc(String(d.booking.ratePct).replace('.', ',')) + ' %' : ' (17 % en attendant la première facture)') +\n    '. Il sert quand tu saisis le prix payé par un client Booking. Les montants Airbnb sont déjà nets.</p></div>' +\n    '<div class=\"card\"><h3>Synchronisation</h3><label class=\"f\"><span>Fréquence automatique</span><select name=\"syncEveryHours\">' + [1, 2, 4, 6, 12, 24].map(function (h) {\n      return '<option value=\"' + h + '\"' + (+s.syncEveryHours === h ? ' selected' : '') + '>' + (h === 24 ? 'Une fois par jour' : 'Toutes les ' + (h === 1 ? 'heures' : h + ' heures')) + '</option>';\n    }).join('') + '</select></label>' +\n    chk('emailScanEnabled', 'Lire mes e-mails Airbnb et Booking', 'Lecture seule. Crée les réservations et récupère les montants Airbnb.') +\n    '<p class=\"small\">Dernière synchro : ' + (d.lastSync ? esc(ago(d.lastSync.at)) + ' — ' + esc(d.lastSync.message) : 'jamais') + '</p>' +\n    '<button type=\"button\" class=\"btn\" id=\"syncBtn2\">↻ Synchroniser maintenant</button>' +\n    '<details><summary>Journal des synchros</summary>' + (d.log.length ? d.log.map(function (l) {\n      return '<p class=\"small\"><b>' + (l.ok === '1' ? '✓' : '⚠') + ' ' + esc(new Date(l.at).toLocaleString('fr-FR')) + '</b> (' + esc(l.kind) + ')<br>' + esc(l.message) + '</p>';\n    }).join('') : '<p class=\"small muted\">Vide.</p>') + '</details></div>' +\n    '<div class=\"card\"><h3>Page de la gestionnaire</h3><p class=\"help\">Elle voit le planning, les arrivées/départs et les notes que tu rends visibles. Jamais tes montants (filtré sur le serveur).</p>' +\n    '<label class=\"f\"><span>Nom affiché</span><input type=\"text\" name=\"managerLabel\" value=\"' + esc(s.managerLabel) + '\"></label>' +\n    chk('managerShowGuestName', 'Montrer le prénom du voyageur') + chk('managerShowGuestCount', 'Montrer le nombre de voyageurs') +\n    chk('managerCanAddNotes', 'Elle peut ajouter des notes', 'Ex. « plus de lessive ». Elle ne peut modifier que les siennes.') +\n    '<label class=\"f\"><span>Jours passés visibles</span><input type=\"number\" min=\"0\" max=\"365\" name=\"managerPastDays\" value=\"' + esc(s.managerPastDays) + '\"></label>' +\n    '<div class=\"linkbox\" id=\"mgrLink\">' + esc(d.managerUrl) + '</div><div class=\"row\">' +\n    '<button type=\"button\" class=\"btn small\" data-copy=\"' + esc(d.managerUrl) + '\">Copier le lien</button>' +\n    '<a class=\"btn small\" style=\"text-decoration:none\" target=\"_blank\" href=\"https://wa.me/?text=' + waText + '\">Envoyer par WhatsApp</a>' +\n    '<a class=\"btn small\" style=\"text-decoration:none\" target=\"_blank\" href=\"' + esc(d.managerUrl) + '\">Voir sa page</a>' +\n    (d.managerDirectUrl !== d.managerUrl ? '<button type=\"button\" class=\"btn small\" data-copy=\"' + esc(d.managerDirectUrl) + '\">Copier le lien direct</button>' : '') +\n    '<button type=\"button\" class=\"btn small danger\" id=\"regen\">Changer le lien</button></div></div>' +\n    '<div class=\"card\"><h3>Mon lien propriétaire</h3><p class=\"help\">À garder pour toi : il donne accès à tes revenus. Perdu ? Il est dans ton e-mail « Ton lien propriétaire ».</p>' +\n    '<div class=\"row\"><button type=\"button\" class=\"btn small\" data-copy=\"' + esc(d.ownerUrl) + '\">Copier mon lien</button>' +\n    (d.ownerDirectUrl !== d.ownerUrl ? '<button type=\"button\" class=\"btn small\" data-copy=\"' + esc(d.ownerDirectUrl) + '\">Copier le lien direct</button>' : '') + '</div></div>' +\n    '<div class=\"card\"><h3>Application installable</h3><label class=\"f\"><span>Adresse de l\\'application</span><input type=\"url\" name=\"appUrl\" value=\"' + esc(s.appUrl) + '\" placeholder=\"Vide = liens directs\"></label>' +\n    '<p class=\"help\">Les liens partagés passent par cette page pour qu\\'on puisse installer l\\'application depuis Chrome (menu ⋮ › Installer l\\'application). Vide : liens directs Google.</p></div>' +\n    '<div class=\"card\"><h3>Mes données</h3><p class=\"help\">Tout est stocké dans un Google Sheet de ton Drive (export, sauvegarde, filtres…).</p>' +\n    '<a class=\"btn small\" style=\"text-decoration:none\" target=\"_blank\" href=\"' + esc(d.sheetUrl) + '\">Ouvrir le Google Sheet</a>' +\n    '<p class=\"help\">Version ' + esc(d.version) + '</p></div>' +\n    '<div class=\"sticky-save\"><button type=\"submit\" class=\"btn primary\" style=\"width:100%\" id=\"setSave\">Enregistrer les réglages</button></div></form>';\n}\nfunction copyText(t) {\n  function fallback() {\n    var ta = document.createElement('textarea');\n    ta.value = t; document.body.appendChild(ta); ta.select();\n    var ok = false;\n    try { ok = document.execCommand('copy'); } catch (e) {}\n    document.body.removeChild(ta);\n    toast(ok ? 'Lien copié' : 'Copie impossible : appuie longuement sur le lien pour le copier', ok ? '' : 'error');\n  }\n  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function () { toast('Lien copié'); }, fallback);\n  else fallback();\n}\nfunction bindSettings(root) {\n  root.querySelectorAll('[data-copy]').forEach(function (b) { b.onclick = function () { copyText(b.getAttribute('data-copy')); }; });\n  $('#syncBtn2', root).onclick = function () { syncNow(this); };\n  $('#regen', root).onclick = function () {\n    confirmDialog('Changer le lien de la gestionnaire ? L\\'ancien lien ne marchera plus : il faudra lui envoyer le nouveau.', 'Changer le lien', true).then(function (ok) {\n      if (ok) act('regenerateManagerLink', {}, 'Nouveau lien créé : pense à l\\'envoyer');\n    });\n  };\n  var f = $('#setForm', root);\n  f.onsubmit = function (e) {\n    e.preventDefault();\n    var fd = new FormData(f);\n    var p = {};\n    ['apartmentName', 'checkinTime', 'checkoutTime', 'icalAirbnb', 'icalBooking', 'bookingCommissionPct', 'syncEveryHours', 'managerLabel', 'managerPastDays', 'appUrl'].forEach(function (k) { p[k] = (fd.get(k) || '').trim(); });\n    p.syncEveryHours = +p.syncEveryHours;\n    ['emailScanEnabled', 'managerShowGuestName', 'managerShowGuestCount', 'managerCanAddNotes'].forEach(function (k) { p[k] = !!fd.get(k); });\n    var before = S.data.settings;\n    var icalChanged = p.icalAirbnb !== before.icalAirbnb || p.icalBooking !== before.icalBooking || (p.emailScanEnabled && !before.emailScanEnabled);\n    act('saveSettings', p, 'Réglages enregistrés', $('#setSave')).then(function (ok) {\n      if (ok && icalChanged) syncNow($('#syncBtn'));\n    });\n  };\n}\n\n// ======== gestionnaire ========\nfunction renderManager(app) {\n  var d = S.data, s = d.settings, today = d.today;\n  var res = d.reservations;\n  var upcoming = res.filter(function (r) { return (r.checkout || r.checkin) >= today; });\n  var html = '<header class=\"top\"><h1>' + esc(s.apartmentName) + '</h1><span class=\"chip\">Planning</span>' +\n    '<button class=\"icon-btn\" id=\"reload\" title=\"Actualiser\" aria-label=\"Actualiser\">↻</button></header><div class=\"wrap\">';\n  html += '<div class=\"card\">' + calendarHtml() + '</div>';\n  html += '<h2>Prochains passages</h2>';\n  if (!upcoming.length) html += '<div class=\"empty\">Aucune réservation à venir.</div>';\n  upcoming.forEach(function (r) {\n    var next = res.filter(function (x) { return x.checkin === r.checkout; })[0];\n    html += '<div class=\"card\"><div class=\"spread\"><b>' + esc(r.guest || 'Voyageur') + '</b><span class=\"small muted\">' + (r.nights ? r.nights + ' nuit' + (r.nights > 1 ? 's' : '') : '') + '</span></div>' +\n      '<div class=\"small\">🟢 Arrivée ' + fmtDate(r.checkin) + ' à partir de ' + esc(s.checkinTime) + '</div>' +\n      '<div class=\"small\">🔴 Départ ' + (r.checkout ? fmtDate(r.checkout) + ' avant ' + esc(s.checkoutTime) : 'date à confirmer') + '</div>' +\n      (r.guestsText ? '<div class=\"small muted\">👥 ' + esc(r.guestsText) + '</div>' : '') +\n      (r.checkout ? '<div class=\"small\" style=\"margin-top:6px\"><b>🧹 Ménage ' + fmtDate(r.checkout) + ' après ' + esc(s.checkoutTime) + '</b>' +\n        (next ? ' — <span style=\"color:var(--err)\">nouvelle arrivée le même jour à ' + esc(s.checkinTime) + '</span>' : '') + '</div>' : '') +\n      (r.sharedNote ? '<div class=\"small\" style=\"margin-top:6px\">💬 ' + esc(r.sharedNote) + '</div>' : '') + '</div>';\n  });\n  var notes = d.notes.filter(function (n) { return (n.endDate || n.date) >= today; }).sort(function (a, b) { return a.date.localeCompare(b.date); });\n  html += '<div class=\"spread\"><h2>Notes</h2>' + (s.managerCanAddNotes ? '<button class=\"btn primary small\" id=\"mAddNote\">+ Note</button>' : '') + '</div>';\n  if (!notes.length) html += '<div class=\"empty\">Aucune note à venir.</div>';\n  html += notes.map(noteCard).join('');\n  html += '<p class=\"help\" style=\"text-align:center;margin-top:24px\">Touche un jour du calendrier pour le détail.</p></div>';\n  app.innerHTML = html;\n  bindCalendar(app);\n  bindCommon(app);\n  $('#reload').onclick = function () { var b = this; b.disabled = true; call('load').then(function (data) { S.data = data; render(); toast('Planning à jour'); }, function (e) { b.disabled = false; toast(cleanErr(e), 'error'); }); };\n  var an = $('#mAddNote');\n  if (an) an.onclick = function () { editNote({ date: today, author: 'manager' }); };\n}\nfunction showManagerRes(r) {\n  var s = S.data.settings;\n  openModal('<div class=\"spread\"><h3>' + esc(r.guest || 'Voyageur') + '</h3><button class=\"btn ghost small\" data-close>✕</button></div>' +\n    '<p>🟢 Arrivée ' + fmtDate(r.checkin, true) + ' à partir de ' + esc(s.checkinTime) + '<br>🔴 Départ ' + (r.checkout ? fmtDate(r.checkout, true) + ' avant ' + esc(s.checkoutTime) : 'à confirmer') + '</p>' +\n    (r.guestsText ? '<p>👥 ' + esc(r.guestsText) + '</p>' : '') + (r.sharedNote ? '<p>💬 ' + esc(r.sharedNote) + '</p>' : ''), function (m) {\n    m.querySelector('[data-close]').onclick = closeModal;\n  });\n}\n\nif (S.boot.mode === 'owner' || S.boot.mode === 'manager') load(); else render();\n})();\n</script>\n</body>\n</html>\n";
