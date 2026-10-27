// Range l'accès de mise à jour (connexion clasp limitée à script.projects +
// script.deployments) dans les propriétés privées de l'outil, puis vérifie
// tout de suite la mise à jour automatique. Supprime ~/.clasprc.json à la fin,
// quoi qu'il arrive : aucun secret ne reste dans le conteneur.
//
// Usage : node tools/set-updater-creds.js "<lien propriétaire>"
// Rien de secret n'est affiché.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const RC = path.join(os.homedir(), '.clasprc.json');

function readCreds() {
  const j = JSON.parse(fs.readFileSync(RC, 'utf8'));
  // clasp 3 : { tokens: { default: {...} } } ; clasp 2 : { token, oauth2ClientSettings }
  const t = (j.tokens && (j.tokens.default || Object.values(j.tokens)[0])) || null;
  if (t) return { client_id: t.client_id, client_secret: t.client_secret, refresh_token: t.refresh_token };
  return { client_id: j.oauth2ClientSettings.clientId, client_secret: j.oauth2ClientSettings.clientSecret, refresh_token: j.token.refresh_token };
}

(async () => {
  const url = process.argv[2];
  if (!url || !/k=/.test(url)) throw new Error('Donne le lien propriétaire en argument.');
  const creds = readCreds();
  const b = await chromium.launch();
  try {
    const p = await b.newPage({ viewport: { width: 390, height: 844 }, locale: 'fr-FR' });
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    let frame = null;
    for (let i = 0; i < 60 && !frame; i++) {
      for (const f of p.frames()) { try { if (await f.evaluate(() => typeof call === 'function' && !!(window.S && S.boot && S.boot.token))) frame = f; } catch (e) {} }
      if (!frame) await p.waitForTimeout(1000);
    }
    if (!frame) throw new Error('page propriétaire introuvable (lien faux ?)');
    const res = await frame.evaluate((c) => call('setUpdaterCreds', c).then(() => call('checkUpdate')).then(
      (d) => ({ ok: true, lastUpdate: d.lastUpdate }), (e) => ({ ok: false, error: String(e && e.message || e) })), creds);
    console.log(JSON.stringify(res, null, 2));
    if (!res.ok || !res.lastUpdate || !res.lastUpdate.ok) process.exitCode = 1;
  } finally {
    await b.close();
  }
})().catch((e) => { console.error('Échec : ' + e.message); process.exitCode = 1; })
  .finally(() => { try { fs.unlinkSync(RC); console.log('~/.clasprc.json supprimé'); } catch (e) {} });
