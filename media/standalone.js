let dernierEtat = { comptes: [] };
let modeleChoisi = null;
let rafraichissementAuto = null;

const grille = document.getElementById('grille');
const selModele = document.getElementById('sel-modele');
const meilleurListe = document.getElementById('meilleur-liste');
const statutMaj = document.getElementById('statut-maj');
const btnRafraichir = document.getElementById('btn-rafraichir');
const caseAuto = document.getElementById('auto-refresh');

function formaterDelai(isoDate) {
  if (!isoDate) return '';
  const diff = new Date(isoDate).getTime() - Date.now();
  if (diff <= 0) return 'reset passé';
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h >= 24) return `reset dans ${Math.floor(h / 24)} j`;
  if (h >= 1) return `reset dans ${h} h ${m} min`;
  return `reset dans ${m} min`;
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

function carteCompte(c) {
  const bloc = document.createElement('div');
  bloc.className = 'compte';

  const entete = document.createElement('div');
  entete.className = 'compte-entete';
  entete.innerHTML = `<span><span class="compte-email"></span><span class="compte-palier"></span></span>`;
  entete.querySelector('.compte-email').textContent = c.email;
  entete.querySelector('.compte-palier').textContent = c.palier ? `· ${c.palier}` : '';
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

function listeModelesConnus(comptes) {
  const noms = new Set();
  comptes.forEach(c => (c.modeles || []).forEach(m => noms.add(m.nom)));
  return [...noms].sort((a, b) => a.localeCompare(b));
}

function rendreSelecteur(comptes) {
  const noms = listeModelesConnus(comptes);
  if (!noms.length) { selModele.innerHTML = ''; return; }
  if (!modeleChoisi || !noms.includes(modeleChoisi)) modeleChoisi = noms[0];
  selModele.innerHTML = noms.map(n => `<option${n === modeleChoisi ? ' selected' : ''}>${n}</option>`).join('');
}

function rendreMeilleurCompte(comptes) {
  if (!modeleChoisi) { meilleurListe.innerHTML = ''; return; }
  const disponibles = comptes
    .filter(c => Array.isArray(c.modeles))
    .map(c => ({ email: c.email, m: c.modeles.find(m => m.nom === modeleChoisi) }))
    .filter(x => x.m && x.m.fraction !== null && x.m.fraction > 0)
    .sort((a, b) => b.m.fraction - a.m.fraction);

  meilleurListe.innerHTML = disponibles.length
    ? disponibles.map(x => `<span class="chip ok">${x.email} · ${Math.round(x.m.fraction * 100)}%</span>`).join('')
    : '<span class="chip-aucun">Aucun compte disponible pour ce modèle en ce moment.</span>';
}

function rendreTout() {
  const comptes = dernierEtat.comptes || [];
  rendreSelecteur(comptes);
  rendreMeilleurCompte(comptes);

  grille.innerHTML = '';
  if (!comptes.length) {
    const vide = document.createElement('div');
    vide.className = 'vide-etat';
    vide.textContent = "Aucun compte connecté pour l'instant. Connecte-en un depuis le panneau latéral d'Antigravity.";
    grille.appendChild(vide);
    return;
  }
  comptes.forEach(c => grille.appendChild(carteCompte(c)));
}

async function charger() {
  try {
    const reponse = await fetch('/api/etat');
    dernierEtat = await reponse.json();
    statutMaj.textContent = 'actualisé à ' + new Date().toLocaleTimeString('fr-FR');
    rendreTout();
  } catch {
    statutMaj.textContent = 'connexion au serveur perdue';
  }
}

async function forcerRafraichissement() {
  btnRafraichir.disabled = true;
  btnRafraichir.textContent = 'Vérification…';
  try {
    const reponse = await fetch('/api/rafraichir', { method: 'POST' });
    dernierEtat = await reponse.json();
    statutMaj.textContent = 'actualisé à ' + new Date().toLocaleTimeString('fr-FR');
    rendreTout();
  } catch {
    statutMaj.textContent = 'échec de la vérification';
  } finally {
    btnRafraichir.disabled = false;
    btnRafraichir.textContent = 'Rafraîchir';
  }
}

btnRafraichir.addEventListener('click', forcerRafraichissement);
selModele.addEventListener('change', () => { modeleChoisi = selModele.value; rendreMeilleurCompte(dernierEtat.comptes || []); });

function gererAuto() {
  if (rafraichissementAuto) clearInterval(rafraichissementAuto);
  if (caseAuto.checked) rafraichissementAuto = setInterval(charger, 30000);
}
caseAuto.addEventListener('change', gererAuto);

charger();
gererAuto();
