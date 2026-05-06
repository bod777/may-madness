const express = require('express');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_FILE  = path.join(__dirname, 'data', 'bracket.json');
const DRAFT_FILE = path.join(__dirname, 'data', 'draft.json');
const PHOTOS_DIR = path.join(__dirname, 'photos');
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif']);

if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/photos', express.static(PHOTOS_DIR));

// ── Helpers ──────────────────────────────────────

function nameFromFilename(filename) {
  return filename
    .replace(/\.[^/.]+$/, '')
    .replace(/^\d{4}[_-]met[_-]gala[_-]/i, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function loadBracket() {
  if (!fs.existsSync(DATA_FILE)) return null;
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function saveBracket(bracket) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(bracket, null, 2));
}

function loadDraft() {
  if (!fs.existsSync(DRAFT_FILE)) return null;
  return JSON.parse(fs.readFileSync(DRAFT_FILE, 'utf8'));
}

function saveDraft(draft) {
  fs.writeFileSync(DRAFT_FILE, JSON.stringify(draft, null, 2));
}

function buildSnakeOrder(numPlayers, totalPicks) {
  const order = [];
  let forward = true;
  while (order.length < totalPicks) {
    if (forward) {
      for (let i = 0; i < numPlayers && order.length < totalPicks; i++) order.push(i);
    } else {
      for (let i = numPlayers - 1; i >= 0 && order.length < totalPicks; i--) order.push(i);
    }
    forward = !forward;
  }
  return order;
}

function buildBracket(entries) {
  const shuffled = [...entries].sort(() => Math.random() - 0.5);
  const matchups = [];
  for (let i = 0; i < shuffled.length; i += 2) {
    matchups.push({ id: uuidv4(), entryA: shuffled[i], entryB: shuffled[i + 1], winner: null });
  }
  return {
    entries: shuffled,
    rounds: [matchups],
    currentRound: 0,
    currentMatchup: 0,
    champion: null,
    phase: 'voting'
  };
}

function getRoundName(roundIndex, totalRounds) {
  const fromEnd = totalRounds - 1 - roundIndex;
  if (fromEnd === 0) return 'The Final';
  if (fromEnd === 1) return 'Semifinals';
  if (fromEnd === 2) return 'Quarterfinals';
  if (fromEnd === 3) return 'Round of 16';
  return `Round of ${Math.pow(2, fromEnd + 1)}`;
}

// ── API ───────────────────────────────────────────

app.get('/api/entries', (req, res) => {
  if (!fs.existsSync(PHOTOS_DIR)) return res.json({ entries: [] });
  const entries = fs.readdirSync(PHOTOS_DIR)
    .filter(f => IMAGE_EXTS.has(path.extname(f).toLowerCase()))
    .map(filename => ({
      name: nameFromFilename(filename),
      filename,
      url: `/photos/${filename}`
    }));
  res.json({ entries });
});

app.get('/api/bracket', (req, res) => {
  const bracket = loadBracket();
  if (!bracket) return res.json({ status: 'empty' });
  const totalRounds = Math.log2(bracket.entries.length);
  const roundName = getRoundName(bracket.currentRound, totalRounds);
  res.json({ status: 'active', bracket, roundName, totalRounds });
});

app.post('/api/start', (req, res) => {
  const { entries } = req.body;
  if (!entries || entries.length < 2) {
    return res.status(400).json({ error: 'Need at least 2 entries' });
  }
  // Ensure power of 2
  const n = Math.pow(2, Math.floor(Math.log2(entries.length)));
  const bracket = buildBracket(entries.slice(0, n));
  saveBracket(bracket);
  const totalRounds = Math.log2(n);
  res.json({ ok: true, bracket, totalRounds, roundName: getRoundName(0, totalRounds) });
});

app.post('/api/vote', (req, res) => {
  const { winner } = req.body;
  const bracket = loadBracket();
  if (!bracket || bracket.phase !== 'voting') {
    return res.status(400).json({ error: 'Not in voting phase' });
  }

  const round = bracket.rounds[bracket.currentRound];
  const matchup = round[bracket.currentMatchup];
  matchup.winner = winner === 'A' ? matchup.entryA : matchup.entryB;
  bracket.currentMatchup++;

  if (bracket.currentMatchup >= round.length) {
    const winners = round.map(m => m.winner);
    if (winners.length === 1) {
      bracket.champion = winners[0];
      bracket.phase = 'done';
    } else {
      const nextMatchups = [];
      for (let i = 0; i < winners.length; i += 2) {
        nextMatchups.push({ id: uuidv4(), entryA: winners[i], entryB: winners[i + 1], winner: null });
      }
      bracket.rounds.push(nextMatchups);
      bracket.currentRound++;
      bracket.currentMatchup = 0;
      bracket.phase = 'between_rounds';
    }
  }

  saveBracket(bracket);
  const totalRounds = Math.log2(bracket.entries.length);
  res.json({ ok: true, bracket, roundName: getRoundName(bracket.currentRound, totalRounds), totalRounds });
});

app.post('/api/next-round', (req, res) => {
  const bracket = loadBracket();
  if (!bracket) return res.status(400).json({ error: 'No bracket active' });
  bracket.phase = 'voting';
  saveBracket(bracket);
  const totalRounds = Math.log2(bracket.entries.length);
  res.json({ ok: true, bracket, roundName: getRoundName(bracket.currentRound, totalRounds), totalRounds });
});

app.post('/api/reset', (req, res) => {
  if (fs.existsSync(DATA_FILE))  fs.unlinkSync(DATA_FILE);
  if (fs.existsSync(DRAFT_FILE)) fs.unlinkSync(DRAFT_FILE);
  res.json({ ok: true });
});

// ── Draft API ─────────────────────────────────────

app.get('/api/draft', (req, res) => {
  const draft = loadDraft();
  if (!draft) return res.json({ status: 'empty' });
  res.json({ status: 'active', draft });
});

app.post('/api/draft/setup', (req, res) => {
  const { players, allEntries } = req.body;
  if (!players || players.length < 1) return res.status(400).json({ error: 'Need at least 1 player' });
  const order = buildSnakeOrder(players.length, 32);
  const draft = {
    players,
    order,
    picks: [],
    available: allEntries,
    phase: 'drafting'
  };
  saveDraft(draft);
  res.json({ ok: true, draft });
});

app.post('/api/draft/pick', (req, res) => {
  const { filename } = req.body;
  const draft = loadDraft();
  if (!draft || draft.phase !== 'drafting') return res.status(400).json({ error: 'No active draft' });

  const entry = draft.available.find(e => e.filename === filename);
  if (!entry) return res.status(400).json({ error: 'Entry not available' });

  const playerIndex = draft.order[draft.picks.length];
  draft.picks.push({ playerIndex, entry });
  draft.available = draft.available.filter(e => e.filename !== filename);

  if (draft.picks.length >= 32) draft.phase = 'complete';

  saveDraft(draft);
  res.json({ ok: true, draft });
});

app.post('/api/draft/reset', (req, res) => {
  if (fs.existsSync(DRAFT_FILE)) fs.unlinkSync(DRAFT_FILE);
  res.json({ ok: true });
});

app.listen(PORT, () => console.log(`May Madness → http://localhost:${PORT}`));
