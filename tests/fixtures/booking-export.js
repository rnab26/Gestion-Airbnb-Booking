// Relevé des réservations Booking (extranet › Réservations › Télécharger › « Télécharger le relevé
// de réservations ») : données INVENTÉES, même structure que le vrai fichier relevé le 22 nov. 2026
// (Excel 97-2003 .xls, 26 colonnes, en-têtes exacts y compris « Arrivée&nbsp; », numéros en nombres,
// dates en texte, « 667.8 EUR », commissions à 4 décimales, pays en code ISO, téléphone vide).
// Le vrai fichier de Raphaël n'est jamais versionné (données privées).
'use strict';
const zlib = require('zlib');

const HEADER = ['Numéro de réservation', 'Réservé par', 'Nom du client', 'Arrivée&nbsp;', 'Départ&nbsp;', 'Réservé le', 'Statut',
  'Hébergements', 'Personnes', 'Adultes', 'Enfants', 'Âges des enfants', 'Tarif', '% comm.', 'Montant de la commission',
  'Statut du paiement', 'Moyen de paiement (prestataire de paiement)', 'Remarques', 'Booker country', 'Motif du voyage',
  'Appareil', "Type d'hébergement", 'Durée (nuits)', "Date d'annulation", 'Adresse', 'Numéro de téléphone'];

// [numéro, réservé par, client, arrivée, départ, statut, personnes, adultes, enfants, tarif, commission, pays, annulée le]
const ROWS = [
  [7100000103, 'Durand, Paul', 'Paul Durand', '2026-09-28', '2026-10-01', 'ok', 2, 2, 0, '300 EUR', '51.0000 EUR', 'fr', ''],
  [7100000101, 'Martin, Claire', 'Claire Martin', '2026-10-01', '2026-10-04', 'ok', 3, 2, 1, '400 EUR', '68 EUR', 'fr', ''],
  [7100000102, 'Rossi, Marco', 'Marco Rossi', '2026-10-06', '2026-10-11', 'ok', 2, 2, 0, '650.35 EUR', '110.5595 EUR', 'it', ''],
  [7100000104, 'Weber, Anna', 'Anna Weber', '2026-10-20', '2026-10-24', 'cancelled_by_guest', 1, 1, 0, '120 EUR', '20.4 EUR', 'de', '2026-10-15 09:12:00'],
  [7100000001, 'Bernard, Lucas', 'Lucas Bernard', '2026-11-04', '2026-11-07', 'ok', 2, 2, 0, '360 EUR', '61.2000 EUR', 'be', ''],
  [7100000002, 'Petit, Léa', 'Léa Petit', '2026-11-21', '2026-11-23', 'cancelled_by_guest', 2, 2, 0, '0 EUR', '', 'fr', '2026-10-27 07:14:24'],
  [7100000003, 'Moreau, Hugo', 'Hugo Moreau', '2026-11-15', '2026-11-18', 'ok', 4, 2, 2, '480 EUR', '81.6 EUR', 'ch', ''],
  [7100000106, 'Cohen, David', 'David Cohen', '2026-12-20', '2026-12-23', 'ok', 2, 2, 0, '500 EUR', '85.0000 EUR', 'il', '']
];

// Facture Booking d'octobre 2026 correspondant au relevé (départs d'octobre, annulation facturée comprise).
const OCTOBER_INVOICE = { number: '1670000010', periodStart: '2026-10-01', periodEnd: '2026-10-31', sales: '1470.35', commission: '249.96', paymentFees: '19.11', total: '269.07', emailId: 'x', readAt: '2026-11-03T08:00:00Z' };

function table() {
  return [HEADER].concat(ROWS.map(r => [r[0], r[1], r[2], r[3], r[4], '2026-09-01 10:00:00', r[5], 1, r[6], r[7], r[8], r[8] ? '7' : '',
    r[9], 17, r[10], r[10] ? 'Paiement par Booking.com' : '', '', '', r[11], 'Loisirs', 'Mobile', 'Appartement-1 Chambre', 3, r[12], '', '']));
}

function csv(rows, sep) {
  sep = sep || ';';
  return (rows || table()).map(r => r.map(v => {
    const s = String(v);
    return /["\n;,]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(sep)).join('\r\n') + '\r\n';
}

// ---------- Excel 97-2003 (.xls) : classeur BIFF8 dans un fichier composé OLE ----------
function rec(type, data) { const h = Buffer.alloc(4); h.writeUInt16LE(type, 0); h.writeUInt16LE(data.length, 2); return Buffer.concat([h, data]); }
function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; }
function f64(n) { const b = Buffer.alloc(8); b.writeDoubleLE(n); return b; }

// sstMax : taille maximale des enregistrements SST/CONTINUE (8224 dans Excel ; plus petit pour tester les coupures).
function xls(rows, opts) {
  rows = rows || table();
  const sstMax = (opts && opts.sstMax) || 8224;
  const strings = [], idx = {};
  rows.forEach(r => r.forEach(v => { if (typeof v === 'string' && v !== '' && !(v in idx)) { idx[v] = strings.length; strings.push(v); } }));
  // SST : textes en UTF-16 (drapeau 1) ; un texte coupé reprend dans CONTINUE avec son drapeau répété.
  const sstRecs = [];
  let cur = [Buffer.concat([u32(strings.length), u32(strings.length)])], curLen = 8;
  function flush(type) { sstRecs.push({ type, data: Buffer.concat(cur) }); cur = []; curLen = 0; }
  let type = 0x00FC;
  strings.forEach(s => {
    if (curLen + 3 + 2 > sstMax) { flush(type); type = 0x003C; }
    cur.push(Buffer.concat([u16(s.length), Buffer.from([1])])); curLen += 3;
    let chars = Buffer.from(s, 'utf16le');
    while (chars.length) {
      const room = Math.floor((sstMax - curLen) / 2) * 2;
      if (room <= 0) { flush(type); type = 0x003C; cur.push(Buffer.from([1])); curLen = 1; continue; }
      const part = chars.subarray(0, room);
      cur.push(part); curLen += part.length; chars = chars.subarray(part.length);
      if (chars.length) { flush(type); type = 0x003C; cur.push(Buffer.from([1])); curLen = 1; }
    }
  });
  flush(type);
  const sheetName = Buffer.from('Réservations', 'latin1');
  const bof = dt => rec(0x0809, Buffer.concat([u16(0x0600), u16(dt), u16(0x0DBB), u16(0x07CC), u32(0), u32(6)]));
  const boundsheet = off => rec(0x0085, Buffer.concat([u32(off), Buffer.from([0, 0, sheetName.length, 0]), sheetName]));
  const globalsHead = bof(0x0005);
  const sst = Buffer.concat(sstRecs.map(r => rec(r.type, r.data)));
  const globalsLen = globalsHead.length + boundsheet(0).length + sst.length + 4;
  const globals = Buffer.concat([globalsHead, boundsheet(globalsLen), sst, rec(0x000A, Buffer.alloc(0))]);
  const cells = [];
  rows.forEach((r, ri) => r.forEach((v, ci) => {
    const pos = Buffer.concat([u16(ri), u16(ci), u16(15)]);
    if (typeof v === 'number') {
      // Petits entiers en RK (comme Excel), grands nombres en NUMBER.
      if (Number.isInteger(v) && Math.abs(v) < 2 ** 29) cells.push(rec(0x027E, Buffer.concat([pos, u32(((v << 2) | 2) >>> 0)])));
      else cells.push(rec(0x0203, Buffer.concat([pos, f64(v)])));
    } else if (v !== '') cells.push(rec(0x00FD, Buffer.concat([pos, u32(idx[v])])));
  }));
  let wb = Buffer.concat([globals, bof(0x0010), Buffer.concat(cells), rec(0x000A, Buffer.alloc(0))]);
  if (wb.length < 4096) wb = Buffer.concat([wb, Buffer.alloc(4096 - wb.length)]); // flux « normal », pas le mini-flux
  return cfb('Workbook', wb);
}

function cfb(name, data) {
  const SS = 512, END = 0xFFFFFFFE, FREE = 0xFFFFFFFF, FATSECT = 0xFFFFFFFD, NOSTREAM = 0xFFFFFFFF;
  const dataSecs = Math.ceil(data.length / SS);
  const dirSec = dataSecs;
  let fatSecs = 1;
  while ((dataSecs + 1 + fatSecs) > fatSecs * (SS / 4)) fatSecs++;
  const total = dataSecs + 1 + fatSecs;
  const fat = Buffer.alloc(fatSecs * SS, 0xFF);
  for (let i = 0; i < dataSecs; i++) fat.writeUInt32LE(i === dataSecs - 1 ? END : i + 1, i * 4);
  fat.writeUInt32LE(END, dirSec * 4);
  for (let i = 0; i < fatSecs; i++) fat.writeUInt32LE(FATSECT, (dirSec + 1 + i) * 4);
  const h = Buffer.alloc(512, 0);
  Buffer.from('d0cf11e0a1b11ae1', 'hex').copy(h, 0);
  h.writeUInt16LE(0x003E, 24); h.writeUInt16LE(3, 26); h.writeUInt16LE(0xFFFE, 28); h.writeUInt16LE(9, 30); h.writeUInt16LE(6, 32);
  h.writeUInt32LE(fatSecs, 44); h.writeUInt32LE(dirSec, 48); h.writeUInt32LE(4096, 56);
  h.writeUInt32LE(END, 60); h.writeUInt32LE(0, 64); h.writeUInt32LE(END, 68); h.writeUInt32LE(0, 72);
  for (let i = 0; i < 109; i++) h.writeUInt32LE(i < fatSecs ? dirSec + 1 + i : FREE, 76 + i * 4);
  const dir = Buffer.alloc(SS, 0);
  function entry(i, nm, type, child, start, size) {
    const o = i * 128, n = Buffer.from(nm + '\0', 'utf16le');
    n.copy(dir, o); dir.writeUInt16LE(n.length, o + 64); dir[o + 66] = type; dir[o + 67] = 1;
    dir.writeUInt32LE(NOSTREAM, o + 68); dir.writeUInt32LE(NOSTREAM, o + 72); dir.writeUInt32LE(child, o + 76);
    dir.writeUInt32LE(start, o + 116); dir.writeUInt32LE(size, o + 120);
  }
  entry(0, 'Root Entry', 5, 1, END, 0);
  entry(1, name, 2, NOSTREAM, 0, data.length);
  for (let i = 2; i < 4; i++) { dir.writeUInt32LE(NOSTREAM, i * 128 + 68); dir.writeUInt32LE(NOSTREAM, i * 128 + 72); dir.writeUInt32LE(NOSTREAM, i * 128 + 76); }
  const body = Buffer.alloc(dataSecs * SS, 0);
  data.copy(body, 0);
  return Buffer.concat([h, body, dir, fat]).subarray(0, 512 + total * SS);
}

// ---------- Excel (.xlsx) minimal : zip de fichiers XML ----------
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function colName(i) { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }

function xlsx(rows) {
  rows = rows || table();
  const shared = [], idx = {};
  const sheetRows = rows.map((r, ri) => '<row r="' + (ri + 1) + '">' + r.map((v, ci) => {
    const ref = colName(ci) + (ri + 1);
    if (typeof v === 'number') return '<c r="' + ref + '"><v>' + v + '</v></c>';
    if (v === '') return '';
    if (!(v in idx)) { idx[v] = shared.length; shared.push(v); }
    return '<c r="' + ref + '" t="s"><v>' + idx[v] + '</v></c>';
  }).join('') + '</row>').join('');
  const files = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>',
    'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Réservations" sheetId="1" r:id="rId3"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="x/styles" Target="styles.xml"/><Relationship Id="rId3" Type="x/worksheet" Target="worksheets/feuille.xml"/></Relationships>',
    'xl/worksheets/feuille.xml': '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="1" width="12"/></cols><sheetData>' + sheetRows + '</sheetData></worksheet>',
    'xl/sharedStrings.xml': '<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="' + shared.length + '">' +
      shared.map(s => '<si><t xml:space="preserve">' + esc(s) + '</t></si>').join('') + '</sst>'
  };
  return zip(files);
}

function zip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  Object.keys(files).forEach(name => {
    const data = Buffer.from(files[name], 'utf8');
    const comp = zlib.deflateRawSync(data);
    const crc = zlib.crc32(data);
    const nameBuf = Buffer.from(name, 'utf8');
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nameBuf.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);
    locals.push(lh, nameBuf, comp);
    centrals.push(ch, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  });
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat(locals.concat([cd, end]));
}

const b64 = x => Buffer.from(x).toString('base64');

module.exports = { HEADER, ROWS, OCTOBER_INVOICE, table, csv, xls, xlsx, b64 };
