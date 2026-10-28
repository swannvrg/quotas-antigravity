// Ce fichier fait deux choses, toutes deux "propres" :
//  1) lire l'identifiant d'application (client OAuth) qu'utilise Antigravity
//     lui-même pour se connecter à Google — c'est un identifiant d'APP, pas
//     un secret personnel, et il est déjà présent dans l'IDE installé sur
//     cette machine ;
//  2) faire, pour CE compte précis, une connexion Google standard (OAuth avec
//     PKCE) dans le navigateur, avec le consentement explicite de
//     l'utilisateur. On ne lit jamais le stockage d'un autre profil/instance.

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

// Récupère client_id / client_secret / scopes depuis le binaire de l'IDE
// installé sur cette machine (out/main.js). C'est un détail d'implémentation
// de l'IDE : si une mise à jour change ce fichier, cette fonction peut casser
// et devra être ajustée.
function lireConfigOAuthDeLIDE(appRoot) {
  const source = fs.readFileSync(path.join(appRoot, 'out', 'main.js'), 'utf8');
  const zone = source.match(/common\/oauthClient\.js[\s\S]{0,2400}/)?.[0] || '';
  const clientId = zone.match(/"([\w-]+\.apps\.googleusercontent\.com)"/)?.[1];
  const clientSecret = zone.match(/"(GOCSPX-[\w-]+)"/)?.[1];
  const scopes = [...new Set([...zone.matchAll(/"(https:\/\/www\.googleapis\.com\/auth\/[\w.-]+)"/g)].map(m => m[1]))];
  if (!clientId || !clientSecret || scopes.length === 0) {
    throw new Error("Impossible de lire la configuration OAuth de l'IDE installé (mise à jour ? chemin différent ?).");
  }
  const product = JSON.parse(fs.readFileSync(path.join(appRoot, 'product.json'), 'utf8'));
  return { clientId, clientSecret, scopes, version: product.ideVersion || product.version || '0.0.0' };
}

async function requeteJson(url, options = {}) {
  let reponse;
  try {
    reponse = await fetch(url, { ...options, signal: AbortSignal.timeout(20000) });
  } catch {
    throw new Error('Requête réseau échouée ou expirée.');
  }
  if (!reponse.ok) {
    const err = new Error(reponse.status === 401 ? 'Connexion expirée ; reconnecte ce compte.' : `Le service a répondu HTTP ${reponse.status}.`);
    err.status = reponse.status;
    throw err;
  }
  try { return await reponse.json(); } catch { throw new Error('Réponse JSON invalide.'); }
}

// Ouvre le navigateur pour connecter UN compte Google, récupère un jeton
// propre à ce compte. Chaque appel = une nouvelle autorisation explicite.
async function connecterUnCompte(config, ouvrirNavigateur) {
  const state = crypto.randomBytes(24).toString('hex');
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

  let resoudre, rejeter;
  const codeAttendu = new Promise((res, rej) => { resoudre = res; rejeter = rej; });

  const serveur = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/callback') { res.writeHead(404).end(); return; }
    if (url.searchParams.get('state') !== state) { res.writeHead(400).end('État invalide.'); return; }
    if (url.searchParams.has('error')) {
      res.end('Connexion annulée. Tu peux fermer cet onglet.');
      rejeter(new Error('Connexion Google annulée.'));
      return;
    }
    const code = url.searchParams.get('code');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<!doctype html><meta charset="utf-8"><body style="font:15px sans-serif;padding:40px;color:#222">Compte connecté. Tu peux fermer cet onglet et revenir à Antigravity.</body>');
    resoudre(code);
  });
  await new Promise((res, rej) => { serveur.once('error', rej); serveur.listen(0, '127.0.0.1', res); });
  const port = serveur.address().port;
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  const timer = setTimeout(() => rejeter(new Error('Connexion expirée (3 min).')), 180000);
  try {
    const urlAuth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    urlAuth.search = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: config.scopes.join(' '),
      access_type: 'offline',
      prompt: 'consent select_account',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256'
    }).toString();

    const ouvert = await ouvrirNavigateur(urlAuth.toString());
    if (!ouvert) throw new Error("Impossible d'ouvrir le navigateur.");

    const code = await codeAttendu;
    const reponse = await requeteJson('https://oauth2.googleapis.com/token', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code_verifier: verifier
      })
    });
    if (!reponse.access_token || !reponse.refresh_token) {
      throw new Error("Google n'a pas renvoyé de connexion persistante. Réessaie.");
    }
    const profil = await requeteJson('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${reponse.access_token}` }
    });
    return {
      email: profil.email,
      nom: profil.name || profil.email,
      accessToken: reponse.access_token,
      refreshToken: reponse.refresh_token,
      expireLe: Math.floor(Date.now() / 1000) + reponse.expires_in
    };
  } finally {
    clearTimeout(timer);
    serveur.close();
  }
}

// Rafraîchit le jeton d'accès si besoin (il expire au bout d'~1h).
async function rafraichirJeton(compte, config) {
  if (compte.accessToken && compte.expireLe * 1000 > Date.now() + 60000) return compte;
  const reponse = await requeteJson('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: compte.refreshToken
    })
  });
  if (!reponse.access_token) throw new Error('Google a refusé de renouveler la connexion.');
  return {
    ...compte,
    accessToken: reponse.access_token,
    refreshToken: reponse.refresh_token || compte.refreshToken,
    expireLe: Math.floor(Date.now() / 1000) + reponse.expires_in
  };
}

module.exports = { lireConfigOAuthDeLIDE, connecterUnCompte, rafraichirJeton, requeteJson };
