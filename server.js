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

// ログイン確認API
app.post('/api/login', (req, res) => {
  const pass = (req.body?.pass || '').trim();
  if (pass === ADMIN_PASS) {
    return res.json({ ok: true, role: 'admin' });
  }
  if (pass === PLAYER_PASS) {
    return res.json({ ok: true, role: 'player' });
  }
  return res.status(401).json({ ok: false });
});

// パスワード変更API（管理者パスワードで認証）
app.post('/api/password', (req, res) => {
  const current = (req.body?.adminPass || '').trim();
  if (current !== ADMIN_PASS) {
    return res.status(401).json({ ok: false, reason: 'unauthorized' });
  }
  const nextAdmin = (req.body?.newAdminPass || '').trim();
  const nextPlayer = (req.body?.newPlayerPass || '').trim();
  if (nextAdmin) {
    ADMIN_PASS = nextAdmin;
  }
  if (nextPlayer) {
    PLAYER_PASS = nextPlayer;
  }
  return res.json({ ok: true });
});

// ルートはログイン画面に誘導
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

const server = app.listen(PORT, HOST, () => {
  console.log(`Minority game server running at http://${HOST}:${PORT}`);
});

const wss = new WebSocketServer({ server });

// ゲーム全体の状態を保持する
const state = {
  round: 0,
  phase: 'lobby', // lobby | voting | result
  question: '準備中',
  options: ['A', 'B'],
  votes: new Map(), // playerId -> 'A' | 'B'
  players: new Map(), // playerId -> { name, active }
  lastResult: null,
  history: [],
  queue: [], // { id, question, options: [A, B] }
};

// 接続ごとの情報を保持する
const connections = new Map(); // ws -> { playerId, role }

const validChoices = ['A', 'B'];

function countActivePlayers() {
  let active = 0;
  state.players.forEach((player) => {
    if (player.active) active += 1;
  });
  return active;
}

function voteCounts() {
  const counts = { A: 0, B: 0 };
  state.votes.forEach((choice) => {
    if (validChoices.includes(choice)) {
      counts[choice] += 1;
    }
  });
  return counts;
}

function determineMinority(counts) {
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
  let playerId = requestedId || null;

  // requestedIdが無い場合は同名の既存プレイヤーを再利用する
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
  }

  const existing = state.players.get(playerId) || {};
  const nextPlayer = {
    name: displayName,
    active: existing.active !== undefined ? existing.active : true,
  };
  state.players.set(playerId, nextPlayer);
  return { playerId, player: nextPlayer };
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
}

function startNextFromQueue() {
  if (state.phase === 'voting') return false;
  if (!state.queue.length) return false;
  const next = state.queue.shift();
  startRound(next.question, next.options[0], next.options[1]);
  return true;
}

function revealResult() {
  if (state.phase !== 'voting') {
    state.phase = 'result';
  } else {
    state.phase = 'result';
  }
  const counts = voteCounts();
  const minority = determineMinority(counts);
  // 少数派が存在する場合: 少数派以外は脱落
  if (minority) {
    state.players.forEach((player, id) => {
      const choice = state.votes.get(id);
      if (choice !== minority) {
        player.active = false;
      }
    });
  } else {
    // 同数の場合: 投票した人だけ残留、未投票は脱落
    state.players.forEach((player, id) => {
      if (!player.active) return; // 既に脱落している人はそのまま
      const voted = state.votes.has(id);
      if (!voted) {
        player.active = false;
      }
    });
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

function resetGame() {
  state.round = 0;
  state.phase = 'lobby';
  state.question = '準備中';
  state.votes.clear();
  state.lastResult = null;
  state.history = [];
  state.options = ['A', 'B'];
  state.queue = [];
  state.players.forEach((player) => {
    player.active = true;
  });
}

function buildPayload(playerId, role) {
  const counts = voteCounts();
  const minority = state.phase === 'result' ? determineMinority(counts) : null;
  const player = playerId ? state.players.get(playerId) : null;
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
    you: player
      ? {
          name: player.name,
          active: player.active,
          choice: state.votes.get(playerId) || null,
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
        active: info.active,
        choice: state.votes.get(id) || null,
        connected: connected.get(id) || 0,
      })),
      counts,
      history: state.history,
      queue: state.queue,
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
  if (!player || !player.active) return;
  state.votes.set(playerId, choice);
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
        const role = msg.role === 'admin' ? 'admin' : 'player';
        const pass = (msg.pass || '').trim();
        const expected = role === 'admin' ? ADMIN_PASS : PLAYER_PASS;
        if (pass !== expected) {
          ws.send(JSON.stringify({ type: 'auth', ok: false, reason: 'invalid_password' }));
          ws.close();
          return;
        }
        const { playerId } = ensurePlayer(msg.name, msg.playerId);
        connections.set(ws, { playerId, role });
        ws.send(JSON.stringify({ type: 'auth', ok: true, role }));
        ws.send(JSON.stringify({ type: 'registered', playerId }));
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
      case 'admin:reset': {
        if (info.role !== 'admin') return;
        resetGame();
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

  // 初期状態を返す
  sendState(ws);
});
