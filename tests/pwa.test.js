// Vérifie que la page « application » (docs/) est installable par Chrome et
// qu'elle affiche bien l'application Apps Script dans son cadre.
'use strict';
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { createEnv } = require('./gas-mock');

const DOCS = path.join(__dirname, '..', 'docs');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };

async function main() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]).replace(/^\/Gestion-Airbnb-Booking/, '');
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(DOCS, p);
    if (!f.startsWith(DOCS) || !fs.existsSync(f)) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  }).listen(0);
  const port = server.address().port;
  const BASE = `http://localhost:${port}/Gestion-Airbnb-Booking/`;

  const env = createEnv();
  const { directUrl } = env.install();
  const token = directUrl.split('k=')[1];
  const SHIM = fs.readFileSync(path.join(__dirname, 'ui.test.js'), 'utf8').match(/const SHIM = `([\s\S]*?)`;/)[1];

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const errors = [];
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.exposeFunction('__gas', (fn, argsJson) => {
    try { return JSON.stringify({ value: env.api.apply(null, JSON.parse(argsJson)) }); } catch (e) { return JSON.stringify({ error: e.message }); }
  });
  // L'application Apps Script, servie comme le ferait Google.
  await ctx.route('https://script.google.com/**', route => {
    const k = new URL(route.request().url()).searchParams.get('k');
    const html = env.ctx.doGet({ parameter: { k } }).getContent().replace('<head>', '<head>' + SHIM);
    route.fulfill({ status: 200, contentType: 'text/html', body: html });
  });

  // 1. Sans lien : message clair
  await page.goto(BASE);
  assert.match(await page.textContent('body'), /Ouvre le lien d'accès/);

  // 2. Critères d'installation Chrome
  await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller !== undefined);
  await page.evaluate(() => navigator.serviceWorker.ready);
  const cdp = await ctx.newCDPSession(page);
  const manifest = await cdp.send('Page.getAppManifest');
  assert.deepEqual(manifest.errors, [], 'manifeste sans erreur');
  const inst = await cdp.send('Page.getInstallabilityErrors');
  console.log('Erreurs d\'installabilité :', JSON.stringify(inst.installabilityErrors));
  assert.deepEqual(inst.installabilityErrors, [], 'installable');

  // 3. Lien reçu → application affichée, lien mémorisé, # retiré de l'adresse
  await page.goto(BASE + '#' + directUrl);
  const frame = await (await page.waitForSelector('iframe')).contentFrame();
  await frame.waitForSelector('.cal', { timeout: 10000 });
  assert.equal(page.url(), BASE, 'la clé ne reste pas dans la barre d’adresse');
  // 4. Relance depuis l'écran d'accueil (sans #) : toujours connecté
  await page.goto(BASE);
  const frame2 = await (await page.waitForSelector('iframe')).contentFrame();
  await frame2.waitForSelector('.cal', { timeout: 10000 });
  // 4b. Partage Android « Partager › Gestion location » : POST multipart vers ./share (share_target),
  // le service worker garde le fichier, la page le passe à l'application, qui demande confirmation.
  const mf = JSON.parse(fs.readFileSync(path.join(DOCS, 'manifest.webmanifest'), 'utf8'));
  assert.equal(mf.share_target.action, './share');
  assert.equal(mf.share_target.params.files[0].name, 'file');
  const settings = JSON.parse(env.props.settings);
  settings.appUrl = BASE; // adresse de l'application installable (ici le serveur de test)
  env.props.settings = JSON.stringify(settings);
  const bx = require('./fixtures/booking-export');
  await page.evaluate(() => {
    const f = document.createElement('form');
    f.id = 'shareForm'; f.method = 'POST'; f.action = 'share'; f.enctype = 'multipart/form-data';
    const i = document.createElement('input');
    i.type = 'file'; i.name = 'file'; i.id = 'shareIn';
    f.appendChild(i);
    document.body.appendChild(f);
  });
  await page.setInputFiles('#shareIn', { name: 'export-booking.csv', mimeType: 'text/csv', buffer: Buffer.from(bx.csv(), 'utf8') });
  await Promise.all([page.waitForNavigation(), page.evaluate(() => document.getElementById('shareForm').submit())]);
  const frame3 = await (await page.waitForSelector('iframe')).contentFrame();
  await frame3.waitForSelector('.modal:has-text("Importer « export-booking.csv »")', { timeout: 10000 });
  assert.equal(page.url(), BASE, 'adresse propre après le partage');
  if (await page.isVisible('#install')) await page.click('#installNo'); // bandeau « Installer » (selon le navigateur)
  await frame3.click('[data-a=yes]');
  await frame3.waitForFunction(() => /Import : 8 nouvelle/.test((document.querySelector('#toast') || {}).textContent || ''), null, { timeout: 10000 });
  assert.match(await frame3.textContent('#importLast'), /export-booking\.csv/);
  assert.equal(await page.evaluate(() => caches.open('gl-share').then(c => c.keys()).then(k => k.length)), 0, 'fichier partagé effacé après usage');

  // 5. Lien invalide refusé (pas d'iframe vers un site arbitraire)
  const p2 = await (await browser.newContext()).newPage();
  await p2.goto(BASE + '#https://evil.example/exec?k=' + token);
  assert.match(await p2.textContent('body'), /pas valide/);
  assert.equal(await p2.$('iframe'), null);

  await page.screenshot({ path: path.join(process.env.SHOTS || __dirname, 'pwa.png') });
  await browser.close();
  server.close();
  assert.deepEqual(errors, []);
  console.log('PWA OK');
}
main().catch(e => { console.error(e); process.exit(1); });
