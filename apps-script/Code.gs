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

var APP_VERSION = '1.1.3'; // à augmenter à chaque changement : c'est ce que compare la mise à jour automatique

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
  autoUpdateEnabled: true,
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
    version: APP_VERSION,
    lastUpdate: JSON.parse(props.getProperty('lastUpdate') || 'null')
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
  next.autoUpdateEnabled = !!p.autoUpdateEnabled;
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
      status.message = 'Déjà à jour (version ' + APP_VERSION + ').';
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
    status.message = /has not been used|disabled|not enabled|SERVICE_DISABLED|User has not enabled/i.test(msg)
      ? 'Active « API Google Apps Script » sur https://script.google.com/home/usersettings (une seule fois) pour les mises à jour automatiques.'
      : 'Mise à jour impossible : ' + msg;
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

function scriptApi_(method, path, body) {
  var o = { method: method, muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } };
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

// Relecture complète demandée une fois par ces versions (ex. 1.1.2 : la 1.0 avait marqué
// comme lus des e-mails qu'elle n'avait pas su décoder).
var EMAIL_RESCAN_VERSION = '1.1.2';

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
