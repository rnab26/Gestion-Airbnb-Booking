# Installation en production (27 oct. 2026)

Installé par une session Claude Code via clasp (`@google/clasp@3.0.6-alpha`),
avec l'accord de Raphaël, à partir de la branche `ccr-f525f83b-nw0ibz` (commit 16f9936).

- Compte Google : celui de Raphaël (reçoit les e-mails Airbnb/Booking)
- Projet Apps Script « Gestion location » :
  https://script.google.com/d/1hA9RPoVVSAHGEheOkHj1ySMQh-KWAqQWhwKYTPrf7o-6PCzgyCUUvHFT/edit
- Déploiement versionné v1 (URL stable, à réutiliser pour les mises à jour) :
  `AKfycbyYaDGa9_Ar_mO4H81iV1HQeLr7_QrzulSTwZnxh22xi3gD1_hWZiMrng10QGK1CQ03`
  https://script.google.com/macros/s/AKfycbyYaDGa9_Ar_mO4H81iV1HQeLr7_QrzulSTwZnxh22xi3gD1_hWZiMrng10QGK1CQ03/exec

## Mettre à jour (sans changer l'URL)

```
clasp push --force
clasp update-deployment AKfycbyYaDGa9_Ar_mO4H81iV1HQeLr7_QrzulSTwZnxh22xi3gD1_hWZiMrng10QGK1CQ03 --description "vN"
```

Nécessite un `clasp login` de Raphaël (jeton jamais versionné, supprimé en fin de session).

## État

- [x] Projet créé, 3 fichiers poussés, déploiement Application Web (exécuter en tant que moi, accès tout le monde)
- [ ] Première autorisation par Raphaël + clic « Installer » (avant ça, l'URL répond 403 aux visiteurs anonymes)
- [ ] Jeton clasp supprimé du conteneur
