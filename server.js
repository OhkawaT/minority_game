const express = require('express');
const path = require('path');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
let ADMIN_PASS = process.env.ADMIN_PASS || 'admin252';
let PLAYER_PASS = process.env.PLAYER_PASS || 'player';

const app = express();
app.use(express.json());

// ログイン確認
app.post('/api/login', (req, res) => {
  const pass = (req.body?.pass || '').trim();
  if (pass === ADMIN_PASS) return res.json({ ok: true, role: 'admin' });
  if (pass === PLAYER_PASS) return res.json({ ok: true, role: 'player' });
  return res.status(401).json({ ok: false });
});

// パスワード変更（管理パスワードで保護）
app.post('/api/password', (req, res) => {
  const current = (req.body?.adminPass || '').trim();
  if (current !== ADMIN_PASS) {
    return res.status(401).json({ ok: false, reason: 'unauthorized' });
  }
  const nextAdmin = (req.body?.newAdminPass || '').trim();
  const nextPlayer = (req.body?.newPlayerPass || '').trim();
  if (nextAdmin) ADMIN_PASS = nextAdmin;
  if (nextPlayer) PLAYER_PASS = nextPlayer;
  return res.json({ ok: true });
});

// ルートはログインへ
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});
app.use(express.static(path.join(__dirname, 'public')));

const server = app.listen(PORT, HOST, () => {
  console.log(`Minority game server running at http://${HOST}:${PORT}`);
});

const wss = new WebSocketServer({ server });

const state = {
  round: 0,
  phase: 'lobby', // lobby | voting | result | final
  question: '準備中',
  options: ['A', 'B'],
  votes: new Map(), // playerId -> choice
  players: new Map(), // playerId -> { name, active }
  lastResult: null,
  history: [],
  queue: [], // { id, question, options: [A,B] }
  finalWinners: [],
};

const connections = new Map(); // ws -> { playerId, role }
const validChoices = ['A', 'B'];

function setPlayerStatus(player, status) {
  if (!player) return;
  player.status = status;
  player.active = status === 'active';
}

function countActivePlayers() {
  let active = 0;
  state.players.forEach((p) => {
    if (p.status === 'active') active += 1;
  });
  return active;
}

function voteCounts() {
  const counts = { A: 0, B: 0 };
  state.votes.forEach((choice) => {
    if (validChoices.includes(choice)) counts[choice] += 1;
  });
  return counts;
}

function determineMinority(counts) {
  // 片方が0票の場合は無効（全員生存扱い）
  if (counts.A === 0 || counts.B === 0) return null;
  if (counts.A === counts.B) return null;
  return counts.A < counts.B ? 'A' : 'B';
}

function connectedPlayerCounts() {
  const counts = new Map();
  connections.forEach(({ playerId }) => {
    if (!playerId) return;
    counts.set(playerId, (counts.get(playerId) || 0) + 1);
  });
  return counts;
}

function ensurePlayer(name, requestedId) {
  const displayName = (name || '').trim() || '名無し';
  let playerId = requestedId && state.players.has(requestedId) ? requestedId : null;
  let isNew = false;

  if (!playerId) {
    for (const [id, info] of state.players.entries()) {
      if (info.name === displayName) {
        playerId = id;
        break;
      }
    }
  }

  if (!playerId) {
    playerId = crypto.randomUUID();
    isNew = true;
  }

const existing = state.players.get(playerId) || {};
const status =
  existing.status !== undefined ? existing.status : state.round === 0 ? 'active' : 'waiting';
const nextPlayer = {
  name: displayName,
  status,
  active: status === 'active',
};
state.players.set(playerId, nextPlayer);
return { playerId, player: nextPlayer, isNew };
}

function addPreset(question, optionA, optionB) {
  const item = {
    id: crypto.randomUUID(),
    question: (question || '').trim() || `第${state.queue.length + 1}問`,
    options: [(optionA || '').trim() || 'A', (optionB || '').trim() || 'B'],
  };
  state.queue.push(item);
  return item;
}

function removePreset(id) {
  state.queue = state.queue.filter((q) => q.id !== id);
}

function startRound(question, optionA, optionB) {
  state.round += 1;
  state.phase = 'voting';
  state.question = question?.trim() || `第${state.round}問`;
  state.options = [optionA?.trim() || 'A', optionB?.trim() || 'B'];
  state.votes.clear();
  state.lastResult = null;
  state.finalWinners = [];
}

function startNextFromQueue() {
  if (state.phase === 'voting') return false;
  if (!state.queue.length) return false;
  const next = state.queue.shift();
  startRound(next.question, next.options[0], next.options[1]);
  return true;
}

function revealResult() {
  state.phase = 'result';
  const counts = voteCounts();
  const minority = determineMinority(counts);
  if (minority) {
    state.players.forEach((player, id) => {
      if (player.status !== 'active') return;
      const choice = state.votes.get(id);
      if (choice !== minority) {
        setPlayerStatus(player, 'out');
      }
    });
  } else {
    // 同数、または片方0票は無効として扱い、誰も脱落させない
  }
  state.lastResult = {
    round: state.round,
    question: state.question,
    counts,
    minority,
    totalVotes: state.votes.size,
    at: Date.now(),
  };
  state.history.push(state.lastResult);
}

function finalizeGame() {
  state.phase = 'final';
  const winners = [];
  state.players.forEach((player, id) => {
    if (player.status === 'active') {
      winners.push({ id, name: player.name });
    }
  });
  state.finalWinners = winners;
}

function resetGame(clearQueue = true) {
  state.round = 0;
  state.phase = 'lobby';
  state.question = '準備中';
  state.votes.clear();
  state.lastResult = null;
  state.history = [];
  state.options = ['A', 'B'];
  if (clearQueue) {
    state.queue = [];
  }
  state.finalWinners = [];
  state.players.forEach((player) => {
    setPlayerStatus(player, 'active');
  });
}

function buildPayload(playerId, role) {
  const counts = voteCounts();
  const minority = state.phase === 'result' ? determineMinority(counts) : null;
  const player = playerId ? state.players.get(playerId) : null;
  const isWinner =
    state.phase === 'final' && playerId
      ? state.finalWinners.some((w) => w.id === playerId)
      : null;

  const payload = {
    type: 'state',
    round: state.round,
    phase: state.phase,
    question: state.question,
    options: state.options,
    counts: state.phase === 'result' ? counts : null,
    minority: state.phase === 'result' ? minority : null,
    totalPlayers: state.players.size,
    activePlayers: countActivePlayers(),
    votesSubmitted: state.votes.size,
    finalWinners: state.phase === 'final' ? state.finalWinners : null,
    you: player
      ? {
          name: player.name,
          active: player.active,
          status: player.status,
          choice: state.votes.get(playerId) || null,
          winner: isWinner,
        }
      : null,
    lastResult: state.lastResult,
  };

  if (role === 'admin') {
    const connected = connectedPlayerCounts();
    payload.admin = {
      players: Array.from(state.players.entries()).map(([id, info]) => ({
        id,
        name: info.name,
        status: info.status,
        active: info.active,
        choice: state.votes.get(id) || null,
        connected: connected.get(id) || 0,
      })),
      counts,
      history: state.history,
      queue: state.queue,
      finalWinners: state.finalWinners,
    };
  }
  return payload;
}

function sendState(ws) {
  const meta = connections.get(ws) || {};
  const payload = buildPayload(meta.playerId, meta.role);
  ws.send(JSON.stringify(payload));
}

function broadcastState() {
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      sendState(client);
    }
  });
}

function handleVote(playerId, choice) {
  if (state.phase !== 'voting') return;
  if (!validChoices.includes(choice)) return;
  const player = state.players.get(playerId);
  if (!player || player.status !== 'active') return;
  state.votes.set(playerId, choice);
}

function removePlayer(playerId) {
  if (!playerId) return;
  state.players.delete(playerId);
  state.votes.delete(playerId);
}

wss.on('connection', (ws) => {
  connections.set(ws, { playerId: null, role: 'player' });

  ws.on('message', (data) => {
    let msg = null;
    try {
      msg = JSON.parse(data.toString());
    } catch (err) {
      return;
    }

    const info = connections.get(ws) || { role: 'player', playerId: null };
    switch (msg.type) {
      case 'register': {
        const role = msg.role === 'admin' ? 'admin' : msg.role === 'viewer' ? 'viewer' : 'player';
        if (role === 'viewer') {
          connections.set(ws, { playerId: null, role: 'viewer' });
          ws.send(JSON.stringify({ type: 'auth', ok: true, role: 'viewer' }));
          sendState(ws);
          break;
        }
        const pass = (msg.pass || '').trim();
        const expected = role === 'admin' ? ADMIN_PASS : PLAYER_PASS;
        if (pass !== expected) {
          ws.send(JSON.stringify({ type: 'auth', ok: false, reason: 'invalid_password' }));
          ws.close();
          return;
        }
        if (role === 'admin') {
          connections.set(ws, { playerId: null, role: 'admin' });
          ws.send(JSON.stringify({ type: 'auth', ok: true, role: 'admin' }));
          sendState(ws);
          break;
        }
        const { playerId, player, isNew } = ensurePlayer(msg.name, msg.playerId);
        if (player && player.status === 'waiting' && state.round === 0) {
          setPlayerStatus(player, 'active');
        }
        connections.set(ws, { playerId, role });
        ws.send(JSON.stringify({ type: 'auth', ok: true, role }));
        ws.send(JSON.stringify({ type: 'registered', playerId }));
        broadcastState();
        break;
      }
      case 'leave': {
        if (!info.playerId) return;
        removePlayer(info.playerId);
        connections.set(ws, { playerId: null, role: info.role });
        broadcastState();
        break;
      }
      case 'vote': {
        if (!info.playerId) return;
        handleVote(info.playerId, msg.choice);
        broadcastState();
        break;
      }
      case 'admin:start': {
        if (info.role !== 'admin') return;
        startRound(msg.question, msg.optionA, msg.optionB);
        broadcastState();
        break;
      }
      case 'admin:queue:add': {
        if (info.role !== 'admin') return;
        addPreset(msg.question, msg.optionA, msg.optionB);
        broadcastState();
        break;
      }
      case 'admin:queue:remove': {
        if (info.role !== 'admin') return;
        if (msg.id) {
          removePreset(msg.id);
          broadcastState();
        }
        break;
      }
      case 'admin:next': {
        if (info.role !== 'admin') return;
        const started = startNextFromQueue();
        if (started) {
          broadcastState();
        }
        break;
      }
      case 'admin:reveal': {
        if (info.role !== 'admin') return;
        revealResult();
        broadcastState();
        break;
      }
      case 'admin:final': {
        if (info.role !== 'admin') return;
        finalizeGame();
        broadcastState();
        break;
      }
      case 'admin:reset': {
        if (info.role !== 'admin') return;
        resetGame(true);
        broadcastState();
        break;
      }
      case 'admin:reset:keep-queue': {
        if (info.role !== 'admin') return;
        resetGame(false);
        broadcastState();
        break;
      }
      default:
        break;
    }
  });

  ws.on('close', () => {
    connections.delete(ws);
    broadcastState();
  });

  sendState(ws);
});
