// Interroge le même service que l'IDE utilise en interne pour connaître le
// quota restant par modèle, pour UN compte (identifié par son accessToken).
const { requeteJson } = require('./googleAuth.js');

const BASE_CLOUD_CODE = 'https://cloudcode-pa.googleapis.com';

async function appelCloudCode(methode, corps, accessToken, versionIde) {
  return requeteJson(`${BASE_CLOUD_CODE}/v1internal:${methode}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'User-Agent': `antigravity/${versionIde} desktop`
    },
    body: JSON.stringify(corps)
  });
}

// Décide si un modèle mérite d'être mis en avant (vue "primaire") ou rangé
// dans "Autres modèles" (variantes de vitesse, preview internes, etc.).
// Heuristique volontairement simple sur le nom affiché — à ajuster si Google
// change ses conventions de nommage.
function estPrioritaire(nom) {
  const n = nom.toLowerCase();
  if (n.startsWith('tab_')) return false;
  if (n.includes('lite') || n.includes('image') || n.includes('tiered')) return false;
  if (n.includes('flash') && /\((high|low|medium)\)/.test(n)) return false;
  if (n.includes('opus') || n.includes('sonnet') || n.includes('gpt-oss')) return true;
  if (/\bpro\b/.test(n)) return true;
  if (/^gemini[\s\d.]*flash$/.test(n.replace(/\s+/g, ' ').trim())) return true;
  return false;
}

// Transforme la réponse brute en une petite liste lisible : nom du modèle,
// fraction de quota restante (0 à 1), date de reset, statut.
function formaterModeles(reponse) {
  if (!reponse.models || typeof reponse.models !== 'object') {
    throw new Error('Réponse de quota non reconnue (le format a peut-être changé).');
  }
  const maintenant = new Date().toISOString();
  return Object.entries(reponse.models)
    .filter(([, m]) => m && typeof m === 'object' && !m.disabled && !m.isInternal)
    .map(([id, m]) => {
      const info = m.quotaInfo && typeof m.quotaInfo === 'object' ? m.quotaInfo : null;
      const fraction = info && typeof info.remainingFraction === 'number' ? info.remainingFraction
        : info ? 0 /* message présent mais champ absent = 0, cf proto3 */
        : null;
      const resetTime = info && typeof info.resetTime === 'string' ? info.resetTime : null;
      const nom = m.displayName || m.label || id;
      return {
        id,
        nom,
        fraction,
        resetTime,
        verifieLe: maintenant,
        statut: fraction === null ? 'inconnu' : fraction > 0 ? 'disponible' : 'épuisé',
        primaire: estPrioritaire(nom)
      };
    })
    .sort((a, b) => (a.primaire === b.primaire ? a.nom.localeCompare(b.nom) : a.primaire ? -1 : 1));
}

// Récupère le quota de tous les modèles pour un compte.
async function recupererQuota(accessToken, versionIde) {
  const info = await appelCloudCode('loadCodeAssist', {
    metadata: { ideName: 'antigravity', ideType: 'ANTIGRAVITY', ideVersion: versionIde }
  }, accessToken, versionIde);

  const project = typeof info.cloudaicompanionProject === 'string'
    ? info.cloudaicompanionProject
    : info.cloudaicompanionProject?.id;
  if (!project) {
    throw new Error("Pas de projet Antigravity trouvé pour ce compte — termine l'onboarding dans l'IDE avec ce compte d'abord.");
  }

  const catalogue = await appelCloudCode('fetchAvailableModels', { project }, accessToken, versionIde);
  const palier = info.paidTier?.name || info.currentTier?.name || info.paidTier?.id || info.currentTier?.id || 'Palier inconnu';
  return { palier, modeles: formaterModeles(catalogue) };
}

module.exports = { recupererQuota };
