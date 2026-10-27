// Fabrique dist/Code-complet.gs : Code.gs + la page Index.html intégrée.
// Un seul fichier à coller dans Apps Script (pratique depuis un téléphone).
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const code = fs.readFileSync(path.join(root, 'apps-script', 'Code.gs'), 'utf8');
const html = fs.readFileSync(path.join(root, 'apps-script', 'Index.html'), 'utf8');
const out = '// FICHIER GÉNÉRÉ par tools/build.js — ne pas modifier à la main.\n' +
  '// Colle ce fichier entier dans Apps Script (il remplace Code.gs ET Index.html).\n\n' +
  code + '\n\n// Page de l\'application (copie de apps-script/Index.html).\nvar INDEX_HTML_ = ' + JSON.stringify(html) + ';\n';
fs.writeFileSync(path.join(root, 'dist', 'Code-complet.gs'), out);
console.log('dist/Code-complet.gs : ' + Math.round(out.length / 1024) + ' Ko');
