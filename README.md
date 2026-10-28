# Mes quotas Antigravity

Extension pour [Antigravity IDE](https://antigravity.google/) qui affiche,
dans un seul panneau, le quota restant (par modèle : Claude, Gemini, GPT-OSS…)
de **plusieurs comptes Google** — sans jamais changer le compte actif de
l'IDE, et sans toucher au stockage d'un autre profil.

![plateforme](https://img.shields.io/badge/plateforme-Antigravity%20IDE-blue)
![licence](https://img.shields.io/badge/licence-MIT-green)

## Pourquoi

Antigravity a un plan gratuit généreux mais le quota se mesure **par compte
Google**. Si tu jongles entre plusieurs comptes pour répartir l'usage, il n'y
a pas de vue d'ensemble native. Cette extension comble ce manque.

## Fonctionnalités

- **Plusieurs comptes, un seul endroit.** Connecte autant de comptes Google
  que tu veux (chacun via sa propre autorisation OAuth) et vois leur quota
  côte à côte.
- **Panneau latéral** dans l'IDE, avec les modèles importants (Claude Opus,
  Claude Sonnet, Gemini Pro/Flash…) mis en avant, et les variantes
  secondaires (Lite, Image, preview) repliées sous « Autres modèles ».
- **Tableau de bord dans le navigateur**, accessible hors de l'IDE
  (`http://127.0.0.1:48173`, uniquement depuis la machine locale), avec un
  sélecteur « meilleur compte pour ce modèle » qui trie les comptes
  disponibles par quota restant.
- **Rafraîchissement automatique** toutes les 10 minutes, ou à la demande.
- Aucune dépendance externe, aucune télémétrie, aucun serveur tiers : les
  seules requêtes sortantes vont vers `accounts.google.com`,
  `oauth2.googleapis.com` et `cloudcode-pa.googleapis.com` (le service de
  quota qu'utilise l'IDE lui-même).

## Installation

1. Télécharge le `.vsix` depuis la [dernière
   release](../../releases/latest), ou compile-le toi-même (voir plus bas).
2. Dans Antigravity : `Extensions` → menu `...` → **Install from VSIX...**
3. Recharge la fenêtre si demandé.
4. Une icône apparaît dans la barre d'activité. Clique sur **+ Compte** pour
   connecter un premier compte Google ; répète pour les suivants.

## Comment ça marche

Pour chaque compte, l'extension :

1. Lit l'identifiant d'application OAuth qu'utilise Antigravity lui-même, en
   inspectant l'IDE installé localement (c'est un identifiant d'**app**
   public, pas un secret personnel).
2. Ouvre une connexion Google standard (OAuth + PKCE) dans le navigateur,
   avec le consentement explicite de l'utilisateur pour ce compte précis.
3. Stocke le jeton obtenu dans le coffre chiffré de l'IDE
   (`vscode.ExtensionContext.secrets`), séparé de tout autre profil.
4. Utilise ce jeton pour interroger directement le service de quota de
   Google (`cloudcode-pa.googleapis.com`, méthodes internes
   `loadCodeAssist` et `fetchAvailableModels`).

Elle ne lit **aucun fichier d'un autre profil** `--user-data-dir` et ne
contourne aucun chiffrement : chaque compte est connecté via sa propre
autorisation, comme le ferait n'importe quelle extension légitime.

## Compiler depuis les sources

```bash
npm install -g @vscode/vsce
vsce package --no-dependencies --allow-missing-repository --skip-license
```

Le fichier `.vsix` généré s'installe comme indiqué ci-dessus.

## Limites connues

- S'appuie sur des détails internes non documentés d'Antigravity (format de
  stockage de l'identifiant OAuth, format de réponse du service de quota).
  Une mise à jour de l'IDE peut casser l'extension ; dans ce cas, le panneau
  affiche un message d'erreur clair plutôt que de planter silencieusement.
- Si un compte n'a jamais terminé l'onboarding d'Antigravity, son quota ne
  peut pas être lu — ouvre l'IDE au moins une fois avec ce compte avant de
  le connecter ici.
- Le tableau de bord navigateur ne fonctionne que tant que l'instance
  Antigravity où l'extension est installée reste ouverte (même en
  arrière-plan), et uniquement depuis la machine locale (`127.0.0.1`).
- Faite pour un usage personnel : ne connecte que des comptes qui
  t'appartiennent.

## Licence

MIT — voir [LICENSE](LICENSE).
