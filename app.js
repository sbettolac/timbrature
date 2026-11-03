'use strict';

const State = {
  token: null,
  user:  null,

  init() {
    try {
      this.token = localStorage.getItem('st_token');
      const u    = localStorage.getItem('st_user');
      this.user  = u ? JSON.parse(u) : null;
    } catch (e) {
      this.token = null;
      this.user  = null;
    }
    if (!this.user) this.token = null;
  },

  setSession(token, user) {
    this.token = token;
    this.user  = user;
    try {
      localStorage.setItem('st_token', token);
      localStorage.setItem('st_user',  JSON.stringify(user));
    } catch (e) { /* senza memoria l'accesso dura fino alla chiusura dell'app */ }
  },

  clearSession() {
    this.token = null;
    this.user  = null;
    try {
      localStorage.removeItem('st_token');
      localStorage.removeItem('st_user');
    } catch (e) { /* niente da pulire */ }
  }
};

/** Chiama lo script Google. text/plain evita il controllo CORS preliminare. */
async function gasCall(method, ...args) {
  if (!window.API_URL || window.API_URL.indexOf('/exec') < 0)
    throw new Error('App non configurata: manca l\'indirizzo dello script in config.js.');

  let res;
  try {
    res = await fetch(window.API_URL, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ method, args })
    });
  } catch (e) {
    throw new Error('Connessione assente: controlla la rete e riprova.');
  }

  let r;
  try {
    r = await res.json();
  } catch (e) {
    throw new Error('Risposta non valida dal server. Riprova tra poco.');
  }
  if (r && r.success) return r.data;
  throw new Error(r?.error || 'Errore sconosciuto');
}

/* ─── Date: sempre ora di Roma, mai UTC ─────────────────────────────────── */

function romeNow() {
  const parts = {};
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date()).forEach(p => { parts[p.type] = p.value; });
  return parts;
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Giornata lavorativa corrente: prima del cambio giornata vale ancora ieri. */
function workToday() {
  const p      = romeNow();
  const date   = `${p.year}-${p.month}-${p.day}`;
  const cambio = Number(State.user?.oraCambioGiornata ?? 5);
  return Number(p.hour) < cambio ? addDays(date, -1) : date;
}

function romeInputNow() {
  const p = romeNow();
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

function formatDay(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

const UI = {
  _notifTimer: null,

  showNotification(msg, type = 'info', durationMs = 3500) {
    const el = document.getElementById('notification');
    el.textContent = msg;
    el.className   = `notification ${type}`;
    el.classList.remove('hidden');
    clearTimeout(this._notifTimer);
    this._notifTimer = setTimeout(() => el.classList.add('hidden'), durationMs);
  },

  showLoading(show, text = 'Caricamento…') {
    document.getElementById('loading-text').textContent = text;
    document.getElementById('loading-overlay').classList.toggle('hidden', !show);
  },

  showModal(html, center = false) {
    const overlay = document.getElementById('modal-overlay');
    document.getElementById('modal-content').innerHTML = html;
    overlay.classList.remove('hidden', 'center');
    if (center) overlay.classList.add('center');
  },

  hideModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
  },

  setContent(html) {
    document.getElementById('main-content').innerHTML = html;
  },

  setTitle(title) {
    document.getElementById('header-title').textContent = title;
  },

  setActiveNav(view) {
    document.querySelectorAll('.nav-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.view === view));
  },

  formatHours(h) {
    if (h === null || h === undefined || isNaN(h)) return '—';
    const sign = h < 0 ? '-' : '';
    const mins = Math.round(Math.abs(h) * 60);
    const hh   = Math.floor(mins / 60);
    const mm   = mins % 60;
    return `${sign}${hh}h ${String(mm).padStart(2, '0')}m`;
  },

  balanceClass(b) {
    if (!b && b !== 0) return 'balance-zero';
    return b > 0 ? 'balance-pos' : b < 0 ? 'balance-neg' : 'balance-zero';
  },

  escHtml(s) {
    return String(s ?? '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
};

const VIEWS = {
  login:             viewLogin,
  home:              viewHome,
  calendario:        viewCalendario,
  monte_ore:         viewMonteOre,
  storico:           viewStorico,
  admin_dashboard:   viewAdminDashboard,
  admin_utenti:      viewAdminUtenti,
  admin_timbrature:  viewAdminTimbrature,
  admin_mese:        viewAdminMese,
  admin_config:      viewAdminConfig,
  admin_registro:    viewAdminRegistro
};

async function navigate(view, params = {}) {
  UI.showLoading(true);
  try {
    const fn = VIEWS[view];
    if (!fn) throw new Error('Vista non trovata: ' + view);
    await fn(params);
    UI.setActiveNav(view);
  } catch (e) {
    if (/[Ss]essione|[Aa]utent/.test(e.message)) {
      State.clearSession();
      if (view !== 'login') {
        await navigate('login');
        UI.showNotification('Sessione scaduta: accedi di nuovo.', 'info');
      } else {
        UI.showNotification(e.message || 'Errore in login', 'error');
      }
    } else {
      UI.showNotification(e.message, 'error');
    }
  } finally {
    UI.showLoading(false);
  }
}

/* ─── Guscio dell'app ───────────────────────────────────────────────────── */

function _hideShell() {
  document.getElementById('app-header').classList.add('hidden');
  document.getElementById('bottom-nav').classList.add('hidden');
  document.getElementById('admin-nav').classList.add('hidden');
}

function _setupShell(ruolo) {
  const main = document.getElementById('main-content');
  main.style.padding  = '';
  main.style.maxWidth = '';

  document.getElementById('app-header').classList.remove('hidden');
  document.getElementById('header-user').textContent = State.user.nome;

  document.getElementById('admin-nav').classList.toggle('hidden', ruolo !== 'admin');
  document.getElementById('bottom-nav').classList.toggle('hidden', ruolo === 'admin');
}

async function doLogout() {
  UI.hideModal();
  const token = State.token;
  State.clearSession();
  await navigate('login');
  if (token) gasCall('logout', token).catch(() => {});
}

function askLogout() {
  UI.showModal(`
    <div class="modal-title">Vuoi uscire?</div>
    <div>Per rientrare dovrai inserire di nuovo username e PIN.</div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="UI.hideModal()">Annulla</button>
      <button class="btn btn-error" onclick="doLogout()">Esci</button>
    </div>
  `, true);
}

function openMenu() {
  const admin = State.user?.ruolo === 'admin';
  UI.showModal(`
    <div class="modal-title">Menu</div>
    <div class="menu-list">
      <button class="btn btn-secondary btn-full" onclick="openChangePin()">🔑 Cambia il mio PIN</button>
      ${admin ? `
        <button class="btn btn-secondary btn-full" onclick="UI.hideModal();navigate('admin_config')">⚙️ Configurazione</button>
        <button class="btn btn-secondary btn-full" onclick="UI.hideModal();navigate('admin_registro')">📜 Registro attività</button>
      ` : ''}
      <button class="btn btn-error btn-full" onclick="askLogout()">Esci</button>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="UI.hideModal()">Chiudi</button>
    </div>
  `, true);
}

function openChangePin() {
  UI.showModal(`
    <div class="modal-title">🔑 Cambia il mio PIN</div>
    <div class="form-group">
      <label class="form-label" for="cp-old">PIN attuale</label>
      <input class="form-control" type="password" id="cp-old" inputmode="numeric" maxlength="8">
    </div>
    <div class="form-group">
      <label class="form-label" for="cp-new">Nuovo PIN (4–8 cifre)</label>
      <input class="form-control" type="password" id="cp-new" inputmode="numeric" maxlength="8">
    </div>
    <div id="cp-error" class="login-error hidden"></div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="UI.hideModal()">Annulla</button>
      <button class="btn btn-primary" onclick="_doChangePin()">Salva</button>
    </div>
  `, true);
}

async function _doChangePin() {
  const errEl = document.getElementById('cp-error');
  errEl.classList.add('hidden');
  try {
    await gasCall('changePin', State.token,
      document.getElementById('cp-old').value,
      document.getElementById('cp-new').value);
    UI.hideModal();
    UI.showNotification('PIN aggiornato', 'success');
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('hidden');
  }
}

/* ─── Installazione ─────────────────────────────────────────────────────── */

let _installPrompt = null;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  _installPrompt = e;
  if (document.getElementById('login-form') && State.token === null) viewLogin();
});

function _isInstalled() {
  return window.matchMedia('(display-mode: standalone)').matches ||
         window.navigator.standalone === true;
}

function _installHint() {
  if (_isInstalled()) return '';
  if (_installPrompt)
    return `<button class="btn btn-secondary install-btn" id="btn-install">📲 Installa l'app</button>`;
  if (/iphone|ipad|ipod/i.test(navigator.userAgent))
    return `<div class="install-hint"><strong>Installa l'app:</strong> in Safari tocca Condividi,
      poi "Aggiungi alla schermata Home".</div>`;
  return `<div class="install-hint"><strong>Installa l'app:</strong> apri il menu del browser
    e scegli "Installa app".</div>`;
}

function _bindInstall() {
  document.getElementById('btn-install')?.addEventListener('click', async () => {
    _installPrompt.prompt();
    await _installPrompt.userChoice;
    _installPrompt = null;
    viewLogin();
  });
}

/* ─── Login ─────────────────────────────────────────────────────────────── */

async function viewLogin() {
  _hideShell();

  const main = document.getElementById('main-content');
  main.style.padding = '0';
  main.style.maxWidth = '100%';

  UI.setContent(`
    <div class="login-page">
      <img class="login-logo-img" src="icone/icona-192.png" alt="" width="84" height="84">
      <h1 class="login-title">Sistema Timbrature</h1>
      <p class="login-subtitle">Accedi con username e PIN</p>
      <div class="login-card">
        <div id="login-error" class="login-error hidden"></div>
        <form id="login-form" novalidate>
          <div class="form-group">
            <label class="form-label" for="inp-username">Username</label>
            <input class="form-control" type="text" id="inp-username"
                   autocomplete="username" autocapitalize="none" autocorrect="off"
                   spellcheck="false" placeholder="tuousername" required>
          </div>
          <div class="form-group">
            <label class="form-label" for="inp-pin">PIN</label>
            <input class="form-control" type="password" id="inp-pin"
                   autocomplete="current-password" placeholder="••••"
                   inputmode="numeric" maxlength="8" required>
          </div>
          <button type="submit" class="btn btn-primary btn-full" id="btn-login">
            Accedi
          </button>
        </form>
      </div>
      ${_installHint()}
    </div>
  `);
  _bindInstall();

  document.getElementById('login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const username = document.getElementById('inp-username').value.trim();
    const pin      = document.getElementById('inp-pin').value.trim();
    const errEl    = document.getElementById('login-error');
    const btn      = document.getElementById('btn-login');

    errEl.classList.add('hidden');
    btn.disabled = true;
    btn.textContent = 'Accesso in corso…';

    try {
      const data = await gasCall('login', username, pin);
      State.setSession(data.token, {
        userId: data.userId, nome: data.nome, username: data.username,
        ruolo: data.ruolo, oraCambioGiornata: data.oraCambioGiornata
      });

      document.getElementById('notification').classList.add('hidden');
      _setupShell(data.ruolo);
      await navigate(data.ruolo === 'admin' ? 'admin_dashboard' : 'home');
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = 'Accedi';
    }
  });
}

/* ─── Posizione ─────────────────────────────────────────────────────────── */

function leggiPosizione() {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
  });
}

/** La prima volta spiega al dipendente come viene usata la posizione. */
function informativaPosizione() {
  let letta = false;
  try { letta = localStorage.getItem('st_pos_info') === '1'; } catch (e) { /* mostra il testo */ }
  if (letta) return Promise.resolve();

  return new Promise(resolve => {
    window._posInfoOk = () => {
      try { localStorage.setItem('st_pos_info', '1'); } catch (e) { /* si ripresenterà */ }
      UI.hideModal();
      resolve();
    };
    UI.showModal(`
      <div class="modal-title">📍 Controllo della posizione</div>
      <div>L'app legge la tua posizione <strong>solo quando timbri</strong>, per verificare che tu sia al locale.</div>
      <p class="form-hint">Non segue i tuoi spostamenti. Vengono salvati solo l'esito del controllo e la distanza dal locale, non le coordinate.</p>
      <div class="modal-footer">
        <button class="btn btn-primary" onclick="_posInfoOk()">Ho capito</button>
      </div>
    `, true);
  });
}

/* ─── Home ──────────────────────────────────────────────────────────────── */

/** Nome leggibile del giorno a cui manca l'uscita. */
function _dayLabel(dateStr) {
  const today = workToday();
  if (dateStr === today) return 'di oggi';
  if (dateStr === addDays(today, -1)) return 'di ieri';
  return 'del ' + formatDay(dateStr);
}

async function viewHome() {
  UI.setTitle('Timbra');
  const [status, summary] = await Promise.all([
    gasCall('getMyStatus', State.token),
    gasCall('getMyHoursSummary', State.token)
  ]);

  const stato  = status.stato;
  const ultima = status.ultimaTimbratura;
  let statusClass, badgeClass, badgeText, statusInfo;

  if (stato === 'IN') {
    statusClass = 'inside';  badgeClass = 'badge-inside';
    badgeText   = '● In turno';
    statusInfo  = 'Sei entrato alle ' + ultima.timeFormatted;
  } else if (stato === 'VERIFICA') {
    statusClass = 'verify';  badgeClass = 'badge-verify';
    badgeText   = 'Turno da verificare';
    statusInfo  = 'Turno bloccato: puoi timbrare una nuova entrata';
  } else if (stato === 'OUT') {
    statusClass = 'outside'; badgeClass = 'badge-outside';
    badgeText   = '○ Fuori turno';
    statusInfo  = 'Sei uscito alle ' + ultima.timeFormatted;
  } else {
    statusClass = 'none';    badgeClass = 'badge-none';
    badgeText   = '— Non registrato';
    statusInfo  = 'Nessuna timbratura oggi';
  }

  const tipoProssimo = stato === 'IN' ? 'OUT' : 'IN';
  const btnClass = tipoProssimo === 'OUT' ? 'uscita' : 'entrata';
  const btnIcon  = tipoProssimo === 'OUT' ? '🔴' : '🟢';
  const btnText  = tipoProssimo === 'OUT' ? 'TIMBRA USCITA' : 'TIMBRA ENTRATA';

  const avvisi = (status.daCompletare || []).map(i => `
    <div class="alert-card">
      <div class="alert-title">Non hai timbrato l'uscita ${_dayLabel(i.date)}</div>
      <div class="alert-text">Turno iniziato alle ${UI.escHtml(i.oraEntrata)}.
        ${i.segnalata
          ? `Hai indicato l'uscita: ${UI.escHtml(i.oraDichiarata)}. In attesa di verifica.`
          : 'Indica a che ora sei uscito.'}
      </div>
      ${i.segnalata ? '' : `
        <div class="alert-actions">
          <button class="btn btn-secondary btn-sm"
            onclick="openSegnala('${UI.escHtml(i.inId)}','${UI.escHtml(i.entrataLocal)}')">Indica l'orario</button>
        </div>`}
    </div>`).join('');

  const { oggi, settimana, mese } = summary;

  UI.setContent(`
    ${avvisi}

    <div class="status-card ${statusClass}">
      <span class="status-badge ${badgeClass}">${badgeText}</span>
      <span class="status-name">${UI.escHtml(State.user.nome)}</span>
      <span class="status-info">${UI.escHtml(statusInfo)}</span>
    </div>

    <div class="text-center">
      <button id="btn-timbra" class="timbra-btn ${btnClass}">
        <span class="timbra-icon">${btnIcon}</span>
        <span class="timbra-text">${btnText}</span>
      </button>
    </div>

    <details class="note-toggle">
      <summary>Aggiungi una nota</summary>
      <input class="form-control" id="inp-note" placeholder="Es. Cambio turno con Luca" maxlength="255">
    </details>

    ${stato === 'IN' ? `
      <div class="text-center mb-16">
        <button class="link-btn"
          onclick="openSegnala('${UI.escHtml(ultima.id)}','${UI.escHtml(ultima.timestampLocal)}')">
          Ho dimenticato di timbrare l'uscita
        </button>
      </div>` : ''}

    <div class="card">
      <div class="card-title">📊 Riepilogo ore</div>
      <div class="hours-row">
        ${_hoursMini('Oggi',      oggi.worked,      oggi.balance)}
        ${_hoursMini('Settimana', settimana.worked, settimana.balance)}
        ${_hoursMini('Mese',      mese.worked,      mese.balance)}
      </div>
      ${mese.daVerificare > 0
        ? `<div class="form-hint">Le ore dei turni da verificare (${mese.daVerificare}) non sono incluse.</div>`
        : ''}
    </div>
  `);

  const btn = document.getElementById('btn-timbra');
  btn.addEventListener('click', () => {
    btn.disabled = true;
    _doTimbra(tipoProssimo, status.posizioneRichiesta);
  });
}

function _hoursMini(label, worked, balance) {
  const bCls = UI.balanceClass(balance);
  return `
    <div class="hours-mini">
      <div class="hours-mini-label">${label}</div>
      <div class="hours-mini-value">${UI.formatHours(worked)}</div>
      <div class="hours-mini-balance ${bCls}">${balance >= 0 ? '+' : ''}${UI.formatHours(balance)}</div>
    </div>`;
}

async function _doTimbra(tipoAtteso, conPosizione) {
  const note = document.getElementById('inp-note')?.value?.trim() || '';
  try {
    let posizione = null;
    if (conPosizione) {
      await informativaPosizione();
      UI.showLoading(true, 'Controllo la posizione…');
      posizione = await leggiPosizione();
    }
    UI.showLoading(true, 'Registro la timbratura…');
    const result = await gasCall('timbra', State.token, note, tipoAtteso, posizione);
    await navigate('home');

    const testo = result.nuovoStato === 'IN' ? 'Entrata registrata' : 'Uscita registrata';
    const esito = result.posizione?.esito;
    if (esito === 'FUORI_SEDE')
      UI.showNotification(`⚠️ ${testo}, ma risulti a ${_distanza(result.posizione.distanza)} dal locale`, 'warning', 6000);
    else if (esito === 'NON_DISPONIBILE')
      UI.showNotification(`⚠️ ${testo}, ma la posizione non è disponibile`, 'warning', 6000);
    else
      UI.showNotification('✅ ' + testo, 'success');
  } catch (e) {
    await navigate('home');
    UI.showNotification(e.message, 'error', 7000);
  } finally {
    UI.showLoading(false);
  }
}

function _distanza(m) {
  if (m === '' || m === null || m === undefined) return '';
  return m >= 1000 ? (m / 1000).toFixed(1).replace('.', ',') + ' km' : m + ' m';
}

/** Etichetta per l'esito del controllo posizione. */
function _posChip(t) {
  const esito = t.posizioneEsito || t.esito;
  const m     = t.distanzaMetri;
  if (esito === 'FUORI_SEDE')
    return `<span class="chip chip-orange">Fuori sede ${UI.escHtml(_distanza(m))}</span>`;
  if (esito === 'NON_DISPONIBILE')
    return `<span class="chip chip-gray">Posizione assente</span>`;
  return '';
}

function openSegnala(inId, entrataLocal) {
  UI.showModal(`
    <div class="modal-title">Ho dimenticato di timbrare l'uscita</div>
    <div class="form-group">
      <label class="form-label" for="sg-ora">A che ora sei uscito?</label>
      <input class="form-control" type="datetime-local" id="sg-ora"
             min="${UI.escHtml(entrataLocal)}" value="${romeInputNow()}">
      <div class="form-hint">Il turno resta in sospeso finché l'amministratore non lo conferma.</div>
    </div>
    <div class="form-group">
      <label class="form-label" for="sg-nota">Nota (facoltativa)</label>
      <input class="form-control" id="sg-nota" maxlength="255">
    </div>
    <div id="sg-error" class="login-error hidden"></div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="UI.hideModal()">Annulla</button>
      <button class="btn btn-primary" onclick="_doSegnala('${UI.escHtml(inId)}')">Invia</button>
    </div>
  `, true);
}

async function _doSegnala(inId) {
  const errEl = document.getElementById('sg-error');
  errEl.classList.add('hidden');
  try {
    await gasCall('segnalaUscita', State.token, inId,
      document.getElementById('sg-ora').value,
      document.getElementById('sg-nota').value.trim());
    UI.hideModal();
    await navigate('home');
    UI.showNotification('Segnalazione inviata', 'success');
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('hidden');
  }
}

/* ─── Calendario ────────────────────────────────────────────────────────── */

async function viewCalendario(params = {}) {
  UI.setTitle('Calendario');
  const today = workToday();
  const year  = params.year  || Number(today.slice(0, 4));
  const month = params.month || Number(today.slice(5, 7));

  UI.setContent('<div class="card"><div class="empty-state"><div class="spinner"></div></div></div>');

  const cal = await gasCall('getMyCalendar', State.token, year, month);
  _renderCalendar(cal);
}

function _renderCalendar(cal) {
  const { year, month, days, today } = cal;
  const monthNames = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno',
                      'Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];

  const firstDow = new Date(year, month - 1, 1).getDay();
  const offset   = (firstDow === 0) ? 6 : firstDow - 1;

  const anomalies = days.filter(d => d.hasAnomaly);

  let calCells = '';
  for (let i = 0; i < offset; i++) calCells += '<div class="cal-day empty"></div>';

  days.forEach(d => {
    const isToday   = d.date === today;
    const dayNum    = parseInt(d.date.substring(8), 10);
    let   cls;
    if      (d.hasAnomaly)              cls = 'anomaly';
    else if (d.isOpen)                  cls = 'open';
    else if (d.timbrature.length > 0)   cls = 'ok';
    else if (d.contracted > 0)          cls = 'nowork';
    else                                cls = 'empty';
    if (isToday) cls += ' today';

    const hoursStr = d.totalHours > 0 ? UI.formatHours(d.totalHours) : '';
    const dot = d.hasAnomaly ? '<span class="cal-dot"></span>' : '';

    calCells += `
      <div class="cal-day ${cls}" data-date="${d.date}" title="${UI.escHtml(d.anomalyReason || '')}">
        <span class="cal-day-num">${dayNum}</span>
        <span class="cal-day-hrs">${hoursStr}</span>
        ${dot}
      </div>`;
  });

  let anomalyHtml = '';
  if (anomalies.length > 0) {
    anomalyHtml = '<div class="card"><div class="card-title">⚠️ Turni da verificare</div>';
    anomalies.forEach(d => {
      anomalyHtml += `
        <div class="anomaly-item">
          <div class="anomaly-date">${formatDay(d.date)}</div>
          <div class="anomaly-reason">${UI.escHtml(d.anomalyReason || '')}</div>
        </div>`;
    });
    anomalyHtml += '</div>';
  }

  UI.setContent(`
    <div class="card">
      <div class="cal-nav">
        <button class="btn btn-secondary btn-sm" id="cal-prev" aria-label="Mese precedente">&#8249;</button>
        <span class="cal-nav-title">${monthNames[month - 1]} ${year}</span>
        <button class="btn btn-secondary btn-sm" id="cal-next" aria-label="Mese successivo">&#8250;</button>
      </div>
      <div class="cal-grid">
        <div class="cal-dow">Lun</div><div class="cal-dow">Mar</div>
        <div class="cal-dow">Mer</div><div class="cal-dow">Gio</div>
        <div class="cal-dow">Ven</div><div class="cal-dow">Sab</div>
        <div class="cal-dow">Dom</div>
        ${calCells}
      </div>
    </div>
    ${anomalyHtml}
  `);

  document.getElementById('cal-prev').addEventListener('click', () => {
    let m = month - 1, y = year;
    if (m < 1) { m = 12; y--; }
    navigate('calendario', { year: y, month: m });
  });
  document.getElementById('cal-next').addEventListener('click', () => {
    let m = month + 1, y = year;
    if (m > 12) { m = 1; y++; }
    navigate('calendario', { year: y, month: m });
  });

  document.querySelectorAll('.cal-day[data-date]').forEach(el => {
    el.addEventListener('click', () => {
      const dateStr = el.dataset.date;
      const day = days.find(d => d.date === dateStr);
      if (!day || day.timbrature.length === 0) return;
      _showDayDetail(day);
    });
  });
}

function _showDayDetail(day) {
  let rows = day.timbrature.map(t => `
    <div class="list-item">
      <div class="list-badge ${t.tipo === 'IN' ? 'badge-in' : 'badge-out'}">${UI.escHtml(t.tipo)}</div>
      <div class="list-body">
        <div class="list-title">${UI.escHtml(t.timestampFormatted)}</div>
        ${t.note ? `<div class="list-sub">${UI.escHtml(t.note)}</div>` : ''}
      </div>
    </div>`).join('');

  const anomalyBanner = day.hasAnomaly
    ? `<div class="anomaly-item mb-8"><div class="anomaly-date">⚠️ Da verificare</div>
       <div class="anomaly-reason">${UI.escHtml(day.anomalyReason || '')}</div></div>` : '';

  UI.showModal(`
    <div class="modal-title">📅 ${formatDay(day.date)}</div>
    ${anomalyBanner}
    <div><strong>Ore lavorate:</strong> ${UI.formatHours(day.totalHours)} /
         ${UI.formatHours(day.contracted)} previste</div>
    <hr class="divider">
    ${rows}
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="UI.hideModal()">Chiudi</button>
    </div>
  `, true);
}

/* ─── Monte ore ─────────────────────────────────────────────────────────── */

async function viewMonteOre() {
  UI.setTitle('Monte Ore');
  const summary = await gasCall('getMyHoursSummary', State.token);
  const { oggi, settimana, mese } = summary;

  UI.setContent(`
    <div class="card">
      <div class="card-title">⏱ Riepilogo ore</div>
      <div class="ore-summary">
        ${_oreCard('Oggi',      oggi)}
        ${_oreCard('Settimana', settimana)}
        ${_oreCard('Mese',      mese)}
      </div>
      ${mese.daVerificare > 0
        ? `<div class="form-hint">Le ore dei turni da verificare (${mese.daVerificare}) non sono incluse.</div>`
        : ''}
    </div>

    <div class="card ore-balance-big"
         style="background:${mese.balance >= 0 ? 'var(--success-bg)' : 'var(--error-bg)'}">
      <div class="label text-secondary">Saldo mensile</div>
      <div class="value ${UI.balanceClass(mese.balance)}">
        ${mese.balance >= 0 ? '+' : ''}${UI.formatHours(mese.balance)}
      </div>
    </div>
  `);
}

function _oreCard(label, data) {
  const bCls = UI.balanceClass(data.balance);
  return `
    <div class="ore-card">
      <div class="ore-period">${label}</div>
      <div class="ore-value">${UI.formatHours(data.worked)}</div>
      <div class="ore-sub">/ ${UI.formatHours(data.contracted)}</div>
      <div class="hours-mini-balance ${bCls} mt-16" style="margin-top:6px">
        ${data.balance >= 0 ? '+' : ''}${UI.formatHours(data.balance)}
      </div>
    </div>`;
}

/* ─── Storico ───────────────────────────────────────────────────────────── */

async function viewStorico(params = {}) {
  UI.setTitle('Storico Timbrature');

  const today = workToday();
  const start = params.start || today.slice(0, 8) + '01';
  const end   = params.end   || today;

  const ts = await gasCall('getMyTimbrature', State.token, start, end);

  let rows = '';
  if (ts.length === 0) {
    rows = `<div class="empty-state">
      <div class="empty-icon">📋</div>
      <div class="empty-text">Nessuna timbratura nel periodo selezionato</div>
    </div>`;
  } else {
    rows = ts.slice().reverse().map(t => `
      <div class="list-item">
        <div class="list-badge ${t.tipo === 'IN' ? 'badge-in' : 'badge-out'}">${UI.escHtml(t.tipo)}</div>
        <div class="list-body">
          <div class="list-title">${UI.escHtml(t.timestampFormatted)}</div>
          ${t.note ? `<div class="list-sub">${UI.escHtml(t.note)}</div>` : ''}
        </div>
      </div>`).join('');
  }

  UI.setContent(`
    <div class="card">
      <div class="card-title">🔍 Filtra periodo</div>
      <div class="filters">
        <div class="form-group">
          <label class="form-label" for="f-start">Da</label>
          <input class="form-control" type="date" id="f-start" value="${start}">
        </div>
        <div class="form-group">
          <label class="form-label" for="f-end">A</label>
          <input class="form-control" type="date" id="f-end" value="${end}">
        </div>
        <div class="filter-actions">
          <button class="btn btn-primary btn-sm" id="btn-filter">Cerca</button>
        </div>
      </div>
    </div>
    <div class="card">${rows}</div>
  `);

  document.getElementById('btn-filter').addEventListener('click', () => {
    navigate('storico', {
      start: document.getElementById('f-start').value,
      end:   document.getElementById('f-end').value
    });
  });
}

/* ─── Admin: dashboard ──────────────────────────────────────────────────── */

async function viewAdminDashboard() {
  UI.setTitle('Dashboard');
  const [dash, users] = await Promise.all([
    gasCall('adminGetDashboard', State.token),
    gasCall('adminGetUsers', State.token)
  ]);
  window._adminUsers = users;

  const { utentiAttivi, presenti, listaPresenti, daVerificare,
          anomalie, segnalazioni, ultimiEventi, fuoriSede } = dash;

  const fuoriRows = (fuoriSede || []).map(t => `
    <div class="list-item">
      <div class="list-badge ${t.tipo === 'IN' ? 'badge-in' : 'badge-out'}">${UI.escHtml(t.tipo)}</div>
      <div class="list-body">
        <div class="list-title">${UI.escHtml(t.nomeUtente)}</div>
        <div class="list-sub">${UI.escHtml(t.timestampFormatted)}</div>
      </div>
      ${_posChip(t)}
    </div>`).join('');

  const segnRows = segnalazioni.map(s => `
    <div class="alert-card">
      <div class="alert-title">${UI.escHtml(s.nomeUtente)}: uscita dimenticata</div>
      <div class="alert-text">Entrata ${UI.escHtml(s.entrataFmt)} · uscita dichiarata
        <strong>${UI.escHtml(s.uscitaFmt)}</strong></div>
      ${s.nota ? `<div class="alert-text">${UI.escHtml(s.nota)}</div>` : ''}
      <div class="alert-actions">
        <button class="btn btn-primary btn-sm" onclick="adminSegnalazione('${UI.escHtml(s.id)}',true)">Conferma l'uscita</button>
        <button class="btn btn-secondary btn-sm" onclick="adminSegnalazione('${UI.escHtml(s.id)}',false)">Rifiuta</button>
      </div>
    </div>`).join('');

  const verificaRows = anomalie.flatMap(a => a.issues
    .filter(i => !i.segnalata)
    .map(i => `
    <div class="anomaly-item">
      <div class="anomaly-date">${formatDay(a.date)} — <span class="anomaly-user">${UI.escHtml(a.nomeUtente)}</span></div>
      <div class="anomaly-reason">${UI.escHtml(i.testo)}</div>
      <div class="alert-actions">${_issueAction(a, i)}</div>
    </div>`)).join('');

  const presentiRows = listaPresenti.map(p => `
    <div class="list-item">
      <div class="list-badge badge-in">IN</div>
      <div class="list-body">
        <div class="list-title">${UI.escHtml(p.nome)}</div>
        <div class="list-sub">dalle ${UI.escHtml(p.dalle)}</div>
      </div>
    </div>`).join('');

  const recentRows = ultimiEventi.length === 0
    ? '<div class="empty-state"><div class="empty-text">Nessun evento</div></div>'
    : ultimiEventi.map(t => `
        <div class="list-item">
          <div class="list-badge ${t.tipo === 'IN' ? 'badge-in' : 'badge-out'}">${UI.escHtml(t.tipo)}</div>
          <div class="list-body">
            <div class="list-title">${UI.escHtml(t.nomeUtente)}</div>
            <div class="list-sub">${UI.escHtml(t.timestampFormatted)}</div>
          </div>
        </div>`).join('');

  UI.setContent(`
    <div class="stat-grid">
      <div class="stat-card success">
        <div class="stat-value">${presenti}</div>
        <div class="stat-label">In turno ora</div>
      </div>
      <div class="stat-card ${daVerificare > 0 ? 'error' : ''}">
        <div class="stat-value">${daVerificare}</div>
        <div class="stat-label">Da verificare</div>
      </div>
      <div class="stat-card ${segnalazioni.length > 0 ? 'warning' : ''}">
        <div class="stat-value">${segnalazioni.length}</div>
        <div class="stat-label">Segnalazioni</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${utentiAttivi}</div>
        <div class="stat-label">Dipendenti attivi</div>
      </div>
    </div>

    ${segnalazioni.length ? `<div class="card"><div class="card-title">📩 Segnalazioni dei dipendenti</div>${segnRows}</div>` : ''}
    ${verificaRows ? `<div class="card"><div class="card-title">⚠️ Turni da verificare (ultimi 30 giorni)</div>${verificaRows}</div>` : ''}
    ${fuoriRows ? `<div class="card"><div class="card-title">📍 Timbrature da controllare (ultimi 7 giorni)</div>${fuoriRows}</div>` : ''}
    ${presentiRows ? `<div class="card"><div class="card-title">🟢 In turno ora</div>${presentiRows}</div>` : ''}

    <div class="card">
      <div class="card-title">🕐 Ultimi eventi</div>
      ${recentRows}
    </div>
  `);
}

/** Pulsante giusto per ogni tipo di turno da verificare. */
function _issueAction(a, i) {
  const uid = UI.escHtml(a.userId);
  if (i.codice === 'MANCA_USCITA') {
    return `<button class="btn btn-primary btn-sm"
      onclick="adminNewTimbratura({userId:'${uid}',tipo:'OUT',timestamp:'${UI.escHtml(i.entrataLocal)}'})">Inserisci l'uscita</button>`;
  }
  if (i.codice === 'USCITA_SENZA_ENTRATA') {
    return `<button class="btn btn-primary btn-sm"
      onclick="adminNewTimbratura({userId:'${uid}',tipo:'IN',timestamp:'${UI.escHtml(i.outLocal)}'})">Inserisci l'entrata</button>`;
  }
  return `<button class="btn btn-primary btn-sm"
    onclick="adminOpenEdit({id:'${UI.escHtml(i.outId)}',userId:'${uid}',tipo:'OUT',timestampLocal:'${UI.escHtml(i.outLocal)}',note:''})">Correggi l'uscita</button>`;
}

async function adminSegnalazione(id, applica) {
  UI.showLoading(true);
  try {
    await gasCall('adminGestisciSegnalazione', State.token, id, applica);
    await navigate('admin_dashboard');
    UI.showNotification(applica ? 'Uscita confermata' : 'Segnalazione rifiutata', 'success');
  } catch (e) {
    UI.showNotification(e.message, 'error');
  } finally {
    UI.showLoading(false);
  }
}

/* ─── Admin: utenti ─────────────────────────────────────────────────────── */

const GIORNI = ['LUN','MAR','MER','GIO','VEN','SAB','DOM'];

async function viewAdminUtenti() {
  UI.setTitle('Gestione Utenti');
  const users = await gasCall('adminGetUsers', State.token);
  window._adminUsers = users;

  const rows = users.map(u => `
    <tr>
      <td>${UI.escHtml(u.nome)}</td>
      <td>${UI.escHtml(u.username)}</td>
      <td>${u.oreSettimanali ? UI.escHtml(u.oreSettimanali) + 'h' : '—'}</td>
      <td><span class="chip ${u.ruolo === 'admin' ? 'chip-blue' : 'chip-gray'}">${UI.escHtml(u.ruolo)}</span></td>
      <td><span class="chip ${u.attivo ? 'chip-green' : 'chip-red'}">${u.attivo ? 'Attivo' : 'Inattivo'}</span></td>
      <td class="td-actions">
        <button class="btn btn-secondary btn-sm" aria-label="Modifica" onclick="adminEditUser('${UI.escHtml(u.userId)}')">✏️</button>
        <button class="btn btn-secondary btn-sm" aria-label="${u.attivo ? 'Disattiva' : 'Attiva'}" onclick="adminToggleActive('${UI.escHtml(u.userId)}',${!u.attivo})">${u.attivo ? '🔴' : '🟢'}</button>
        <button class="btn btn-secondary btn-sm" aria-label="Reimposta PIN" onclick="adminResetPin('${UI.escHtml(u.userId)}')">🔑</button>
        <button class="btn btn-secondary btn-sm" aria-label="Disconnetti i dispositivi" onclick="adminDisconnect('${UI.escHtml(u.userId)}')">📵</button>
      </td>
    </tr>`).join('');

  UI.setContent(`
    <div class="flex-between mb-16">
      <h2 style="font-size:1rem;font-weight:700">👥 Utenti (${users.length})</h2>
      <button class="btn btn-primary btn-sm" onclick="adminNewUser()">+ Nuovo</button>
    </div>
    <div class="card" style="padding:0">
      <div class="table-container">
        <table>
          <thead><tr>
            <th>Nome</th><th>Username</th><th>Ore</th><th>Ruolo</th>
            <th>Stato</th><th>Azioni</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `);
}

function adminNewUser() {
  UI.showModal(_userForm(null), true);
}

function adminEditUser(userId) {
  const u = (window._adminUsers || []).find(x => x.userId === userId);
  if (u) UI.showModal(_userForm(u), true);
}

function _userForm(u) {
  const isNew  = !u;
  const riposi = String(u?.giorniRiposo || '').split(',').map(g => g.trim().toUpperCase());
  return `
    <div class="modal-title">${isNew ? '➕ Nuovo utente' : '✏️ Modifica utente'}</div>
    <form id="user-form" data-userid="${u ? UI.escHtml(u.userId) : ''}" novalidate>
      <div class="form-group">
        <label class="form-label" for="uf-nome">Nome *</label>
        <input class="form-control" id="uf-nome" value="${u ? UI.escHtml(u.nome) : ''}" required>
      </div>
      <div class="form-group">
        <label class="form-label" for="uf-username">Username *</label>
        <input class="form-control" type="text" id="uf-username" autocapitalize="none" autocorrect="off"
               value="${u ? UI.escHtml(u.username) : ''}" ${u ? 'readonly style="background:var(--bg)"' : ''} required>
      </div>
      ${isNew ? `<div class="form-group">
        <label class="form-label" for="uf-pin">PIN (4–8 cifre) *</label>
        <input class="form-control" type="password" id="uf-pin" inputmode="numeric" maxlength="8" required>
      </div>` : ''}
      <div class="form-group">
        <label class="form-label" for="uf-ore">Ore settimanali</label>
        <input class="form-control" type="number" id="uf-ore" min="0" max="60" step="0.5"
               value="${u && u.oreSettimanali ? UI.escHtml(u.oreSettimanali) : ''}">
        <div class="form-hint">Se lo lasci vuoto valgono le ore generali della Configurazione.</div>
      </div>
      <div class="form-group">
        <span class="form-label">Giorni di riposo</span>
        <div class="check-row">
          ${GIORNI.map(g => `
            <label class="check-chip">
              <input type="checkbox" name="uf-riposo" value="${g}" ${riposi.includes(g) ? 'checked' : ''}>
              ${g.charAt(0) + g.slice(1).toLowerCase()}
            </label>`).join('')}
        </div>
      </div>
      <div class="form-group">
        <label class="form-label" for="uf-ruolo">Ruolo *</label>
        <select class="form-control" id="uf-ruolo">
          <option value="user" ${(!u || u.ruolo === 'user') ? 'selected' : ''}>Utente</option>
          <option value="admin" ${u && u.ruolo === 'admin' ? 'selected' : ''}>Amministratore</option>
        </select>
      </div>
      <div id="uf-error" class="login-error hidden"></div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" onclick="UI.hideModal()">Annulla</button>
        <button type="submit" class="btn btn-primary">${isNew ? 'Crea' : 'Salva'}</button>
      </div>
    </form>`;
}

document.addEventListener('submit', async e => {
  if (e.target.id !== 'user-form') return;
  e.preventDefault();
  const errEl = document.getElementById('uf-error');
  errEl.classList.add('hidden');

  const nome     = document.getElementById('uf-nome').value.trim();
  const username = document.getElementById('uf-username').value.trim();
  const ruolo    = document.getElementById('uf-ruolo').value;
  const pinEl    = document.getElementById('uf-pin');
  const oreSettimanali = document.getElementById('uf-ore').value;
  const giorniRiposo   = Array.from(document.querySelectorAll('input[name="uf-riposo"]:checked'))
    .map(c => c.value).join(',');

  try {
    if (!nome) throw new Error('Nome obbligatorio.');
    if (pinEl) {
      await gasCall('adminCreateUser', State.token, {
        nome, username, pin: pinEl.value, ruolo, oreSettimanali, giorniRiposo
      });
      UI.showNotification('Utente creato', 'success');
    } else {
      await gasCall('adminUpdateUser', State.token, e.target.dataset.userid,
        { nome, ruolo, oreSettimanali, giorniRiposo });
      UI.showNotification('Utente aggiornato', 'success');
    }
    UI.hideModal();
    await navigate('admin_utenti');
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  }
});

async function adminToggleActive(userId, newState) {
  try {
    await gasCall('adminToggleUserActive', State.token, userId, newState);
    UI.showNotification(newState ? 'Utente attivato' : 'Utente disattivato', 'info');
    await navigate('admin_utenti');
  } catch (e) { UI.showNotification(e.message, 'error'); }
}

function adminDisconnect(userId) {
  const u = (window._adminUsers || []).find(x => x.userId === userId);
  UI.showModal(`
    <div class="modal-title">📵 Disconnetti i dispositivi</div>
    <div>${UI.escHtml(u ? u.nome : '')} dovrà rifare l'accesso su tutti i telefoni.
      Usalo se il telefono è stato perso o cambiato.</div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="UI.hideModal()">Annulla</button>
      <button class="btn btn-error" onclick="_doDisconnect('${UI.escHtml(userId)}')">Disconnetti</button>
    </div>
  `, true);
}

async function _doDisconnect(userId) {
  try {
    const chiuse = await gasCall('adminDisconnectUser', State.token, userId);
    UI.hideModal();
    UI.showNotification(chiuse === 1 ? '1 dispositivo disconnesso' : `${chiuse} dispositivi disconnessi`, 'success');
  } catch (e) { UI.showNotification(e.message, 'error'); }
}

function adminResetPin(userId) {
  UI.showModal(`
    <div class="modal-title">🔑 Reset PIN</div>
    <div class="form-group">
      <label class="form-label" for="new-pin">Nuovo PIN (4–8 cifre)</label>
      <input class="form-control" type="password" id="new-pin" inputmode="numeric" maxlength="8">
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="UI.hideModal()">Annulla</button>
      <button class="btn btn-primary" onclick="_doResetPin('${UI.escHtml(userId)}')">Salva</button>
    </div>
  `, true);
}

async function _doResetPin(userId) {
  const pin = document.getElementById('new-pin').value;
  try {
    await gasCall('adminResetUserPin', State.token, userId, pin);
    UI.showNotification('PIN reimpostato', 'success');
    UI.hideModal();
  } catch (e) { UI.showNotification(e.message, 'error'); }
}

/* ─── Admin: timbrature ─────────────────────────────────────────────────── */

let _tsFilter = null;

/** Dopo una correzione torna alla schermata da cui si e' partiti. */
function _adminRefreshAfterEdit() {
  return navigate(document.querySelector('.nav-btn.active')?.dataset.view === 'admin_dashboard'
    ? 'admin_dashboard' : 'admin_timbrature', _tsFilter || {});
}

async function viewAdminTimbrature(params = {}) {
  UI.setTitle('Gestione Timbrature');

  const today = workToday();
  const start = params.start || today;
  const end   = params.end   || today;
  _tsFilter   = { start, end };

  const [ts, users] = await Promise.all([
    gasCall('adminGetTimbrature', State.token, start, end, null),
    gasCall('adminGetUsers',      State.token)
  ]);
  window._adminUsers = users;
  window._adminTs    = {};
  ts.forEach(t => { window._adminTs[t.id] = t; });

  const rows = ts.length === 0
    ? `<tr><td colspan="5" class="text-center text-secondary" style="padding:24px">Nessuna timbratura</td></tr>`
    : ts.map(t => `
        <tr>
          <td>${UI.escHtml(t.nomeUtente)}</td>
          <td>${UI.escHtml(t.timestampFormatted)}</td>
          <td><span class="chip ${t.tipo === 'IN' ? 'chip-green' : 'chip-red'}">${UI.escHtml(t.tipo)}</span></td>
          <td>${UI.escHtml(t.note || '')} ${_posChip(t)}</td>
          <td class="td-actions">
            <button class="btn btn-secondary btn-sm" aria-label="Modifica" onclick="adminEditTimbratura('${UI.escHtml(t.id)}')">✏️</button>
            <button class="btn btn-error btn-sm" aria-label="Elimina" onclick="adminDelTimbratura('${UI.escHtml(t.id)}')">🗑</button>
          </td>
        </tr>`).join('');

  UI.setContent(`
    <div class="card">
      <div class="flex-between mb-8">
        <span class="fw-600">Filtri</span>
        <button class="btn btn-primary btn-sm" onclick="adminNewTimbratura()">+ Manuale</button>
      </div>
      <div class="filters">
        <div class="form-group">
          <label class="form-label" for="tf-start">Da</label>
          <input class="form-control" type="date" id="tf-start" value="${start}">
        </div>
        <div class="form-group">
          <label class="form-label" for="tf-end">A</label>
          <input class="form-control" type="date" id="tf-end" value="${end}">
        </div>
        <div class="filter-actions">
          <button class="btn btn-primary btn-sm" id="btn-tf">Cerca</button>
        </div>
      </div>
      <div class="form-hint">Le date sono giornate lavorative: un'uscita alle 2 di notte è sul giorno prima.</div>
    </div>
    <div class="card" style="padding:0">
      <div class="table-container">
        <table>
          <thead><tr><th>Utente</th><th>Data/Ora</th><th>Tipo</th><th>Note</th><th>Azioni</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `);

  document.getElementById('btn-tf').addEventListener('click', () => {
    navigate('admin_timbrature', {
      start: document.getElementById('tf-start').value,
      end:   document.getElementById('tf-end').value
    });
  });
}

function _userOptions(selected) {
  return (window._adminUsers || []).map(u =>
    `<option value="${UI.escHtml(u.userId)}" ${u.userId === selected ? 'selected' : ''}>${UI.escHtml(u.nome)}</option>`
  ).join('');
}

function adminNewTimbratura(preset = {}) {
  const tipo = preset.tipo || 'IN';
  UI.showModal(`
    <div class="modal-title">➕ Inserimento manuale</div>
    <form id="ts-form" novalidate>
      <div class="form-group">
        <label class="form-label" for="ts-user">Utente *</label>
        <select class="form-control" id="ts-user">${_userOptions(preset.userId)}</select>
      </div>
      <div class="form-group">
        <label class="form-label" for="ts-tipo">Tipo *</label>
        <select class="form-control" id="ts-tipo">
          <option value="IN"  ${tipo === 'IN'  ? 'selected' : ''}>IN — Entrata</option>
          <option value="OUT" ${tipo === 'OUT' ? 'selected' : ''}>OUT — Uscita</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label" for="ts-ts">Data e ora *</label>
        <input class="form-control" type="datetime-local" id="ts-ts"
               value="${UI.escHtml(preset.timestamp || romeInputNow())}" required>
      </div>
      <div class="form-group">
        <label class="form-label" for="ts-note">Note</label>
        <input class="form-control" id="ts-note" maxlength="255">
      </div>
      <div id="ts-error" class="login-error hidden"></div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" onclick="UI.hideModal()">Annulla</button>
        <button type="submit" class="btn btn-primary">Inserisci</button>
      </div>
    </form>`, true);
}

function adminEditTimbratura(id) {
  const t = window._adminTs?.[id];
  if (t) adminOpenEdit(t);
}

/** Il modulo si apre sempre con i dati reali della timbratura. */
function adminOpenEdit(t) {
  window._editOriginal = t;
  UI.showModal(`
    <div class="modal-title">✏️ Modifica timbratura</div>
    <form id="ts-edit-form" data-id="${UI.escHtml(t.id)}" novalidate>
      <div class="form-group">
        <label class="form-label" for="ts-edit-user">Utente *</label>
        <select class="form-control" id="ts-edit-user">${_userOptions(t.userId)}</select>
      </div>
      <div class="form-group">
        <label class="form-label" for="ts-edit-tipo">Tipo *</label>
        <select class="form-control" id="ts-edit-tipo">
          <option value="IN"  ${t.tipo === 'IN'  ? 'selected' : ''}>IN — Entrata</option>
          <option value="OUT" ${t.tipo === 'OUT' ? 'selected' : ''}>OUT — Uscita</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label" for="ts-edit-ts">Data e ora *</label>
        <input class="form-control" type="datetime-local" id="ts-edit-ts"
               value="${UI.escHtml(t.timestampLocal)}" required>
      </div>
      <div class="form-group">
        <label class="form-label" for="ts-edit-note">Note</label>
        <input class="form-control" id="ts-edit-note" maxlength="255" value="${UI.escHtml(t.note || '')}">
      </div>
      <div id="ts-edit-error" class="login-error hidden"></div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" onclick="UI.hideModal()">Annulla</button>
        <button type="submit" class="btn btn-primary">Salva</button>
      </div>
    </form>`, true);
}

document.addEventListener('submit', async e => {
  if (e.target.id !== 'ts-form') return;
  e.preventDefault();

  const errEl = document.getElementById('ts-error');
  errEl.classList.add('hidden');

  const data = {
    userId: document.getElementById('ts-user').value,
    tipo: document.getElementById('ts-tipo').value,
    timestamp: document.getElementById('ts-ts').value,
    note: document.getElementById('ts-note').value.trim()
  };

  try {
    await gasCall('adminInsertTimbratura', State.token, data);
    UI.hideModal();
    await _adminRefreshAfterEdit();
    UI.showNotification('Timbratura inserita', 'success');
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  }
});

document.addEventListener('submit', async e => {
  if (e.target.id !== 'ts-edit-form') return;
  e.preventDefault();

  const errEl = document.getElementById('ts-edit-error');
  errEl.classList.add('hidden');

  const id   = e.target.dataset.id;
  const orig = window._editOriginal || {};
  const updates = {
    userId: document.getElementById('ts-edit-user').value,
    tipo: document.getElementById('ts-edit-tipo').value,
    note: document.getElementById('ts-edit-note').value.trim()
  };
  const ts = document.getElementById('ts-edit-ts').value;

  // L'orario si invia solo se cambia, per non perdere i secondi originali.
  // Da "Correggi l'uscita" si invia sempre: conferma l'orario del turno.
  if (ts !== orig.timestampLocal || !orig.nomeUtente) updates.timestamp = ts;

  try {
    await gasCall('adminUpdateTimbratura', State.token, id, updates);
    UI.hideModal();
    await _adminRefreshAfterEdit();
    UI.showNotification('Timbratura aggiornata', 'success');
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  }
});

async function adminDelTimbratura(id) {
  if (!confirm('Eliminare questa timbratura?')) return;
  try {
    await gasCall('adminDeleteTimbratura', State.token, id);
    UI.showNotification('Timbratura eliminata', 'info');
    await navigate('admin_timbrature', _tsFilter || {});
  } catch (e) { UI.showNotification(e.message, 'error'); }
}

/* ─── Admin: riepilogo del mese ─────────────────────────────────────────── */

async function viewAdminMese(params = {}) {
  UI.setTitle('Riepilogo del mese');

  const today = workToday();
  const anno  = params.anno || Number(today.slice(0, 4));
  const mese  = params.mese || Number(today.slice(5, 7));
  const nomi  = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno',
                 'Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];

  const rows = await gasCall('adminGetMonthlyReport', State.token, anno, mese);

  const body = rows.length === 0
    ? `<tr><td colspan="5" class="text-center text-secondary" style="padding:24px">Nessun dato per questo mese</td></tr>`
    : rows.map(r => `
        <tr>
          <td>${UI.escHtml(r.nome)}</td>
          <td>${UI.formatHours(r.oreLavorate)}</td>
          <td>${UI.formatHours(r.orePreviste)}</td>
          <td class="${UI.balanceClass(r.saldo)}">${r.saldo >= 0 ? '+' : ''}${UI.formatHours(r.saldo)}</td>
          <td>${r.anomalie > 0 ? `<span class="chip chip-orange">${r.anomalie}</span>` : '—'}</td>
        </tr>`).join('');

  const sospesi = rows.reduce((n, r) => n + r.anomalie, 0);

  UI.setContent(`
    <div class="card">
      <div class="cal-nav">
        <button class="btn btn-secondary btn-sm" id="mese-prev" aria-label="Mese precedente">&#8249;</button>
        <span class="cal-nav-title">${nomi[mese - 1]} ${anno}</span>
        <button class="btn btn-secondary btn-sm" id="mese-next" aria-label="Mese successivo">&#8250;</button>
      </div>
      ${sospesi > 0
        ? `<div class="alert-card"><div class="alert-title">${sospesi} turni da verificare</div>
           <div class="alert-text">Le loro ore non sono nel totale. Correggili prima di inviare il riepilogo.</div></div>`
        : ''}
      <button class="btn btn-primary btn-full" id="mese-export">Crea il foglio per il consulente</button>
      <div id="mese-link" class="form-hint"></div>
    </div>
    <div class="card" style="padding:0">
      <div class="table-container">
        <table>
          <thead><tr><th>Dipendente</th><th>Ore</th><th>Previste</th><th>Saldo</th><th>Da verificare</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </div>
  `);

  document.getElementById('mese-prev').addEventListener('click', () => {
    navigate('admin_mese', mese === 1 ? { anno: anno - 1, mese: 12 } : { anno, mese: mese - 1 });
  });
  document.getElementById('mese-next').addEventListener('click', () => {
    navigate('admin_mese', mese === 12 ? { anno: anno + 1, mese: 1 } : { anno, mese: mese + 1 });
  });
  document.getElementById('mese-export').addEventListener('click', async () => {
    UI.showLoading(true);
    try {
      const r = await gasCall('adminExportMonth', State.token, anno, mese);
      document.getElementById('mese-link').innerHTML =
        `Foglio pronto: <a href="${UI.escHtml(r.url)}" target="_blank" rel="noopener">${UI.escHtml(r.nomeFoglio)}</a>`;
      UI.showNotification('Foglio creato', 'success');
    } catch (e) {
      UI.showNotification(e.message, 'error');
    } finally {
      UI.showLoading(false);
    }
  });
}

/* ─── Admin: registro attività ──────────────────────────────────────────── */

async function viewAdminRegistro() {
  UI.setTitle('Registro attività');
  const rows = await gasCall('adminGetAuditLog', State.token, 200);

  const items = rows.length === 0
    ? '<div class="empty-state"><div class="empty-text">Nessuna attività registrata</div></div>'
    : rows.map(r => `
        <div class="list-item">
          <div class="list-body">
            <div class="list-title">${UI.escHtml(r.operazione)} · ${UI.escHtml(r.utente)}</div>
            <div class="list-sub">${UI.escHtml(r.timestampFormatted)}</div>
            <div class="audit-desc">${UI.escHtml(r.descrizione)}</div>
          </div>
        </div>`).join('');

  UI.setContent(`<div class="card">${items}</div>`);
}

/* ─── Admin: configurazione ─────────────────────────────────────────────── */

const CONFIG_CAMPI = [
  ['oraCambioGiornata', 'Ora di cambio giornata (0–12)', 'Prima di quest\'ora le timbrature contano sul giorno precedente.'],
  ['limiteTurnoOre',    'Limite turno aperto (ore)',     'Oltre questo limite un turno aperto va da verificare.'],
  ['oreLunedi',    'Ore previste lunedì'],
  ['oreMartedi',   'Ore previste martedì'],
  ['oreMercoledi', 'Ore previste mercoledì'],
  ['oreGiovedi',   'Ore previste giovedì'],
  ['oreVenerdi',   'Ore previste venerdì'],
  ['oreSabato',    'Ore previste sabato'],
  ['oreDomenica',  'Ore previste domenica']
];

async function viewAdminConfig() {
  UI.setTitle('Configurazione');
  const cfg = await gasCall('getConfig', State.token);

  const campi = CONFIG_CAMPI.filter(c => c[0] in cfg);
  const modo  = String(cfg.modoPosizione || 'OFF');
  const opt   = (v, label) => `<option value="${v}" ${modo === v ? 'selected' : ''}>${label}</option>`;

  UI.setContent(`
    <form id="config-form" novalidate>
      <div class="card">
        <div class="card-title">📍 Controllo della posizione</div>
        <div class="form-group">
          <label class="form-label" for="cfg-modoPosizione">Quando si timbra lontano dal locale</label>
          <select class="form-control" id="cfg-modoPosizione">
            ${opt('OFF', 'Nessun controllo')}
            ${opt('SEGNALA', 'Registra e segnala all\'amministratore')}
            ${opt('BLOCCA', 'Non permettere la timbratura')}
          </select>
        </div>
        <div class="form-group">
          <span class="form-label">Posizione del locale</span>
          <button type="button" class="btn btn-secondary btn-full" id="btn-pos-sede">Usa la mia posizione attuale</button>
          <div class="form-hint">Premilo mentre sei al locale.</div>
        </div>
        <div class="coord-row">
          <div class="form-group">
            <label class="form-label" for="cfg-latSede">Latitudine</label>
            <input class="form-control" id="cfg-latSede" inputmode="decimal" value="${UI.escHtml(cfg.latSede ?? '')}">
          </div>
          <div class="form-group">
            <label class="form-label" for="cfg-lngSede">Longitudine</label>
            <input class="form-control" id="cfg-lngSede" inputmode="decimal" value="${UI.escHtml(cfg.lngSede ?? '')}">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label" for="cfg-raggioMetri">Raggio consentito (metri)</label>
          <input class="form-control" id="cfg-raggioMetri" inputmode="numeric" value="${UI.escHtml(cfg.raggioMetri ?? 150)}">
          <div class="form-hint">Al chiuso il GPS è meno preciso: 150 metri è un buon punto di partenza.</div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">⚙️ Turni e ore</div>
        ${campi.map(([key, label, hint]) => `
          <div class="form-group">
            <label class="form-label" for="cfg-${key}">${UI.escHtml(label)}</label>
            <input class="form-control" id="cfg-${key}" inputmode="decimal" value="${UI.escHtml(cfg[key])}">
            ${hint ? `<div class="form-hint">${UI.escHtml(hint)}</div>` : ''}
          </div>`).join('')}
        <div id="config-error" class="login-error hidden"></div>
        <div class="modal-footer">
          <button type="submit" class="btn btn-primary">Salva</button>
        </div>
      </div>
    </form>
  `);

  document.getElementById('btn-pos-sede').addEventListener('click', async () => {
    UI.showLoading(true, 'Leggo la posizione…');
    const p = await leggiPosizione();
    UI.showLoading(false);
    if (!p) {
      UI.showNotification('Posizione non disponibile: attiva la localizzazione per questa app.', 'error', 6000);
      return;
    }
    document.getElementById('cfg-latSede').value = p.lat.toFixed(6);
    document.getElementById('cfg-lngSede').value = p.lng.toFixed(6);
    UI.showNotification(`Posizione letta (precisione ${Math.round(p.accuracy)} m). Ricordati di salvare.`, 'info', 5000);
  });

  document.getElementById('config-form').addEventListener('submit', async e => {
    e.preventDefault();
    const errEl = document.getElementById('config-error');
    errEl.classList.add('hidden');

    const num = id => document.getElementById(id).value.trim().replace(',', '.');
    const cfgMap = {
      modoPosizione: document.getElementById('cfg-modoPosizione').value,
      latSede:       num('cfg-latSede'),
      lngSede:       num('cfg-lngSede'),
      raggioMetri:   num('cfg-raggioMetri')
    };
    campi.forEach(([key]) => { cfgMap[key] = num(`cfg-${key}`); });

    try {
      await gasCall('adminUpdateConfig', State.token, cfgMap);
      State.user.oraCambioGiornata = Number(cfgMap.oraCambioGiornata);
      State.setSession(State.token, State.user);
      UI.showNotification('Configurazione salvata', 'success');
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    }
  });
}

/* ─── Avvio ─────────────────────────────────────────────────────────────── */

State.init();
document.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('click', e => {
    const btn = e.target.closest('.nav-btn');
    if (btn?.dataset.view) navigate(btn.dataset.view);
  });
  document.getElementById('btn-logout').addEventListener('click', askLogout);
  document.getElementById('btn-menu').addEventListener('click', openMenu);

  if (State.token && State.user) {
    _setupShell(State.user.ruolo);
    navigate(State.user.ruolo === 'admin' ? 'admin_dashboard' : 'home');
  } else {
    navigate('login');
  }
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
