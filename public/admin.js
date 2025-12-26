const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
const wsUrl = `${protocol}://${window.location.host}`;

let ws = null;
let reconnectTimer = null;
let reconnectAllowed = true;

const storageKeys = {
  adminPass: 'mg_admin_pass',
};

const els = {
  phase: document.getElementById('phase-label'),
  round: document.getElementById('round-label'),
  connected: document.getElementById('connected-label'),
  active: document.getElementById('active-label'),
  votes: document.getElementById('votes-label'),
  newAdminPass: document.getElementById('new-admin-pass'),
  newPlayerPass: document.getElementById('new-player-pass'),
  questionInput: document.getElementById('question-input'),
  optionA: document.getElementById('option-a'),
  optionB: document.getElementById('option-b'),
  startBtn: document.getElementById('start-btn'),
  revealBtn: document.getElementById('reveal-btn'),
  finalBtn: document.getElementById('final-btn'),
  resetBtn: document.getElementById('reset-btn'),
  softResetBtn: document.getElementById('soft-reset-btn'),
  queueAddBtn: document.getElementById('queue-add-btn'),
  queueStartBtn: document.getElementById('queue-start-btn'),
  queueList: document.getElementById('queue-list'),
  queueCount: document.getElementById('queue-count'),
  queueEmpty: document.getElementById('queue-empty'),
  bulkInput: document.getElementById('bulk-input'),
  bulkFile: document.getElementById('bulk-file'),
  bulkAddBtn: document.getElementById('bulk-add-btn'),
  bulkClearBtn: document.getElementById('bulk-clear-btn'),
  bulkNote: document.getElementById('bulk-note'),
  summaryTotal: document.getElementById('summary-total'),
  summaryActive: document.getElementById('summary-active'),
  summaryA: document.getElementById('summary-a'),
  summaryB: document.getElementById('summary-b'),
  summaryMinority: document.getElementById('summary-minority'),
  questionPreview: document.getElementById('question-preview'),
  players: document.getElementById('players'),
  playerNote: document.getElementById('player-note'),
  winners: document.getElementById('winners'),
  winnersNote: document.getElementById('winners-note'),
  logout: document.getElementById('logout-admin'),
  toast: document.getElementById('toast'),
};

function ensureLoggedIn() {
  const pass = localStorage.getItem(storageKeys.adminPass) || '';
  if (!pass) {
    window.location.replace('/login.html');
    return false;
  }
  return true;
}

function showToast(message, type = 'success') {
  els.toast.textContent = message;
  els.toast.className = `toast ${type}`;
  els.toast.style.display = 'block';
  setTimeout(() => {
    els.toast.style.display = 'none';
  }, 2000);
}

function connect() {
  if (!ensureLoggedIn()) return;
  reconnectAllowed = true;
  if (ws) ws.close();

  ws = new WebSocket(wsUrl);

  ws.addEventListener('open', () => {
    const pass = localStorage.getItem(storageKeys.adminPass) || '';
    ws.send(JSON.stringify({ type: 'register', role: 'admin', name: 'admin', pass }));
  });

  ws.addEventListener('message', (event) => {
    let payload = null;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }
    if (payload.type === 'auth' && payload.ok === false) {
      showToast('管理パスワードが違います', 'warn');
      reconnectAllowed = false;
      ws.close();
      return;
    }
    if (payload.type === 'state') {
      render(payload);
    }
  });

  ws.addEventListener('close', () => {
    els.phase.textContent = '再接続中...';
    if (!reconnectTimer && reconnectAllowed) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, 1000);
    }
  });
}

function sendAdmin(type, payload = {}) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    showToast('接続が切れています。少し待ってください。', 'warn');
    return;
  }
  ws.send(JSON.stringify({ type, ...payload }));
}

function render(state) {
  const admin = state.admin || {};
  const queue = admin.queue || [];
  const winners = admin.finalWinners || [];
  const phaseLabel =
    state.phase === 'voting'
      ? '回答受付中'
      : state.phase === 'result'
      ? '結果表示'
      : state.phase === 'final'
      ? '最終結果'
      : '待機中';

  els.phase.textContent = phaseLabel;
  els.round.textContent = state.round || 0;
  const connected = admin.players ? admin.players.filter((p) => p.connected > 0).length : 0;
  els.connected.textContent = `${connected} 接続`;
  els.active.textContent = `${state.activePlayers} / ${state.totalPlayers}`;
  els.votes.textContent = `${state.votesSubmitted} 件`;

  els.summaryTotal.textContent = `${state.totalPlayers} 名`;
  els.summaryActive.textContent = `${state.activePlayers} 名`;

  // 投票数とマイノリティ強調
  els.summaryA.classList.remove('highlight-minority', 'highlight-majority');
  els.summaryB.classList.remove('highlight-minority', 'highlight-majority');
  if (admin.counts) {
    els.summaryA.textContent = `${admin.counts.A} 票`;
    els.summaryB.textContent = `${admin.counts.B} 票`;
    if (state.phase === 'result' || state.phase === 'final') {
      if (state.minority === 'A') {
        els.summaryA.classList.add('highlight-minority');
        els.summaryB.classList.add('highlight-majority');
      } else if (state.minority === 'B') {
        els.summaryB.classList.add('highlight-minority');
        els.summaryA.classList.add('highlight-majority');
      }
    }
  } else {
    els.summaryA.textContent = '-';
    els.summaryB.textContent = '-';
  }

  if (state.phase === 'result' || state.phase === 'final') {
    if (state.minority) {
      els.summaryMinority.textContent = `${state.minority} が少数派`;
      els.summaryMinority.className = 'highlight-minority';
    } else if (admin.counts && (admin.counts.A === 0 || admin.counts.B === 0)) {
      els.summaryMinority.textContent = '無効（片方0票）のため全員残留';
      els.summaryMinority.className = 'highlight-majority';
    } else {
      els.summaryMinority.textContent = '同数のため全員残留';
      els.summaryMinority.className = 'highlight-majority';
    }
  } else {
    els.summaryMinority.textContent = '未公開';
    els.summaryMinority.className = '';
  }

  els.questionPreview.textContent = `問題: ${state.question || '---'}`;

  renderQueue(queue);
  if (admin.players) renderPlayers(admin.players, state);
  renderWinners(winners, state.phase);

  els.startBtn.disabled = state.phase === 'voting';
  els.revealBtn.disabled = state.votesSubmitted === 0;
  els.queueStartBtn.disabled = queue.length === 0 || state.phase === 'voting';
  if (els.finalBtn) {
    els.finalBtn.disabled = state.phase === 'final';
  }
}

function renderQueue(queue) {
  els.queueList.innerHTML = '';
  els.queueCount.textContent = `キュー ${queue.length} 件`;
  els.queueEmpty.style.display = queue.length === 0 ? 'block' : 'none';

  queue.forEach((item, idx) => {
    const div = document.createElement('div');
    div.className = 'queue-item';
    div.innerHTML = `
      <div><strong>${idx + 1}. ${item.question}</strong></div>
      <div class="meta">A: ${item.options[0]} / B: ${item.options[1]}</div>
      <div class="queue-actions">
        <button class="ghost" data-remove="${item.id}">削除</button>
      </div>
    `;
    els.queueList.appendChild(div);
  });
}

function parseBulkLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/^\s*\d+\s*[.)、．:：]?\s*/, '');

  const tabParts = normalized.split('\t').map((part) => part.trim()).filter(Boolean);
  if (tabParts.length >= 3) {
    return {
      question: tabParts[0],
      optionA: tabParts[1],
      optionB: tabParts.slice(2).join(' / '),
    };
  }

  const commaParts = normalized.split(',').map((part) => part.trim()).filter(Boolean);
  if (commaParts.length >= 3) {
    return {
      question: commaParts[0],
      optionA: commaParts[1],
      optionB: commaParts.slice(2).join(','),
    };
  }

  const slashParts = normalized.split(/[/／]/).map((part) => part.trim()).filter(Boolean);
  if (slashParts.length >= 3) {
    return {
      question: slashParts[0],
      optionA: slashParts[1],
      optionB: slashParts.slice(2).join(' / '),
    };
  }
  if (slashParts.length < 2) return null;

  const left = slashParts[0];
  const optionB = slashParts[1];
  if (!left || !optionB) return null;

  const match = left.match(/^(.*?[？?！!。:：])\s*(.+)$/);
  let question = '';
  let optionA = '';
  if (match) {
    question = match[1].trim();
    optionA = match[2].trim();
  } else {
    const lastSpace = left.lastIndexOf(' ');
    if (lastSpace > 0) {
      question = left.slice(0, lastSpace).trim();
      optionA = left.slice(lastSpace + 1).trim();
    } else {
      return null;
    }
  }

  if (!question || !optionA) return null;
  return { question, optionA, optionB };
}

function parseBulkText(text) {
  const items = [];
  const errors = [];
  const lines = (text || '').split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!line.trim()) return;
    const parsed = parseBulkLine(line);
    if (!parsed) {
      errors.push({ line: index + 1, text: line });
      return;
    }
    items.push(parsed);
  });
  return { items, errors };
}

function updateBulkNote(result, fileName = '') {
  if (!els.bulkNote) return;
  if (!result) {
    els.bulkNote.textContent = '';
    return;
  }
  const parts = [];
  if (fileName) parts.push(`読み込み: ${fileName}`);
  parts.push(`追加候補: ${result.items.length}件`);
  if (result.errors.length) {
    const sample = result.errors.slice(0, 3).map((e) => `${e.line}行目`).join(', ');
    const sampleText = sample ? ` (例: ${sample})` : '';
    parts.push(`読み取り失敗: ${result.errors.length}件${sampleText}`);
  }
  els.bulkNote.textContent = parts.join(' / ');
}

async function handleBulkFileChange() {
  if (!els.bulkFile || !els.bulkInput) return;
  const file = els.bulkFile.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    els.bulkInput.value = text;
    const result = parseBulkText(text);
    updateBulkNote(result, file.name);
    showToast(`${file.name} を読み込みました`);
  } catch {
    showToast('ファイルの読み込みに失敗しました', 'warn');
  }
}

function handleBulkAdd() {
  if (!els.bulkInput) return;
  const result = parseBulkText(els.bulkInput.value);
  updateBulkNote(result);
  if (!result.items.length) {
    showToast('追加できるお題がありません', 'warn');
    return;
  }
  sendAdmin('admin:queue:bulk', { items: result.items });
  showToast(`キューに${result.items.length}件追加しました`);
}

function clearBulkInput() {
  if (els.bulkInput) els.bulkInput.value = '';
  if (els.bulkFile) els.bulkFile.value = '';
  updateBulkNote(null);
}

function renderPlayers(list, state) {
  els.players.innerHTML = '';
  const fragments = document.createDocumentFragment();
  const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  sorted.forEach((p) => {
    const div = document.createElement('div');
    div.className = 'player';
    let statusClass = 'badge red';
    let statusLabel = '脱落';
    if (p.status === 'active') {
      statusClass = 'badge green';
      statusLabel = '残留';
    } else if (p.status === 'waiting') {
      statusClass = 'badge blue';
      statusLabel = '未参加';
    }
    const vote = p.choice ? `${p.choice}` : '-';
    const connected = p.connected > 0 ? `${p.connected} 接続` : '未接続';
    div.innerHTML = `
      <div class="name">${p.name}</div>
      <div class="meta">状態: <span class="${statusClass}">${statusLabel}</span></div>
      <div class="meta">投票: ${vote}</div>
      <div class="meta">接続: ${connected}</div>
    `;
    if ((state.phase === 'result' || state.phase === 'final') && state.minority && p.choice === state.minority) {
      div.style.borderColor = 'rgba(34, 197, 94, 0.4)';
    } else if ((state.phase === 'result' || state.phase === 'final') && state.minority && p.choice && p.choice !== state.minority) {
      div.style.opacity = 0.6;
    }
    fragments.appendChild(div);
  });
  els.players.appendChild(fragments);
  const activeConnected = list.filter((p) => p.connected > 0 && p.status === 'active').length;
  els.playerNote.textContent = `アクティブ接続: ${activeConnected} / ${list.length}`;
}

function renderWinners(list, phase) {
  if (!els.winners || !els.winnersNote) return;
  els.winners.innerHTML = '';
  if (phase !== 'final') {
    els.winnersNote.textContent = '未確定';
    return;
  }
  if (!list.length) {
    els.winnersNote.textContent = '勝者なし';
    return;
  }
  const fragments = document.createDocumentFragment();
  list.forEach((w) => {
    const div = document.createElement('div');
    div.className = 'player';
    div.innerHTML = `
      <div class="name">${w.name}</div>
      <div class="meta">ID: ${w.id}</div>
    `;
    fragments.appendChild(div);
  });
  els.winners.appendChild(fragments);
  els.winnersNote.textContent = `勝者: ${list.length} 名`;
}

// 進行操作
els.startBtn.addEventListener('click', () => {
  sendAdmin('admin:start', {
    question: els.questionInput.value,
    optionA: els.optionA.value,
    optionB: els.optionB.value,
  });
  showToast('入力内容で開始しました');
});

els.queueAddBtn.addEventListener('click', () => {
  sendAdmin('admin:queue:add', {
    question: els.questionInput.value,
    optionA: els.optionA.value,
    optionB: els.optionB.value,
  });
  els.questionInput.value = '';
  els.optionA.value = '';
  els.optionB.value = '';
  showToast('キューに追加しました');
});

if (els.bulkAddBtn) {
  els.bulkAddBtn.addEventListener('click', handleBulkAdd);
}

if (els.bulkClearBtn) {
  els.bulkClearBtn.addEventListener('click', () => {
    clearBulkInput();
    showToast('入力をクリアしました');
  });
}

if (els.bulkFile) {
  els.bulkFile.addEventListener('change', handleBulkFileChange);
}

els.queueStartBtn.addEventListener('click', () => {
  sendAdmin('admin:next');
  showToast('キュー先頭の問題を開始します');
});

els.revealBtn.addEventListener('click', () => {
  sendAdmin('admin:reveal');
  showToast('結果を表示しました');
});

if (els.finalBtn) {
  els.finalBtn.addEventListener('click', () => {
    sendAdmin('admin:final');
    showToast('最終結果を表示します');
  });
}

els.resetBtn.addEventListener('click', () => {
  const ok = confirm('全ての状態をリセットしますか？プリセットも消去されます。');
  if (!ok) return;
  sendAdmin('admin:reset');
  showToast('リセットしました');
});

if (els.softResetBtn) {
  els.softResetBtn.addEventListener('click', () => {
    const ok = confirm('キューを残したまま試合状況だけリセットしますか？');
    if (!ok) return;
    sendAdmin('admin:reset:keep-queue');
    showToast('状況のみリセットしました');
  });
}

els.queueList.addEventListener('click', (e) => {
  const target = e.target;
  if (target.dataset.remove) {
    sendAdmin('admin:queue:remove', { id: target.dataset.remove });
  }
});

// パスワード変更
async function changePasswords() {
  const adminPass = localStorage.getItem(storageKeys.adminPass) || '';
  if (!adminPass) {
    showToast('一度ログアウトし再ログインしてください', 'warn');
    return;
  }
  const newAdminPass = els.newAdminPass?.value.trim() || '';
  const newPlayerPass = els.newPlayerPass?.value.trim() || '';
  if (!newAdminPass && !newPlayerPass) {
    showToast('変更内容がありません', 'warn');
    return;
  }
  try {
    const res = await fetch('/api/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminPass, newAdminPass, newPlayerPass }),
    });
    if (!res.ok) {
      showToast('パスワード変更に失敗しました', 'warn');
      return;
    }
    if (newAdminPass) {
      localStorage.setItem(storageKeys.adminPass, newAdminPass);
    }
    els.newAdminPass.value = '';
    els.newPlayerPass.value = '';
    showToast('パスワードを更新しました');
    if (newAdminPass) connect();
  } catch {
    showToast('通信エラーが発生しました', 'warn');
  }
}

const changePassBtn = document.getElementById('change-pass-btn');
if (changePassBtn) changePassBtn.addEventListener('click', changePasswords);

if (els.logout) {
  els.logout.addEventListener('click', () => {
    localStorage.removeItem(storageKeys.adminPass);
    showToast('ログアウトしました');
    window.location.replace('/login.html');
  });
}

if (ensureLoggedIn()) {
  connect();
}
