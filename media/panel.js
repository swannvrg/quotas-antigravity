const vscode = acquireVsCodeApi();

document.getElementById('btn-connecter').addEventListener('click', () => vscode.postMessage({ type: 'connecter' }));
document.getElementById('btn-rafraichir').addEventListener('click', () => vscode.postMessage({ type: 'rafraichir' }));
document.getElementById('btn-plein-ecran').addEventListener('click', () => vscode.postMessage({ type: 'ouvrirNavigateur' }));

function formaterDelai(isoDate) {
  if (!isoDate) return '';
  const diff = new Date(isoDate).getTime() - Date.now();
  if (diff <= 0) return 'reset passé';
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h >= 24) return `reset ${Math.floor(h / 24)} j`;
  if (h >= 1) return `reset ${h} h`;
  return `reset ${m} min`;
}

function classeJauge(fraction) {
  if (fraction === null) return 'bas';
  if (fraction <= 0) return 'vide';
  if (fraction < 0.25) return 'bas';
  return 'ok';
}

function ligneModele(m) {
  const ligne = document.createElement('div');
  ligne.className = 'modele';
  const pct = m.fraction === null ? '?' : Math.round(m.fraction * 100) + '%';
  ligne.innerHTML = `<span class="modele-nom" title="${m.nom}">${m.nom}</span><span class="jauge"><span class="jauge-remplie ${classeJauge(m.fraction)}" style="width:${m.fraction === null ? 0 : Math.round(m.fraction * 100)}%"></span></span><span class="pct">${pct}</span>`;
  if (m.statut === 'épuisé' && m.resetTime) {
    const r = document.createElement('span');
    r.className = 'reset';
    r.textContent = formaterDelai(m.resetTime);
    ligne.appendChild(r);
  }
  return ligne;
}

function rendreCompte(c) {
  const bloc = document.createElement('div');
  bloc.className = 'compte';

  const entete = document.createElement('div');
  entete.className = 'compte-entete';
  entete.innerHTML = `<span><span class="compte-email"></span> <span class="compte-palier"></span></span><span class="supprimer" title="Déconnecter">✕</span>`;
  entete.querySelector('.compte-email').textContent = c.email;
  entete.querySelector('.compte-palier').textContent = c.palier ? `· ${c.palier}` : '';
  entete.querySelector('.supprimer').addEventListener('click', () => vscode.postMessage({ type: 'supprimer' }));
  bloc.appendChild(entete);

  if (c.erreur) {
    const err = document.createElement('div');
    err.className = 'erreur';
    err.textContent = c.erreur;
    bloc.appendChild(err);
  } else if (Array.isArray(c.modeles)) {
    const primaires = c.modeles.filter(m => m.primaire);
    const autres = c.modeles.filter(m => !m.primaire);
    (primaires.length ? primaires : c.modeles).forEach(m => bloc.appendChild(ligneModele(m)));

    if (autres.length) {
      const toggle = document.createElement('div');
      toggle.className = 'toggle-autres';
      toggle.textContent = `▸ Autres modèles (${autres.length})`;
      const zone = document.createElement('div');
      zone.className = 'autres-modeles';
      autres.forEach(m => zone.appendChild(ligneModele(m)));
      toggle.addEventListener('click', () => {
        const ouvert = zone.classList.toggle('ouvert');
        toggle.textContent = `${ouvert ? '▾' : '▸'} Autres modèles (${autres.length})`;
      });
      bloc.appendChild(toggle);
      bloc.appendChild(zone);
    }
  }

  if (c.verifieLe) {
    const v = document.createElement('div');
    v.className = 'verifie';
    v.textContent = 'vérifié à ' + new Date(c.verifieLe).toLocaleTimeString('fr-FR');
    bloc.appendChild(v);
  }

  return bloc;
}

window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg.type !== 'etat') return;
  const liste = document.getElementById('liste');
  liste.innerHTML = '';
  if (!msg.comptes.length) {
    const vide = document.createElement('div');
    vide.className = 'vide-etat';
    vide.textContent = 'Aucun compte connecté. Clique sur "+ Compte".';
    liste.appendChild(vide);
    return;
  }
  msg.comptes.forEach(c => liste.appendChild(rendreCompte(c)));
});
