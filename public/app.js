/* ══════════════════════════════════════════════════
   May Madness — App
══════════════════════════════════════════════════ */

let allEntries   = [];
let state        = null;
let roundName    = '';
let totalRounds  = 0;
let draftState   = null;
let draftPlayers = [];

// ── Bracket dimensions (computed dynamically in renderBracket) ──
let B_CW, B_CH, B_PW, B_MG, B_MH, B_SLOT, B_GW, B_CS;

// ── Screens ───────────────────────────────────────

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function showNav(show) {
  document.getElementById('nav-bar').classList.toggle('hidden', !show);
}

// ── Init ──────────────────────────────────────────

async function init() {
  try {
    const [entriesRes, bracketRes, draftRes] = await Promise.all([
      fetch('/api/entries'),
      fetch('/api/bracket'),
      fetch('/api/draft')
    ]);
    const { entries } = await entriesRes.json();
    const bracketData = await bracketRes.json();
    const draftData   = await draftRes.json();

    allEntries = entries || [];

    if (bracketData.status === 'active') {
      state       = bracketData.bracket;
      roundName   = bracketData.roundName;
      totalRounds = bracketData.totalRounds;
      showNav(true);
      enterActiveMode();
    } else if (draftData.status === 'active') {
      draftState = draftData.draft;
      if (draftState.phase === 'complete') showDraftComplete();
      else showDraftScreen();
    } else {
      renderLobby();
      showScreen('screen-lobby');
      showNav(false);
    }
  } catch (err) {
    document.getElementById('lobby-count').textContent = `Error loading: ${err.message}`;
    showScreen('screen-lobby');
  }
}

function enterActiveMode() {
  if (state.phase === 'done')            showChampion();
  else if (state.phase === 'between_rounds') showBetweenRounds();
  else                                   showVoting();
}

// ── Lobby ─────────────────────────────────────────

function renderLobby() {
  const grid = document.getElementById('lobby-grid');
  grid.innerHTML = '';

  allEntries.forEach(entry => {
    const card = document.createElement('div');
    card.className = 'lobby-card';
    card.innerHTML = `
      <img src="${entry.url}" alt="${entry.name}" loading="lazy" />
      <div class="lobby-card-name">${entry.name}</div>
    `;
    grid.appendChild(card);
  });

  const count = allEntries.length;
  const countEl  = document.getElementById('lobby-count');
  const draftBtn = document.getElementById('btn-setup-draft');
  const directBtn = document.getElementById('btn-start-direct');

  if (count === 0) {
    countEl.textContent = 'Drop photos into the photos/ folder to begin';
    draftBtn.disabled = true;
    directBtn.disabled = true;
  } else if (count < 2) {
    countEl.textContent = `${count} photo found — need at least 2`;
    draftBtn.disabled = true;
    directBtn.disabled = true;
  } else {
    const usable = Math.pow(2, Math.floor(Math.log2(count)));
    countEl.textContent = `${count} photos · draft picks 32 for the bracket`;
    draftBtn.disabled = false;
    directBtn.disabled = usable < 2;
    directBtn.style.display = '';
  }
}

async function startDirect() {
  const res = await fetch('/api/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries: allEntries })
  });
  const data = await res.json();
  state       = data.bracket;
  roundName   = data.roundName;
  totalRounds = data.totalRounds;
  showNav(true);
  showVoting();
}

// ── Draft Setup ───────────────────────────────────

function showDraftSetup() {
  draftPlayers = [];
  renderDraftPlayerList();
  showScreen('screen-draft-setup');

  const input = document.getElementById('draft-name-input');
  input.value = '';
  input.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Enter') { addDraftPlayer(); }
  }, { once: false });
}

function renderDraftPlayerList() {
  const list = document.getElementById('draft-player-list');
  list.innerHTML = '';
  draftPlayers.forEach((name, i) => {
    const item = document.createElement('div');
    item.className = 'draft-player-item';
    item.innerHTML = `
      <span class="draft-player-seed">${i + 1}</span>
      <span class="draft-player-name-text">${name}</span>
      <button class="draft-player-remove" onclick="removeDraftPlayer(${i})">×</button>
    `;
    list.appendChild(item);
  });
  document.getElementById('btn-begin-draft').disabled = draftPlayers.length < 1;
}

function addDraftPlayer() {
  const input = document.getElementById('draft-name-input');
  const name = input.value.trim();
  if (!name) return;
  draftPlayers.push(name);
  input.value = '';
  input.focus();
  renderDraftPlayerList();
}

function removeDraftPlayer(index) {
  draftPlayers.splice(index, 1);
  renderDraftPlayerList();
}

function shuffleDraftPlayers() {
  for (let i = draftPlayers.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [draftPlayers[i], draftPlayers[j]] = [draftPlayers[j], draftPlayers[i]];
  }
  renderDraftPlayerList();
}

async function beginDraft() {
  if (draftPlayers.length < 1) return;
  const res = await fetch('/api/draft/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ players: draftPlayers, allEntries })
  });
  const data = await res.json();
  draftState = data.draft;
  showDraftScreen();
}

// ── Draft Screen ───────────────────────────────────

function showDraftScreen() {
  showScreen('screen-draft');
  document.getElementById('draft-search').value = '';
  renderDraftHeader();
  renderDraftGrid();
}

function renderDraftHeader() {
  const pickIndex     = draftState.picks.length;
  const playerIndex   = draftState.order[pickIndex];
  const playerName    = draftState.players[playerIndex];
  document.getElementById('draft-picker-name').textContent = playerName;
  document.getElementById('draft-pick-count').textContent  = `Pick ${pickIndex + 1} of 32`;
}

function renderDraftGrid() {
  const grid = document.getElementById('draft-photo-grid');
  grid.innerHTML = '';
  draftState.available.forEach(entry => {
    const card = document.createElement('div');
    card.className = 'draft-photo-card';
    card.dataset.filename = entry.filename;
    card.dataset.name = entry.name;
    card.innerHTML = `
      <img src="${entry.url}" alt="${entry.name}" loading="lazy" />
      <div class="draft-photo-card-name">${entry.name}</div>
      <div class="draft-photo-pick-label">PICK</div>
    `;
    card.addEventListener('click', () => draftPick(entry.filename, card));
    grid.appendChild(card);
  });
  const noResults = document.createElement('div');
  noResults.id = 'draft-no-results';
  noResults.className = 'draft-no-results';
  noResults.textContent = 'No results';
  noResults.style.display = 'none';
  grid.appendChild(noResults);
  filterDraftGrid();
}

function filterDraftGrid() {
  const query = document.getElementById('draft-search').value.trim().toLowerCase();
  const cards = document.querySelectorAll('#draft-photo-grid .draft-photo-card');
  let visible = 0;
  cards.forEach(card => {
    const name = card.dataset.name.toLowerCase();
    const show = !query || name.includes(query);
    card.style.display = show ? '' : 'none';
    if (show) visible++;
  });
  const noResults = document.getElementById('draft-no-results');
  if (noResults) noResults.style.display = visible === 0 ? '' : 'none';
}

async function draftPick(filename, cardEl) {
  cardEl.classList.add('picking');
  await new Promise(r => setTimeout(r, 450));

  const res = await fetch('/api/draft/pick', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename })
  });
  const data = await res.json();
  draftState = data.draft;

  if (draftState.phase === 'complete') {
    showDraftComplete();
  } else {
    renderDraftHeader();
    renderDraftGrid();
  }
}

function toggleDraftBoard() {
  const overlay = document.getElementById('draft-board-overlay');
  const isHidden = overlay.classList.contains('hidden');
  if (isHidden) {
    renderDraftBoard();
    overlay.classList.remove('hidden');
  } else {
    overlay.classList.add('hidden');
  }
}

function renderDraftBoard() {
  const cols = document.getElementById('draft-board-columns');
  cols.innerHTML = '';

  const currentPlayerIndex = draftState.picks.length < 32
    ? draftState.order[draftState.picks.length]
    : -1;

  // Max picks any player can have = ceil(32 / numPlayers)
  const maxPicks = Math.ceil(32 / draftState.players.length);

  draftState.players.forEach((name, pi) => {
    const playerPicks = draftState.picks.filter(p => p.playerIndex === pi);
    const isActive    = pi === currentPlayerIndex;

    const col = document.createElement('div');
    col.className = 'draft-board-col' + (isActive ? ' active-col' : '');

    const header = document.createElement('div');
    header.className = 'draft-board-col-header';
    header.textContent = name;
    col.appendChild(header);

    const picksList = document.createElement('div');
    picksList.className = 'draft-board-col-picks';

    for (let i = 0; i < maxPicks; i++) {
      const pick = playerPicks[i];
      const slot = document.createElement('div');
      if (pick) {
        slot.className = 'draft-board-pick-card';
        slot.innerHTML = `
          <img src="${pick.entry.url}" alt="${pick.entry.name}" />
          <div class="draft-board-pick-name">${pick.entry.name}</div>
        `;
      } else {
        slot.className = 'draft-board-empty';
      }
      picksList.appendChild(slot);
    }

    col.appendChild(picksList);
    cols.appendChild(col);
  });
}

async function resetDraft() {
  if (!confirm('Reset the draft and start over?')) return;
  await fetch('/api/draft/reset', { method: 'POST' });
  draftState = null;
  draftPlayers = [];
  showDraftSetup();
}

// ── Draft Complete ─────────────────────────────────

function showDraftComplete() {
  showScreen('screen-draft-complete');
  const grid = document.getElementById('draft-final-grid');
  grid.innerHTML = '';
  draftState.picks.forEach(({ entry }) => {
    const card = document.createElement('div');
    card.className = 'winner-card';
    card.innerHTML = `<img src="${entry.url}" alt="${entry.name}" /><div class="winner-card-name">${entry.name}</div>`;
    grid.appendChild(card);
  });
}

async function startBracketFromDraft() {
  const entries = draftState.picks.map(p => p.entry);
  const res = await fetch('/api/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries })
  });
  const data = await res.json();
  state       = data.bracket;
  roundName   = data.roundName;
  totalRounds = data.totalRounds;
  showNav(true);
  showVoting();
}

// ── Voting ────────────────────────────────────────

function showVoting() {
  showScreen('screen-voting');
  const round   = state.rounds[state.currentRound];
  const matchup = round[state.currentMatchup];

  document.getElementById('round-badge').textContent = roundName;
  document.getElementById('matchup-progress').textContent =
    `Matchup ${state.currentMatchup + 1} of ${round.length}`;

  document.getElementById('img-a').src  = matchup.entryA.url;
  document.getElementById('img-a').alt  = matchup.entryA.name;
  document.getElementById('name-a').textContent = matchup.entryA.name;

  document.getElementById('img-b').src  = matchup.entryB.url;
  document.getElementById('img-b').alt  = matchup.entryB.name;
  document.getElementById('name-b').textContent = matchup.entryB.name;

  document.getElementById('contender-a').classList.remove('chosen');
  document.getElementById('contender-b').classList.remove('chosen');
}

async function castVote(side) {
  document.getElementById(`contender-${side.toLowerCase()}`).classList.add('chosen');
  await new Promise(r => setTimeout(r, 420));

  const res = await fetch('/api/vote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ winner: side })
  });
  const data = await res.json();
  state       = data.bracket;
  roundName   = data.roundName;
  totalRounds = data.totalRounds;

  if (state.phase === 'done')                showChampion();
  else if (state.phase === 'between_rounds') showBetweenRounds();
  else                                       showVoting();
}

// ── Between Rounds ────────────────────────────────

function showBetweenRounds() {
  showScreen('screen-between');

  const newRound = state.rounds[state.currentRound];
  const survivors = newRound.flatMap(m => [m.entryA, m.entryB]);

  document.getElementById('between-title').textContent =
    `${getRoundLabel(state.currentRound - 1)} Complete!`;
  document.getElementById('between-subtitle').textContent =
    `${survivors.length} looks advancing to ${roundName}`;

  const grid = document.getElementById('winners-grid');
  grid.innerHTML = '';
  survivors.forEach(entry => {
    const card = document.createElement('div');
    card.className = 'winner-card';
    card.innerHTML = `<img src="${entry.url}" alt="${entry.name}" /><div class="winner-card-name">${entry.name}</div>`;
    grid.appendChild(card);
  });
}

async function startNextRound() {
  const res   = await fetch('/api/next-round', { method: 'POST' });
  const data  = await res.json();
  state       = data.bracket;
  roundName   = data.roundName;
  showVoting();
}

function resumeVoting() {
  if (!state) return;
  if (state.phase === 'done')                showChampion();
  else if (state.phase === 'between_rounds') showBetweenRounds();
  else                                       showVoting();
}

// ── Bracket View ──────────────────────────────────

function showBracket() {
  showScreen('screen-bracket');
  renderBracket();
}

function renderBracket() {
  const canvas    = document.getElementById('bracket-canvas');
  const labelsRow = document.getElementById('bracket-labels-row');
  canvas.innerHTML    = '';
  labelsRow.innerHTML = '';

  const N   = state.entries.length;
  const NR  = Math.log2(N);
  const LC  = NR - 1;
  const HR1 = N / 4;
  const TC  = LC * 2 + 1;

  // Scale card dimensions to fill available width exactly
  const scrollEl  = canvas.closest('.bracket-scroll');
  const availW    = scrollEl.clientWidth - 64; // account for padding
  const BASE_CW   = 158, BASE_GW = 28;
  const naturalTW = TC * (BASE_CW + BASE_GW) + BASE_CW;
  const sf        = availW / naturalTW;        // scale factor (can be >1 on wide screens)
  B_CW   = Math.floor(BASE_CW * sf);
  B_GW   = Math.max(14, Math.floor(BASE_GW * sf));
  B_CS   = B_CW + B_GW;
  B_CH   = Math.floor(50 * sf);
  B_PW   = Math.floor(34 * sf);
  B_MG   = 3;
  B_MH   = B_CH * 2 + B_MG;
  B_SLOT = B_MH + Math.max(6, Math.floor(12 * sf));

  const BH  = HR1 * B_SLOT;
  const TW  = TC * B_CS + B_CW;

  // centerY[r][m]: vertical center of matchup m in round r, per-side indexing
  const cy = [];
  cy[0] = Array.from({ length: HR1 }, (_, m) => B_SLOT * m + B_MH / 2);
  for (let r = 1; r < LC; r++) {
    const prev = cy[r - 1];
    cy[r] = Array.from({ length: prev.length / 2 }, (_, m) =>
      (prev[2 * m] + prev[2 * m + 1]) / 2
    );
  }
  const finalCy = BH / 2;

  canvas.style.width  = TW + 'px';
  canvas.style.height = BH + 'px';

  // SVG for connector lines
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.style.cssText = `position:absolute;top:0;left:0;pointer-events:none;overflow:visible;`;
  svg.setAttribute('width', TW);
  svg.setAttribute('height', BH);
  canvas.appendChild(svg);

  const LN = '#2e2e45'; // connector line color

  // ── Left side connector lines (advancing right) ──
  for (let r = 0; r < NR - 2; r++) {       // R1 through QF (not SF→Final)
    const rX = r * B_CS + B_CW;            // card right edge
    const sX = rX + B_GW / 2;              // spine x
    const nX = (r + 1) * B_CS;             // next card left edge
    for (let m = 0; m < cy[r].length; m++) {
      svgLine(svg, rX, cy[r][m], sX, cy[r][m], LN);
    }
    for (let m = 0; m < cy[r].length; m += 2) {
      svgLine(svg, sX, cy[r][m], sX, cy[r][m + 1], LN);
      svgLine(svg, sX, cy[r + 1][m / 2], nX, cy[r + 1][m / 2], LN);
    }
  }
  // Left SF → Final
  svgLine(svg, (LC - 1) * B_CS + B_CW, finalCy, LC * B_CS, finalCy, LN);

  // ── Right side connector lines (advancing left) ──
  for (let r = 0; r < NR - 2; r++) {
    const colX = (TC - 1 - r) * B_CS;        // left edge of right side col r
    const sX   = colX - B_GW / 2;             // spine x (to the left)
    const nRX  = (TC - 2 - r) * B_CS + B_CW; // next (inward) card right edge
    for (let m = 0; m < cy[r].length; m++) {
      svgLine(svg, sX, cy[r][m], colX, cy[r][m], LN);
    }
    for (let m = 0; m < cy[r].length; m += 2) {
      svgLine(svg, sX, cy[r][m], sX, cy[r][m + 1], LN);
      svgLine(svg, nRX, cy[r + 1][m / 2], sX, cy[r + 1][m / 2], LN);
    }
  }
  // Right SF → Final
  svgLine(svg, LC * B_CS + B_CW, finalCy, (LC + 1) * B_CS, finalCy, LN);

  // ── Cards: left side ─────────────────────────────
  for (let r = 0; r < NR - 1; r++) {
    const mps = cy[r].length;
    const x   = r * B_CS;
    for (let m = 0; m < mps; m++) {
      const matchup = state.rounds[r]?.[m] ?? null;
      placeMatchup(canvas, matchup, x, cy[r][m]);
    }
  }

  // ── Cards: right side ────────────────────────────
  for (let r = 0; r < NR - 1; r++) {
    const mps = cy[r].length;
    const x   = (TC - 1 - r) * B_CS;
    for (let m = 0; m < mps; m++) {
      const matchup = state.rounds[r]?.[mps + m] ?? null;
      placeMatchup(canvas, matchup, x, cy[r][m]);
    }
  }

  // ── Cards: Final (center) ────────────────────────
  const finalMatchup = state.rounds[NR - 1]?.[0] ?? null;
  placeMatchup(canvas, finalMatchup, LC * B_CS, finalCy);

  // ── Round labels row ─────────────────────────────
  for (let col = 0; col < TC; col++) {
    const lbl = document.createElement('div');
    lbl.className = 'b-round-col-label';
    lbl.style.width = (col === TC - 1 ? B_CW : B_CS) + 'px';
    if (col === LC) {
      lbl.textContent = '♛ The Final';
    } else if (col < LC) {
      lbl.textContent = getRoundLabel(col);
    } else {
      lbl.textContent = getRoundLabel(LC - 1 - (col - LC - 1));
    }
    labelsRow.appendChild(lbl);
  }

  // Sync label scroll with bracket scroll
  scrollEl.onscroll = () => { labelsRow.scrollLeft = scrollEl.scrollLeft; };
  labelsRow.style.overflowX = 'hidden';
}

// Place one matchup's two cards (or empty slots) at canvas position (x, cy)
function placeMatchup(container, matchup, x, cy) {
  const yA = cy - B_MH / 2;
  const yB = yA + B_CH + B_MG;
  if (!matchup) {
    appendEmptyCard(container, x, yA);
    appendEmptyCard(container, x, yB);
    return;
  }
  const aWins = matchup.winner?.filename === matchup.entryA.filename;
  const bWins = matchup.winner?.filename === matchup.entryB.filename;
  appendCard(container, matchup.entryA, x, yA, aWins, !aWins && !!matchup.winner);
  appendCard(container, matchup.entryB, x, yB, bWins, !bWins && !!matchup.winner);
}

function svgLine(svg, x1, y1, x2, y2, color) {
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', x1); line.setAttribute('y1', y1);
  line.setAttribute('x2', x2); line.setAttribute('y2', y2);
  line.setAttribute('stroke', color);
  line.setAttribute('stroke-width', '1.5');
  line.setAttribute('stroke-linecap', 'round');
  svg.appendChild(line);
}

function appendCard(container, entry, x, y, isWinner, isEliminated, isChampion = false) {
  const el = document.createElement('div');
  el.className = 'b-card'
    + (isWinner     ? ' b-winner'     : '')
    + (isEliminated ? ' b-eliminated' : '')
    + (isChampion   ? ' b-champion'   : '');
  el.style.cssText = `left:${x}px;top:${y}px;width:${B_CW}px;height:${B_CH}px;`;
  el.innerHTML = `
    <img class="b-card-photo" src="${entry.url}" alt="${entry.name}"
         style="width:${B_PW}px;height:${B_CH}px;" />
    <span class="b-card-name">${entry.name}</span>
    ${isWinner ? '<span class="b-card-star">★</span>' : ''}
  `;
  container.appendChild(el);
}

function appendEmptyCard(container, x, y) {
  const el = document.createElement('div');
  el.className = 'b-card b-empty';
  el.style.cssText = `left:${x}px;top:${y}px;width:${B_CW}px;height:${B_CH}px;`;
  el.innerHTML = '<span class="b-card-name" style="color:var(--border)">TBD</span>';
  container.appendChild(el);
}

// ── Round label helper ────────────────────────────

function getRoundLabel(roundIndex) {
  const fromEnd = totalRounds - 1 - roundIndex;
  if (fromEnd === 0) return 'The Final';
  if (fromEnd === 1) return 'Semifinals';
  if (fromEnd === 2) return 'Quarterfinals';
  if (fromEnd === 3) return 'Round of 16';
  return `Round of ${Math.pow(2, fromEnd + 1)}`;
}

// ── Champion ──────────────────────────────────────

function showChampion() {
  showScreen('screen-champion');
  document.getElementById('champion-img').src  = state.champion.url;
  document.getElementById('champion-img').alt  = state.champion.name;
  document.getElementById('champion-name').textContent = state.champion.name;
  spawnConfetti();
}

function spawnConfetti() {
  const layer  = document.getElementById('confetti-layer');
  layer.innerHTML = '';
  const colors = ['#c9a84c','#e8c96a','#f0eee8','#a08030','#fff','#c9a84c'];
  for (let i = 0; i < 90; i++) {
    const p = document.createElement('div');
    p.className = 'confetti-piece';
    const w = 6 + Math.random() * 8;
    const h = 10 + Math.random() * 10;
    p.style.cssText = `
      left:${Math.random() * 100}vw;top:-20px;
      width:${w}px;height:${h}px;
      background:${colors[Math.floor(Math.random() * colors.length)]};
      border-radius:${Math.random() > 0.5 ? '50%' : '2px'};
      animation-duration:${2.2 + Math.random() * 3}s;
      animation-delay:${Math.random() * 1.8}s;
    `;
    layer.appendChild(p);
  }
}

// ── Reset ─────────────────────────────────────────

async function resetApp() {
  if (!confirm('Clear everything and start over?')) return;
  await fetch('/api/reset', { method: 'POST' });
  state = null;
  draftState = null;
  draftPlayers = [];
  renderLobby();
  showScreen('screen-lobby');
  showNav(false);
}

// ── Boot ──────────────────────────────────────────
init();
