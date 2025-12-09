const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
const wsUrl = `${protocol}://${window.location.host}`;

let ws = null;
let reconnectTimer = null;

const els = {
  phase: document.getElementById('phase-label'),
  round: document.getElementById('round-label'),
  connected: document.getElementById('connected-label'),
  active: document.getElementById('active-label'),
  votes: document.getElementById('votes-label'),
  questionInput: document.getElementById('question-input'),
  optionA: document.getElementById('option-a'),
  optionB: document.getElementById('option-b'),
  startBtn: document.getElementById('start-btn'),
  revealBtn: document.getElementById('reveal-btn'),
  resetBtn: document.getElementById('reset-btn'),
  queueAddBtn: document.getElementById('queue-add-btn'),
  queueStartBtn: document.getElementById('queue-start-btn'),
  queueList: document.getElementById('queue-list'),
  queueCount: document.getElementById('queue-count'),
  queueEmpty: document.getElementById('queue-empty'),
  summaryTotal: document.getElementById('summary-total'),
  summaryActive: document.getElementById('summary-active'),
  summaryA: document.getElementById('summary-a'),
  summaryB: document.getElementById('summary-b'),
  summaryMinority: document.getElementById('summary-minority'),
  questionPreview: document.getElementById('question-preview'),
  players: document.getElementById('players'),
  playerNote: document.getElementById('player-note'),
  toast: document.getElementById('toast'),
};

function showToast(message, type = 'success') {
  els.toast.textContent = message;
  els.toast.className = `toast ${type}`;
  els.toast.style.display = 'block';
  setTimeout(() => {
    els.toast.style.display = 'none';
  }, 2000);
}

function connect() {
  if (ws) {
    ws.close();
  }
  ws = new WebSocket(wsUrl);

  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({ type: 'register', role: 'admin', name: 'admin' }));
  });

  ws.addEventListener('message', (event) => {
    let payload = null;
    try {
      payload = JSON.parse(event.data);
    } catch (err) {
      return;
    }
    if (payload.type === 'state') {
      render(payload);
    }
  });

  ws.addEventListener('close', () => {
    els.phase.textContent = '再接続中...';
    if (!reconnectTimer) {
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
  const phaseLabel =
    state.phase === 'voting'
      ? '回答受付中'
      : state.phase === 'result'
      ? '結果表示'
      : '待機中';

  els.phase.textContent = phaseLabel;
  els.round.textContent = state.round || 0;
  const connected = admin.players ? admin.players.filter((p) => p.connected > 0).length : 0;
  els.connected.textContent = `${connected} 接続`;
  els.active.textContent = `${state.activePlayers} / ${state.totalPlayers}`;
  els.votes.textContent = `${state.votesSubmitted} 件`;

  els.summaryTotal.textContent = `${state.totalPlayers} 名`;
  els.summaryActive.textContent = `${state.activePlayers} 名`;
  if (admin.counts) {
    els.summaryA.textContent = `${admin.counts.A} 票`;
    els.summaryB.textContent = `${admin.counts.B} 票`;
  } else {
    els.summaryA.textContent = '-';
    els.summaryB.textContent = '-';
  }

  if (state.phase === 'result') {
    els.summaryMinority.textContent = state.minority ? `${state.minority} が少数派` : '同数のため全員残留';
  } else {
    els.summaryMinority.textContent = '未公開';
  }

  els.questionPreview.textContent = `問題: ${state.question || '---'}`;

  renderQueue(queue, state.phase);

  if (admin.players) {
    renderPlayers(admin.players, state);
  }

  els.startBtn.disabled = state.phase === 'voting';
  els.revealBtn.disabled = state.votesSubmitted === 0;
  els.queueStartBtn.disabled = queue.length === 0 || state.phase === 'voting';
}

function renderQueue(queue, phase) {
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

function renderPlayers(list, state) {
  els.players.innerHTML = '';
  const fragments = document.createDocumentFragment();
  const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  sorted.forEach((p) => {
    const div = document.createElement('div');
    div.className = 'player';
    const status = p.active ? 'badge green' : 'badge red';
    const vote = p.choice ? `${p.choice}` : '-';
    const connected = p.connected > 0 ? `${p.connected} 接続` : '未接続';
    div.innerHTML = `
      <div class="name">${p.name}</div>
      <div class="meta">状態: <span class="${status}">${p.active ? '残留' : '脱落'}</span></div>
      <div class="meta">投票: ${vote}</div>
      <div class="meta">接続: ${connected}</div>
    `;
    if (state.phase === 'result' && state.minority && p.choice === state.minority) {
      div.style.borderColor = 'rgba(34, 197, 94, 0.4)';
    } else if (state.phase === 'result' && state.minority && p.choice && p.choice !== state.minority) {
      div.style.opacity = 0.6;
    }
    fragments.appendChild(div);
  });
  els.players.appendChild(fragments);
  const activeConnected = list.filter((p) => p.connected > 0 && p.active).length;
  els.playerNote.textContent = `アクティブ接続: ${activeConnected} / ${list.length}`;
}

// イベント
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

els.queueStartBtn.addEventListener('click', () => {
  sendAdmin('admin:next');
  showToast('キュー先頭の問題を開始します');
});

els.revealBtn.addEventListener('click', () => {
  sendAdmin('admin:reveal');
  showToast('結果を表示しました');
});

els.resetBtn.addEventListener('click', () => {
  const ok = confirm('全ての状態をリセットしますか？プリセットも消去されます。');
  if (!ok) return;
  sendAdmin('admin:reset');
  showToast('リセットしました');
});

els.queueList.addEventListener('click', (e) => {
  const target = e.target;
  if (target.dataset.remove) {
    sendAdmin('admin:queue:remove', { id: target.dataset.remove });
  }
});

connect();
