const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const archiver = require('archiver');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

const SESSIONS_DIR = path.join(__dirname, 'data', 'sessions');
const PHOTOS_DIR   = path.join(__dirname, 'photos');
const IMAGE_EXTS   = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif']);

fs.mkdirSync(SESSIONS_DIR, { recursive: true });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/photos', express.static(PHOTOS_DIR));

// ── Session helpers ───────────────────────────────

function getSession(req) {
  const s = req.query.s || req.body?.session || '';
  if (!s || !/^[a-zA-Z0-9-]{8,64}$/.test(s)) return null;
  return s;
}

function sessionFile(sid, filename) {
  const dir = path.join(SESSIONS_DIR, sid);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, filename);
}

function loadJSON(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ── Domain helpers ────────────────────────────────

function nameFromFilename(filename) {
  return filename
    .replace(/\.[^/.]+$/, '')
    .replace(/^\d{4}[_-]met[_-]gala[_-]/i, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
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

const BYE_NAMES = new Set([
  'Sabrina Carpenter', 'Beyoncé', 'Anne Hathaway',
  'Connor Storrie', 'Bad Bunny', 'Anok Yai'
]);

function buildBracket(entries, targetSize) {
  const n = targetSize || Math.pow(2, Math.floor(Math.log2(entries.length)));
  const byeCount = Math.max(0, n - entries.length);
  const shuffled = [...entries].sort(() => Math.random() - 0.5);

  let matchups;
  if (byeCount === 0) {
    const real = shuffled.slice(0, n);
    matchups = [];
    for (let i = 0; i < real.length; i += 2) {
      matchups.push({ id: uuidv4(), entryA: real[i], entryB: real[i + 1], winner: null });
    }
  } else {
    const byeRecipients = [], others = [];
    for (const e of shuffled) {
      if (BYE_NAMES.has(e.name) && byeRecipients.length < byeCount) byeRecipients.push(e);
      else others.push(e);
    }
    const byeMatchups = byeRecipients.map(r => ({
      id: uuidv4(),
      entryA: r,
      entryB: { name: 'BYE', filename: '__bye__', url: null, isBye: true },
      winner: null
    }));
    const realMatchups = [];
    for (let i = 0; i < others.length; i += 2) {
      realMatchups.push({ id: uuidv4(), entryA: others[i], entryB: others[i + 1], winner: null });
    }
    matchups = [...byeMatchups, ...realMatchups];
  }

  const bracket = {
    entries: shuffled.slice(0, n - byeCount),
    targetSize: n,
    rounds: [matchups],
    currentRound: 0,
    currentMatchup: 0,
    champion: null,
    phase: 'voting'
  };
  advancePastByes(bracket);
  return bracket;
}

function advancePastByes(bracket) {
  const round = bracket.rounds[bracket.currentRound];
  if (!round) return;
  while (bracket.currentMatchup < round.length) {
    const m = round[bracket.currentMatchup];
    if (m.entryB?.isBye)      { m.winner = m.entryA; bracket.currentMatchup++; }
    else if (m.entryA?.isBye) { m.winner = m.entryB; bracket.currentMatchup++; }
    else break;
  }
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
    .map(filename => ({ name: nameFromFilename(filename), filename, url: `/photos/${encodeURIComponent(filename)}` }));
  res.json({ entries });
});

app.get('/api/bracket', (req, res) => {
  const sid = getSession(req);
  if (!sid) return res.json({ status: 'empty' });
  const bracket = loadJSON(sessionFile(sid, 'bracket.json'));
  if (!bracket) return res.json({ status: 'empty' });
  const totalRounds = Math.log2(bracket.targetSize || bracket.entries.length);
  res.json({ status: 'active', bracket, roundName: getRoundName(bracket.currentRound, totalRounds), totalRounds });
});

app.post('/api/start', (req, res) => {
  const sid = getSession(req);
  if (!sid) return res.status(400).json({ error: 'Missing session' });
  const { entries, size } = req.body;
  if (!entries || entries.length < 2) return res.status(400).json({ error: 'Need at least 2 entries' });
  const targetSize = size || Math.pow(2, Math.floor(Math.log2(entries.length)));
  const bracket = buildBracket(entries, targetSize);
  saveJSON(sessionFile(sid, 'bracket.json'), bracket);
  const totalRounds = Math.log2(bracket.targetSize);
  res.json({ ok: true, bracket, totalRounds, roundName: getRoundName(0, totalRounds) });
});

app.post('/api/vote', (req, res) => {
  const sid = getSession(req);
  if (!sid) return res.status(400).json({ error: 'Missing session' });
  const { winner } = req.body;
  const bracketFile = sessionFile(sid, 'bracket.json');
  const bracket = loadJSON(bracketFile);
  if (!bracket || bracket.phase !== 'voting') return res.status(400).json({ error: 'Not in voting phase' });

  const round = bracket.rounds[bracket.currentRound];
  const matchup = round[bracket.currentMatchup];
  matchup.winner = winner === 'A' ? matchup.entryA : matchup.entryB;
  bracket.currentMatchup++;
  advancePastByes(bracket);

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

  saveJSON(bracketFile, bracket);
  const totalRounds = Math.log2(bracket.targetSize || bracket.entries.length);
  res.json({ ok: true, bracket, roundName: getRoundName(bracket.currentRound, totalRounds), totalRounds });
});

app.post('/api/next-round', (req, res) => {
  const sid = getSession(req);
  if (!sid) return res.status(400).json({ error: 'Missing session' });
  const bracketFile = sessionFile(sid, 'bracket.json');
  const bracket = loadJSON(bracketFile);
  if (!bracket) return res.status(400).json({ error: 'No bracket active' });
  bracket.phase = 'voting';
  saveJSON(bracketFile, bracket);
  const totalRounds = Math.log2(bracket.targetSize || bracket.entries.length);
  res.json({ ok: true, bracket, roundName: getRoundName(bracket.currentRound, totalRounds), totalRounds });
});

app.post('/api/jump', (req, res) => {
  const sid = getSession(req);
  if (!sid) return res.status(400).json({ error: 'Missing session' });
  const { matchupIndex } = req.body;
  const bracketFile = sessionFile(sid, 'bracket.json');
  const bracket = loadJSON(bracketFile);
  if (!bracket || bracket.phase !== 'voting') return res.status(400).json({ error: 'Not in voting phase' });
  const round = bracket.rounds[bracket.currentRound];
  if (matchupIndex < 0 || matchupIndex >= round.length) return res.status(400).json({ error: 'Invalid matchup index' });
  if (round[matchupIndex].winner !== null) return res.status(400).json({ error: 'Matchup already voted' });
  bracket.currentMatchup = matchupIndex;
  saveJSON(bracketFile, bracket);
  const totalRounds = Math.log2(bracket.targetSize || bracket.entries.length);
  res.json({ ok: true, bracket, roundName: getRoundName(bracket.currentRound, totalRounds), totalRounds });
});

app.post('/api/reset', (req, res) => {
  const sid = getSession(req);
  if (!sid) return res.json({ ok: true });
  const dir = path.join(SESSIONS_DIR, sid);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });
  res.json({ ok: true });
});

// ── Draft API ─────────────────────────────────────

app.get('/api/draft', (req, res) => {
  const sid = getSession(req);
  if (!sid) return res.json({ status: 'empty' });
  const draft = loadJSON(sessionFile(sid, 'draft.json'));
  if (!draft) return res.json({ status: 'empty' });
  res.json({ status: 'active', draft });
});

app.post('/api/draft/setup', (req, res) => {
  const sid = getSession(req);
  if (!sid) return res.status(400).json({ error: 'Missing session' });
  const { players, allEntries } = req.body;
  if (!players || players.length < 1) return res.status(400).json({ error: 'Need at least 1 player' });
  const draft = {
    players,
    order: buildSnakeOrder(players.length, 32),
    picks: [],
    available: allEntries,
    phase: 'drafting'
  };
  saveJSON(sessionFile(sid, 'draft.json'), draft);
  res.json({ ok: true, draft });
});

app.post('/api/draft/pick', (req, res) => {
  const sid = getSession(req);
  if (!sid) return res.status(400).json({ error: 'Missing session' });
  const { filename } = req.body;
  const draftFile = sessionFile(sid, 'draft.json');
  const draft = loadJSON(draftFile);
  if (!draft || draft.phase !== 'drafting') return res.status(400).json({ error: 'No active draft' });

  const entry = draft.available.find(e => e.filename === filename);
  if (!entry) return res.status(400).json({ error: 'Entry not available' });

  draft.picks.push({ playerIndex: draft.order[draft.picks.length], entry });
  draft.available = draft.available.filter(e => e.filename !== filename);
  if (draft.picks.length >= 32) draft.phase = 'complete';

  saveJSON(draftFile, draft);
  res.json({ ok: true, draft });
});

app.post('/api/draft/reset', (req, res) => {
  const sid = getSession(req);
  if (!sid) return res.json({ ok: true });
  const f = sessionFile(sid, 'draft.json');
  if (fs.existsSync(f)) fs.unlinkSync(f);
  res.json({ ok: true });
});

app.post('/api/download', (req, res) => {
  const { filenames, zipName = 'met-gala-picks' } = req.body;
  if (!filenames || !filenames.length) return res.status(400).json({ error: 'No files specified' });

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipName}.zip"`);

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.pipe(res);

  for (const filename of filenames) {
    const safe = path.basename(filename); // prevent path traversal
    const filePath = path.join(PHOTOS_DIR, safe);
    if (fs.existsSync(filePath)) archive.file(filePath, { name: safe });
  }

  archive.finalize();
});

app.listen(PORT, () => console.log(`May Madness → http://localhost:${PORT}`));
