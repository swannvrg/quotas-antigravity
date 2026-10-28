const vscode = require('vscode');
const http = require('node:http');
const fs = require('node:fs');
const { lireConfigOAuthDeLIDE, connecterUnCompte, rafraichirJeton } = require('./googleAuth.js');
const { recupererQuota } = require('./quota.js');

const CLE_COMPTES = 'mesQuotas.comptes.v1';
const PORT_PREFERE = 48173;

function activate(context) {
  let config = null; // config OAuth de l'IDE, lue une seule fois
  let vueWebview = null;
  let rafraichissementEnCours = false;
  let serveur = null;
  let urlServeur = null;
  let itemBarreStatut = null;

  async function config_() {
    if (!config) config = lireConfigOAuthDeLIDE(vscode.env.appRoot);
    return config;
  }

  async function lireComptes() {
    const brut = await context.secrets.get(CLE_COMPTES);
    return brut ? JSON.parse(brut) : [];
  }
  async function ecrireComptes(comptes) {
    await context.secrets.store(CLE_COMPTES, JSON.stringify(comptes));
  }

  // Forme commune envoyée à la barre latérale ET au serveur local.
  async function etatActuel() {
    const comptes = await lireComptes();
    return {
      comptes: comptes.map(c => ({
        email: c.email, nom: c.nom, palier: c.dernierPalier || null,
        modeles: c.dernierQuota || null, erreur: c.derniereErreur || null,
        verifieLe: c.verifieLe || null
      }))
    };
  }

  async function pousserVersVue() {
    if (!vueWebview) return;
    vueWebview.webview.postMessage({ type: 'etat', ...(await etatActuel()) });
  }

  // Rafraîchit le quota d'UN compte, met à jour le stockage, renvoie le compte à jour.
  async function rafraichirUnCompte(compte, cfg) {
    try {
      const jetonAJour = await rafraichirJeton(compte, cfg);
      const { palier, modeles } = await recupererQuota(jetonAJour.accessToken, cfg.version);
      return { ...jetonAJour, dernierPalier: palier, dernierQuota: modeles, derniereErreur: null, verifieLe: new Date().toISOString() };
    } catch (e) {
      return { ...compte, derniereErreur: e.message || String(e), verifieLe: new Date().toISOString() };
    }
  }

  async function rafraichirTout(afficherProgres) {
    if (rafraichissementEnCours) return;
    rafraichissementEnCours = true;
    try {
      const cfg = await config_();
      const comptes = await lireComptes();
      if (comptes.length === 0) { await pousserVersVue(); return; }
      const run = async () => {
        const maj = await Promise.all(comptes.map(c => rafraichirUnCompte(c, cfg)));
        await ecrireComptes(maj);
        await pousserVersVue();
      };
      if (afficherProgres) {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'Mes quotas : vérification en cours…' },
          run
        );
      } else {
        await run();
      }
    } catch (e) {
      vscode.window.showErrorMessage(`Mes quotas : ${e.message || e}`);
    } finally {
      rafraichissementEnCours = false;
    }
  }

  async function connecterCompte() {
    try {
      const cfg = await config_();
      const comptes = await lireComptes();
      if (comptes.length >= 8) {
        vscode.window.showWarningMessage('8 comptes déjà connectés, ça devrait suffire. Déconnecte-en un avant d’en ajouter.');
        return;
      }
      const nouveau = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Connexion Google dans le navigateur…', cancellable: true },
        (progress, cancellation) => connecterUnCompte(cfg, url => vscode.env.openExternal(vscode.Uri.parse(url)))
      );
      if (comptes.some(c => c.email === nouveau.email)) {
        vscode.window.showInformationMessage(`${nouveau.email} est déjà connecté. Jeton mis à jour.`);
        const sansDoublon = comptes.filter(c => c.email !== nouveau.email);
        await ecrireComptes([...sansDoublon, nouveau]);
      } else {
        await ecrireComptes([...comptes, nouveau]);
      }
      await rafraichirTout(false);
      vscode.window.showInformationMessage(`Compte connecté : ${nouveau.email}`);
    } catch (e) {
      vscode.window.showErrorMessage(`Connexion échouée : ${e.message || e}`);
    }
  }

  async function supprimerCompte() {
    const comptes = await lireComptes();
    if (comptes.length === 0) { vscode.window.showInformationMessage('Aucun compte connecté.'); return; }
    const choix = await vscode.window.showQuickPick(
      comptes.map(c => ({ label: c.email, description: c.nom })),
      { placeHolder: 'Quel compte déconnecter ?' }
    );
    if (!choix) return;
    await ecrireComptes(comptes.filter(c => c.email !== choix.label));
    await pousserVersVue();
  }

  function ouvrirDansLeNavigateur() {
    if (!urlServeur) {
      vscode.window.showWarningMessage("Le serveur local n'a pas pu démarrer (voir la notification précédente).");
      return;
    }
    vscode.env.openExternal(vscode.Uri.parse(urlServeur));
  }

  // --- Serveur local : accès au tableau de bord hors de la barre latérale ---
  // Écoute UNIQUEMENT sur 127.0.0.1 : accessible depuis un navigateur sur
  // cette machine, pas depuis le réseau. Il tourne tant que CETTE instance
  // d'Antigravity reste ouverte (même en arrière-plan) ; il s'arrête si tu
  // fermes la fenêtre.
  function demarrerServeurLocal(port) {
    const handler = async (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      try {
        if (req.method === 'GET' && url.pathname === '/') {
          const html = fs.readFileSync(vscode.Uri.joinPath(context.extensionUri, 'media', 'standalone.html').fsPath, 'utf8');
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(html);
        } else if (req.method === 'GET' && (url.pathname === '/standalone.css' || url.pathname === '/standalone.js')) {
          const chemin = vscode.Uri.joinPath(context.extensionUri, 'media', url.pathname.slice(1)).fsPath;
          res.setHeader('Content-Type', url.pathname.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8');
          res.end(fs.readFileSync(chemin, 'utf8'));
        } else if (req.method === 'GET' && url.pathname === '/api/etat') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify(await etatActuel()));
        } else if (req.method === 'POST' && url.pathname === '/api/rafraichir') {
          await rafraichirTout(false);
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify(await etatActuel()));
        } else {
          res.writeHead(404).end();
        }
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ erreur: e.message || String(e) }));
      }
    };

    const s = http.createServer(handler);
    s.on('error', (err) => {
      if (err.code === 'EADDRINUSE' && port < PORT_PREFERE + 10) {
        demarrerServeurLocal(port + 1);
      } else {
        vscode.window.showWarningMessage(`Mes quotas : impossible de démarrer l'accès navigateur (${err.message}). Le panneau latéral reste utilisable.`);
      }
    });
    s.listen(port, '127.0.0.1', () => {
      serveur = s;
      urlServeur = `http://127.0.0.1:${port}`;
      itemBarreStatut = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
      itemBarreStatut.text = '$(graph) Quotas';
      itemBarreStatut.tooltip = `Ouvrir le tableau de bord dans le navigateur (${urlServeur})`;
      itemBarreStatut.command = 'mesQuotas.ouvrirNavigateur';
      itemBarreStatut.show();
      context.subscriptions.push(itemBarreStatut);
    });
  }
  demarrerServeurLocal(PORT_PREFERE);
  context.subscriptions.push({ dispose: () => serveur?.close() });

  context.subscriptions.push(vscode.commands.registerCommand('mesQuotas.connecterCompte', connecterCompte));
  context.subscriptions.push(vscode.commands.registerCommand('mesQuotas.rafraichir', () => rafraichirTout(true)));
  context.subscriptions.push(vscode.commands.registerCommand('mesQuotas.supprimerCompte', supprimerCompte));
  context.subscriptions.push(vscode.commands.registerCommand('mesQuotas.ouvrirNavigateur', ouvrirDansLeNavigateur));

  context.subscriptions.push(vscode.window.registerWebviewViewProvider('mesQuotas.panel', {
    resolveWebviewView(panel) {
      vueWebview = panel;
      panel.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')] };
      const html = fs.readFileSync(vscode.Uri.joinPath(context.extensionUri, 'media', 'panel.html').fsPath, 'utf8');
      panel.webview.html = html
        .replace('{{css}}', panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'panel.css')).toString())
        .replace('{{js}}', panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'panel.js')).toString());

      panel.webview.onDidReceiveMessage(msg => {
        if (msg.type === 'connecter') vscode.commands.executeCommand('mesQuotas.connecterCompte');
        if (msg.type === 'rafraichir') vscode.commands.executeCommand('mesQuotas.rafraichir');
        if (msg.type === 'supprimer') vscode.commands.executeCommand('mesQuotas.supprimerCompte');
        if (msg.type === 'ouvrirNavigateur') vscode.commands.executeCommand('mesQuotas.ouvrirNavigateur');
      });

      panel.onDidChangeVisibility(() => { if (panel.visible) pousserVersVue(); });
      pousserVersVue();
    }
  }));

  // Rafraîchissement auto toutes les 10 minutes, et une fois au démarrage.
  rafraichirTout(false);
  const minuteur = setInterval(() => rafraichirTout(false), 10 * 60 * 1000);
  context.subscriptions.push({ dispose: () => clearInterval(minuteur) });
}

function deactivate() {}

module.exports = { activate, deactivate };
