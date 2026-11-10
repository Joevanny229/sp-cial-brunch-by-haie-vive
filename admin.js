import { supabase } from './supabase.js';

const $ = (id) => document.getElementById(id);

// Laisse vide : l'adresse de index.html est déduite de celle de cette page.
// Si besoin, mets l'adresse complète, par exemple :
// 'https://ton-compte.github.io/ton-depot/index.html'
const SITE_URL = '';

let lastData = null;
let invitations = [];
let invitationsSaved = true;
let busy = false;

// ---------- Utilitaires ----------

function showMessage(id, message, type = '') {
  const element = $(id);
  element.textContent = message;
  element.className = 'admin-message ' + type;
}

function personalLink(code) {
  const base = SITE_URL || new URL('index.html', window.location.href).href;
  return `${base}#${code}`;
}

// Neutralise les cellules qui seraient interprétées comme une formule Excel.
function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

function downloadCSV(filename, rows) {
  const content = '\uFEFF' + rows
    .map((row) => row.map(csvCell).join(';'))
    .join('\r\n');

  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = filename;
  link.click();

  URL.revokeObjectURL(url);
}

function addCell(row, value) {
  const cell = document.createElement('td');
  cell.textContent = value ?? '—';
  row.appendChild(cell);
  return cell;
}

function emptyRow(table, columns, text) {
  const row = document.createElement('tr');
  const cell = document.createElement('td');
  cell.colSpan = columns;
  cell.textContent = text;
  row.appendChild(cell);
  table.appendChild(row);
}

function formatDate(iso) {
  return iso ? new Date(iso).toLocaleString('fr-FR') : '—';
}

const CATEGORY_LABELS = { membre: 'Membre', postulant: 'Postulant' };

const STATUS_LABELS = {
  active: 'Active',
  used: 'Utilisée',
  disabled: 'Désactivée'
};

const REASON_LABELS = {
  invalid_code: 'Code invalide',
  code_disabled: 'Code désactivé',
  draw_closed: 'Tirage fermé',
  no_color_available: 'Plus de place disponible',
  participant_not_found: 'Personne introuvable',
  code_already_used: 'Code déjà utilisé'
};

const label = (map, key) => map[key] || key || '—';

// ---------- Appels au serveur ----------

async function callAdmin(name, body = {}) {
  const { data, error } = await supabase.functions.invoke(name, { body });

  if (!error) return { ok: true, status: 200, data };

  let message = '';
  try {
    const payload = await error.context.json();
    message = payload?.error || payload?.message || '';
  } catch (_) { /* pas de détail disponible */ }

  return {
    ok: false,
    status: error.context?.status ?? 0,
    message: message || error.message
  };
}

// ---------- Écrans ----------

function displayLogin() {
  $('login-section').hidden = false;
  $('dashboard-section').hidden = true;
}

function displayDashboard() {
  $('login-section').hidden = true;
  $('dashboard-section').hidden = false;
}

function resetState() {
  lastData = null;
  invitations = [];
  invitationsSaved = true;
  $('invitations-section').hidden = true;
  $('invitations-table').replaceChildren();
}

// ---------- Affichage ----------

function renderDrawState(open) {
  const pill = $('draw-status');
  pill.textContent = open ? 'Tirage ouvert' : 'Tirage fermé';
  pill.className = 'status-pill ' + (open ? 'open' : 'closed');
  $('toggle-draw-button').textContent =
    open ? 'Fermer le tirage' : 'Ouvrir le tirage';
}

function renderQuotas(quotas) {
  const container = $('quota-container');
  container.replaceChildren();

  for (const quota of quotas) {
    const box = document.createElement('div');
    box.className = 'quota-box';

    const title = document.createElement('strong');
    title.textContent = quota.color;

    const count = document.createElement('p');
    count.textContent = `${quota.assigned} / ${quota.quota} attribuées`;

    const remaining = document.createElement('small');
    remaining.textContent = `${quota.remaining} place(s) restante(s)`;

    box.append(title, count, remaining);
    container.appendChild(box);
  }
}

function renderAuthorized(people) {
  const table = $('authorized-participants-table');
  table.replaceChildren();

  $('authorized-total').textContent = people.length;
  $('authorized-members-count').textContent =
    people.filter((p) => p.category === 'membre').length;
  $('authorized-applicants-count').textContent =
    people.filter((p) => p.category === 'postulant').length;

  if (!people.length) {
    emptyRow(table, 6, 'Aucune personne autorisée trouvée.');
    return;
  }

  for (const person of people) {
    const row = document.createElement('tr');

    addCell(row, person.full_name);
    addCell(row, label(CATEGORY_LABELS, person.category));
    addCell(row, label(STATUS_LABELS, person.authorization_status));
    addCell(row, person.assigned_color || '—');
    addCell(row, person.drawn_at ? formatDate(person.drawn_at) : 'Non effectué');

    const codeCell = addCell(row, '');

    if (person.drawn_at) {
      codeCell.textContent = 'Utilisé';
    } else if (person.authorization_status === 'disabled') {
      codeCell.textContent = 'Désactivé';
    } else if (!person.has_invitation) {
      codeCell.textContent = 'Non généré';
    } else {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary-button';
      button.textContent = 'Régénérer';
      button.addEventListener('click', () => regenerate(person, button));
      codeCell.appendChild(button);
    }

    table.appendChild(row);
  }
}

function renderAttempts(attempts) {
  const table = $('attempts-table');
  table.replaceChildren();

  if (!attempts.length) {
    emptyRow(table, 3, 'Aucune tentative refusée.');
    return;
  }

  for (const attempt of attempts) {
    const row = document.createElement('tr');

    addCell(row, attempt.full_name || attempt.email || 'Code inconnu');
    addCell(row, label(REASON_LABELS, attempt.reason));
    addCell(row, formatDate(attempt.attempted_at));

    table.appendChild(row);
  }
}

function renderInvitations() {
  const table = $('invitations-table');
  table.replaceChildren();

  $('invitations-section').hidden = invitations.length === 0;

  for (const item of invitations) {
    const row = document.createElement('tr');

    addCell(row, item.full_name);
    addCell(row, label(CATEGORY_LABELS, item.category));

    const linkCell = addCell(row, '');
    linkCell.style.overflowWrap = 'anywhere';

    const link = personalLink(item.code);
    const text = document.createElement('div');
    text.textContent = link;

    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'secondary-button';
    copy.textContent = 'Copier le lien';
    copy.style.marginTop = '8px';
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(link);
        copy.textContent = 'Copié ✓';
      } catch (_) {
        copy.textContent = 'Copie impossible';
      }
      setTimeout(() => { copy.textContent = 'Copier le lien'; }, 1800);
    });

    linkCell.append(text, copy);
    table.appendChild(row);
  }
}

function addInvitation(item) {
  const index = invitations.findIndex((i) => i.full_name === item.full_name);
  if (index >= 0) invitations[index] = item;
  else invitations.push(item);

  invitationsSaved = false;
  renderInvitations();
}

// ---------- Chargement du tableau de bord ----------

async function loadDashboard() {
  showMessage('dashboard-message', 'Actualisation des données...');

  const res = await callAdmin('admin-dashboard');

  if (res.status === 401 || res.status === 403) {
    await supabase.auth.signOut();
    resetState();
    displayLogin();
    showMessage(
      'login-message',
      res.status === 403
        ? "Ce compte n'a pas accès à l'administration."
        : 'Session expirée. Reconnecte-toi.',
      'error'
    );
    return false;
  }

  if (!res.ok || !res.data?.success) {
    console.error('Dashboard error:', res);
    showMessage(
      'dashboard-message',
      'Impossible de charger le tableau de bord. Réessaie dans un instant.',
      'error'
    );
    return false;
  }

  const data = res.data;
  lastData = data;

  $('event-name').textContent = data.event?.event_name || 'Brunch Rotaract';
  renderDrawState(data.event?.draw_open === true);

  $('invited-count').textContent =
    `${data.summary.invited} / ${data.summary.total}`;
  $('drawn-count').textContent = data.summary.drawn;
  $('pending-count').textContent = data.summary.remaining;

  renderQuotas(data.quotas || []);
  renderAuthorized(data.authorized_participants || []);
  renderAttempts(data.refused_attempts || []);

  showMessage('dashboard-message', 'Données actualisées.', 'success');
  return true;
}

// ---------- Connexion ----------

$('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();

  const email = $('admin-email').value.trim();
  const password = $('admin-password').value;

  const button = $('login-button');
  button.disabled = true;
  button.textContent = 'Connexion...';
  showMessage('login-message', '');

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;
    if (!data.user) throw new Error('Utilisateur introuvable.');

    displayDashboard();
    await loadDashboard();

  } catch (error) {
    console.error(error);
    showMessage('login-message', error.message || 'Connexion impossible.', 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Se connecter';
  }
});

$('logout-button').addEventListener('click', async () => {
  if (!invitationsSaved && invitations.length) {
    const leave = window.confirm(
      "Des codes générés n'ont pas été téléchargés et seront perdus.\n\n" +
      'Te déconnecter quand même ?'
    );
    if (!leave) return;
  }

  const { error } = await supabase.auth.signOut();

  if (error) {
    showMessage('dashboard-message', error.message, 'error');
    return;
  }

  resetState();
  displayLogin();
});

$('refresh-button').addEventListener('click', loadDashboard);

// ---------- Ouverture et fermeture du tirage ----------

$('toggle-draw-button').addEventListener('click', async () => {
  if (busy) return;

  const wantOpen = !(lastData?.event?.draw_open === true);

  if (wantOpen) {
    const confirmed = window.confirm(
      'Ouvrir le tirage ?\n\n' +
      'Toute personne qui possède un code valide pourra tirer sa couleur.'
    );
    if (!confirmed) return;
  }

  busy = true;
  const button = $('toggle-draw-button');
  button.disabled = true;
  showMessage('draw-message', '');

  try {
    const res = await callAdmin('set-draw-state', { open: wantOpen });

    if (!res.ok || !res.data?.success) {
      throw new Error(res.message || res.data?.error || 'Action refusée.');
    }

    const open = res.data.draw_open === true;
    if (lastData?.event) lastData.event.draw_open = open;
    renderDrawState(open);

    showMessage(
      'draw-message',
      open ? 'Le tirage est ouvert.' : 'Le tirage est fermé.',
      'success'
    );

  } catch (error) {
    console.error(error);
    showMessage('draw-message', error.message || 'Action impossible.', 'error');
  } finally {
    busy = false;
    button.disabled = false;
  }
});

// ---------- Génération des codes ----------

$('generate-invitations-button').addEventListener('click', async () => {
  if (busy) return;
  busy = true;

  const button = $('generate-invitations-button');
  button.disabled = true;
  button.textContent = 'Génération...';
  showMessage('invitation-message', '');

  try {
    const res = await callAdmin('generate-invitations');

    if (!res.ok || !res.data?.success) {
      throw new Error(res.message || res.data?.error || 'Génération refusée.');
    }

    const created = res.data.invitations || [];

    if (!created.length) {
      showMessage(
        'invitation-message',
        res.data.message || 'Aucune nouvelle invitation à générer.',
        'success'
      );
      return;
    }

    for (const item of created) {
      addInvitation({
        full_name: item.full_name,
        category: item.category,
        code: item.invitation_code
      });
    }

    showMessage(
      'invitation-message',
      `${created.length} code(s) généré(s). Télécharge le fichier CSV ` +
      'maintenant : les codes ne seront plus récupérables ensuite.',
      'success'
    );

    await loadDashboard();

  } catch (error) {
    console.error(error);
    showMessage(
      'invitation-message',
      error.message || 'Génération impossible.',
      'error'
    );
  } finally {
    busy = false;
    button.disabled = false;
    button.textContent = 'Générer les codes manquants';
  }
});

async function regenerate(person, button) {
  if (busy) return;

  const confirmed = window.confirm(
    `Régénérer le code de ${person.full_name} ?\n\n` +
    'Son ancien code cessera de fonctionner.'
  );
  if (!confirmed) return;

  busy = true;
  button.disabled = true;
  showMessage('authorized-message', '');

  try {
    const res = await callAdmin('regenerate-invitation', { id: person.id });

    if (!res.ok || !res.data?.success) {
      throw new Error(res.message || res.data?.error || 'Régénération refusée.');
    }

    addInvitation({
      full_name: person.full_name,
      category: person.category,
      code: res.data.invitation_code
    });

    showMessage(
      'authorized-message',
      `Nouveau code créé pour ${person.full_name}. ` +
      "Il apparaît dans la section « Codes d'invitation » : télécharge-le.",
      'success'
    );

    await loadDashboard();

  } catch (error) {
    console.error(error);
    showMessage(
      'authorized-message',
      error.message || 'Régénération impossible.',
      'error'
    );
  } finally {
    busy = false;
    button.disabled = false;
  }
}

// ---------- Exports CSV ----------

$('download-invitations-button').addEventListener('click', () => {
  if (!invitations.length) return;

  const rows = [
    ['Nom et prénoms', 'Catégorie', 'Lien personnel'],
    ...invitations.map((i) => [
      i.full_name,
      label(CATEGORY_LABELS, i.category),
      personalLink(i.code)
    ])
  ];

  downloadCSV('invitations-rotaract.csv', rows);
  invitationsSaved = true;
});

$('export-results-button').addEventListener('click', () => {
  const people = lastData?.authorized_participants;

  if (!people?.length) {
    showMessage('authorized-message', 'Aucune donnée à exporter.', 'error');
    return;
  }

  const rows = [
    ['Nom et prénoms', 'Catégorie', 'Couleur', 'Date du tirage'],
    ...people.map((p) => [
      p.full_name,
      label(CATEGORY_LABELS, p.category),
      p.assigned_color || 'En attente',
      p.drawn_at ? formatDate(p.drawn_at) : 'Non effectué'
    ])
  ];

  downloadCSV('resultats-rotaract.csv', rows);
});

// Avertir avant de fermer la page si des codes n'ont pas été téléchargés.
window.addEventListener('beforeunload', (event) => {
  if (!invitationsSaved && invitations.length) {
    event.preventDefault();
    event.returnValue = '';
  }
});

// ---------- Démarrage : restaurer la session ----------

try {
  const { data } = await supabase.auth.getSession();

  if (data.session) {
    displayDashboard();
    await loadDashboard();
  } else {
    displayLogin();
  }
} catch (error) {
  console.error(error);
  displayLogin();
}