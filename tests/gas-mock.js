// Simulation minimale des services Google Apps Script utilisés par Code.gs,
// pour tester le serveur et l'interface sans compte Google.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', 'apps-script');

function formatDate(date, tz, fmt) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(date).reduce((o, p) => (o[p.type] = p.value, o), {});
  return fmt.replace('yyyy', parts.year).replace('MM', parts.month).replace('dd', parts.day);
}

function makeSheet(name) {
  const sh = {
    name, data: [], frozen: 0,
    getName: () => name,
    getRange(r, c, nr, nc) {
      return {
        setNumberFormat() { return this; },
        setValues(vals) {
          if (vals.length !== nr || vals.some(v => v.length !== nc)) throw new Error('setValues: dimensions incorrectes');
          for (let i = 0; i < nr; i++) {
            sh.data[r - 1 + i] = sh.data[r - 1 + i] || [];
            for (let j = 0; j < nc; j++) sh.data[r - 1 + i][c - 1 + j] = String(vals[i][j]);
          }
          return this;
        }
      };
    },
    getDataRange() {
      const width = Math.max(0, ...sh.data.map(r => (r || []).length));
      return { getDisplayValues: () => sh.data.length ? sh.data.map(r => Array.from({ length: width }, (_, i) => (r && r[i]) || '')) : [[]] };
    },
    getLastRow: () => sh.data.length,
    clearContents() { sh.data = []; return sh; },
    setFrozenRows(n) { sh.frozen = n; }
  };
  return sh;
}

function createEnv(opts) {
  opts = opts || {};
  const codeFile = opts.codeFile || path.join(ROOT, 'Code.gs');
  const props = {};
  const spreadsheets = {};
  const triggers = [];
  const mails = [];
  const fetchMap = opts.fetchMap || {};
  const gmail = { messages: opts.messages || [] };
  const logs = [];
  const drive = { n: 0, files: {}, deleted: 0, fail: false };
  const update = { github: {}, calls: [], apiDisabled: false, currentManifest: fs.readFileSync(path.join(ROOT, 'appsscript.json'), 'utf8') };

  const ctx = {
    console,
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = String(v); },
        deleteProperty: k => { delete props[k]; }
      })
    },
    SpreadsheetApp: {
      create(name) {
        const id = 'sheet_' + crypto.randomUUID();
        const sheets = [makeSheet('Sheet1')];
        const ss = {
          getId: () => id,
          getUrl: () => 'https://docs.google.com/spreadsheets/d/' + id,
          getSheetByName: n => sheets.find(s => s.name === n) || null,
          insertSheet(n) { const s = makeSheet(n); sheets.push(s); return s; },
          getSheets: () => sheets.slice(),
          deleteSheet(s) { sheets.splice(sheets.indexOf(s), 1); },
          _sheets: sheets, name
        };
        spreadsheets[id] = ss;
        return ss;
      },
      openById(id) { if (!spreadsheets[id]) throw new Error('not found'); return spreadsheets[id]; }
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      sleep: ms => { gmail.slept = (gmail.slept || 0) + ms; },
      formatDate,
      base64DecodeWebSafe: s => {
        // Comme Apps Script : refuse ce qui n'est pas du base64 valide.
        if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*={0,2}$/.test(s) || s.length % 4) throw new Error('Impossible de décoder la chaîne.');
        return Array.from(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
      },
      newBlob: x => ({
        getDataAsString: () => Buffer.from(x).toString('utf8'),
        getBytes: () => Array.from(Buffer.from(x, 'utf8'))
      })
    },
    Session: {
      getScriptTimeZone: () => 'Europe/Paris',
      getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' })
    },
    ScriptApp: {
      getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/TEST/exec' }),
      getOAuthToken: () => 'TOKEN',
      getScriptId: () => 'SCRIPT_ID',
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: t => { triggers.splice(triggers.indexOf(t), 1); },
      newTrigger(fn) {
        const t = { fn, every: null, getHandlerFunction: () => fn };
        const b = { timeBased: () => b, everyHours: h => { t.every = h + 'h'; return b; }, everyDays: d => { t.every = d + 'd'; return b; },
          atHour: h => { t.atHour = h; return b; }, create: () => { triggers.push(t); return t; } };
        return b;
      }
    },
    MailApp: { sendEmail: (to, subject, body) => mails.push({ to, subject, body }) },
    UrlFetchApp: {
      fetch(url, o) {
        o = o || {};
        // API Drive : conversion PDF → texte (on renvoie le contenu « PDF » envoyé).
        if (url.indexOf('https://www.googleapis.com/upload/drive/v3/files') === 0) {
          if (drive.fail) return { getResponseCode: () => 500, getContentText: () => 'err' };
          const raw = Buffer.from(o.payload).toString('utf8');
          if (!/multipart\/related; boundary=/.test(o.contentType) || o.headers.Authorization !== 'Bearer TOKEN') throw new Error('requête Drive invalide');
          const id = 'doc' + (++drive.n);
          drive.files[id] = raw.split('Content-Type: application/pdf\r\n\r\n')[1].split('\r\n--')[0];
          return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ id }) };
        }
        // Mise à jour : GitHub (branche stable) et API Apps Script.
        if (url.indexOf('https://raw.githubusercontent.com/') === 0) {
          const f = update.github[url.split('?')[0].replace(/^.*\/stable\//, '')];
          return f === undefined ? { getResponseCode: () => 404, getContentText: () => '404' } : { getResponseCode: () => 200, getContentText: () => f };
        }
        if (url.indexOf('https://script.googleapis.com/v1') === 0) {
          const call = { method: o.method || 'get', path: url.replace('https://script.googleapis.com/v1', ''), body: o.payload ? JSON.parse(o.payload) : null };
          update.calls.push(call);
          if (update.apiDisabled) return { getResponseCode: () => 403, getContentText: () => JSON.stringify({ error: { message: 'User has not enabled the Apps Script API. Enable it by visiting https://script.google.com/home/usersettings' } }) };
          let res = {};
          if (call.method === 'get' && /\/content$/.test(call.path)) res = { files: [{ name: 'Code2', type: 'SERVER_JS', source: '...' }, { name: 'appsscript', type: 'JSON', source: update.currentManifest }] };
          if (call.method === 'post' && /\/versions$/.test(call.path)) res = { versionNumber: 7 };
          return { getResponseCode: () => 200, getContentText: () => JSON.stringify(res) };
        }
        const dm = url.match(/^https:\/\/www\.googleapis\.com\/drive\/v3\/files\/([^/?]+)(\/export)?/);
        if (dm) {
          if (o.method === 'delete') { delete drive.files[dm[1]]; drive.deleted++; return { getResponseCode: () => 204, getContentText: () => '' }; }
          return { getResponseCode: () => 200, getContentText: () => drive.files[dm[1]] };
        }
        const f = fetchMap[url];
        if (!f) return { getResponseCode: () => 404, getContentText: () => 'Not found' };
        const r = typeof f === 'function' ? f() : f;
        return { getResponseCode: () => r.code || 200, getContentText: () => r.body };
      }
    },
    Gmail: {
      Users: {
        Messages: {
          list(user, o) {
            let msgs = gmail.messages.filter(m => /airbnb\.com|booking\.com/.test(m.from));
            if (/has:attachment/.test(o.q)) msgs = msgs.filter(m => m.attachment && /invoice|facture/i.test(m.subject));
            const after = (o.q.match(/after:(\d{4})\/(\d{2})\/(\d{2})/) || []);
            if (after.length) {
              const t = Date.UTC(+after[1], +after[2] - 1, +after[3]);
              msgs = msgs.filter(m => new Date(m.date).getTime() >= t);
            }
            return { messages: msgs.map(m => ({ id: m.id })) };
          },
          get(user, id, o) {
            gmail.gets = (gmail.gets || 0) + 1;
            if (gmail.quotaAfter !== undefined && gmail.gets > gmail.quotaAfter) {
              throw new Error("Échec de l'appel d'API vers gmail.users.messages.get avec l'erreur suivante : Quota exceeded for quota metric 'Total Query Cost' and limit 'Units per minute per user'");
            }
            const m = gmail.messages.find(x => x.id === id);
            const msg = {
              id, internalDate: String(new Date(m.date).getTime()),
              payload: { headers: [{ name: 'From', value: m.from }, { name: 'Subject', value: m.subject }] }
            };
            if (o.format === 'full') {
              msg.payload.mimeType = 'multipart/mixed';
              msg.payload.parts = [{ mimeType: 'multipart/alternative', parts: [
                // Comme le vrai service avancé : octets déjà décodés (sauf si le test demande du base64).
                { mimeType: 'text/plain', body: { data: gmail.base64Bodies ? Buffer.from(m.body || '').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : Array.from(Buffer.from(m.body || '')) } },
                { mimeType: 'text/html', body: { data: gmail.base64Bodies ? Buffer.from('<p>html</p>').toString('base64').replace(/\+/g, '-').replace(/\//g, '_') : Array.from(Buffer.from('<p>html</p>')) } }
              ] }];
              if (m.attachment) msg.payload.parts.push({ mimeType: 'application/pdf', filename: 'invoice-' + id + '.pdf', body: { attachmentId: 'att-' + id, size: 100 } });
            }
            return msg;
          },
          Attachments: {
            get(user, msgId, attId) {
              const m = gmail.messages.find(x => x.id === msgId);
              if (attId !== 'att-' + msgId) throw new Error('pièce jointe inconnue');
              return { data: gmail.base64Bodies ? Buffer.from(m.attachment).toString('base64').replace(/\+/g, '-').replace(/\//g, '_') : Array.from(Buffer.from(m.attachment)) };
            }
          }
        }
      }
    },
    HtmlService: {
      XFrameOptionsMode: { ALLOWALL: 'ALLOWALL', DEFAULT: 'DEFAULT' },
      createTemplate(src) { return this._tpl(() => src); },
      createTemplateFromFile(name) { return this._tpl(() => fs.readFileSync(path.join(ROOT, name + '.html'), 'utf8')); },
      _tpl(read) {
        const t = {
          evaluate() {
            const html = read().replace('<?!= bootJson ?>', t.bootJson);
            const out = { content: html, title: '', xfo: null, setTitle(x) { out.title = x; return out; }, addMetaTag() { return out; },
              setXFrameOptionsMode(m) { out.xfo = m; return out; }, getContent: () => html };
            return out;
          }
        };
        return t;
      }
    },
    Logger: { log: x => logs.push(x) }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(codeFile, 'utf8'), ctx, { filename: path.basename(codeFile) });
  // Les objets passent par JSON comme avec google.script.run.
  const json = x => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
  return {
    ctx, props, triggers, mails, fetchMap, gmail, logs, drive, update,
    api: (token, action, payload) => json(ctx.api(token, action, payload)),
    install: () => json(ctx.install()),
    sheet: name => { const ss = spreadsheets[props.sheetId]; return ss && ss.getSheetByName(name); }
  };
}

module.exports = { createEnv };
