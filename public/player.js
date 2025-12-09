const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
const wsUrl = `${protocol}://${window.location.host}`;

let ws = null;
let reconnectTimer = null;
let reconnectAllowed = true;
let lastState = null;

const els = {
  phase: document.getElementById('phase-label'),
  round: document.getElementById('round-label'),
  playerCount: document.getElementById('player-count'),
  votesCount: document.getElementById('votes-count'),
  question: document.getElementById('question-text'),
  activeStatus: document.getElementById('active-status'),
  voteStatus: document.getElementById('vote-status'),
  nameInput: document.getElementById('name-input'),
  saveName: document.getElementById('save-name'),
  logout: document.getElementById('logout-btn'),
  nameHint: document.getElementById('name-hint'),
  summaryTotal: document.getElementById('summary-total'),
  summaryActive: document.getElementById('summary-active'),
  summaryA: document.getElementById('summary-a'),
  summaryB: document.getElementById('summary-b'),
  summaryMinority: document.getElementById('summary-minority'),
  toast: document.getElementById('toast'),
  optionButtons: Array.from(document.querySelectorAll('#option-area button')),
};

const storageKeys = {
  id: 'mg_player_id',
  name: 'mg_player_name',
  pass: 'mg_player_pass',
};

function getOrCreatePlayerId() {
  let pid = localStorage.getItem(storageKeys.id);
  if (!pid) {
    pid = window.crypto?.randomUUID
      ? window.crypto.randomUUID()
      : `pid_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(storageKeys.id, pid);
  }
  return pid;
}

function ensureLoggedIn() {
  const pass = localStorage.getItem(storageKeys.pass) || '';
  if (!pass) {
    window.location.replace('/login.html');
    return false;
  }
  return true;
}

function loadProfile() {
  const savedName = localStorage.getItem(storageKeys.name) || '';
  els.nameInput.value = savedName;
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
  if (ws) {
    ws.close();
  }
  ws = new WebSocket(wsUrl);

  ws.addEventListener('open', () => {
    register();
  });

  ws.addEventListener('message', (event) => {
    let payload = null;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }
    if (payload.type === 'auth' && payload.ok === false) {
      els.activeStatus.textContent = '認証エラー';
      els.activeStatus.className = 'status warn';
      showToast('パスワードが違います', 'warn');
      reconnectAllowed = false;
      ws.close();
      return;
    }
    if (payload.type === 'registered') {
      if (payload.playerId) {
        localStorage.setItem(storageKeys.id, payload.playerId);
      }
      return;
    }
    if (payload.type === 'state') {
      lastState = payload;
      render(payload);
    }
  });

  ws.addEventListener('close', () => {
    els.activeStatus.textContent = '再接続中...';
    els.activeStatus.className = 'status warn';
    if (!reconnectTimer && reconnectAllowed) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, 1000);
    }
  });
}

function register() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const name = els.nameInput.value.trim() || '名無し';
  const existingId = getOrCreatePlayerId();
  const pass = localStorage.getItem(storageKeys.pass) || '';
  if (!pass) {
    ensureLoggedIn();
    return;
  }
  ws.send(
    JSON.stringify({
      type: 'register',
      name,
      playerId: existingId,
      role: 'player',
      pass,
    }),
  );
  localStorage.setItem(storageKeys.name, name);
  els.nameHint.textContent = `登録名: ${name}`;
}

function sendVote(choice) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'vote', choice }));
}

function render(state) {
  const phaseLabel =
    state.phase === 'voting'
      ? '回答受付中'
      : state.phase === 'result'
      ? '結果表示'
      : '待機中';

  els.phase.textContent = phaseLabel;
  els.round.textContent = state.round || 0;
  els.playerCount.textContent = `${state.totalPlayers} 名`;
  els.votesCount.textContent = `${state.votesSubmitted} 件`;
  els.question.textContent = state.question || '準備中';

  const you = state.you || { active: false, choice: null, winner: null };
  if (you.active) {
    if (state.phase === 'final') {
      if (you.winner) {
        els.activeStatus.textContent = 'Winner';
        els.activeStatus.className = 'status ok';
      } else {
        els.activeStatus.textContent = 'Loser';
        els.activeStatus.className = 'status warn';
      }
    } else {
      els.activeStatus.textContent = '参加中';
      els.activeStatus.className = 'status ok';
    }
  } else {
    els.activeStatus.textContent = state.totalPlayers === 0 ? '待機中' : '脱落';
    els.activeStatus.className = 'status warn';
  }

  els.optionButtons.forEach((btn, idx) => {
    const label = idx === 0 ? state.options?.[0] : state.options?.[1];
    const choice = idx === 0 ? 'A' : 'B';
    const caption = btn.querySelector('.muted');
    let strongText = `${choice}: ${label || choice}`;
    if (state.phase === 'result' && state.counts) {
      strongText += ` (${state.counts[choice]}票)`;
    }
    btn.querySelector('strong').textContent = strongText;
    if (caption) {
      caption.textContent = label || '選択肢';
    }
  });

  const canVote = state.phase === 'voting' && you.active;
  els.optionButtons.forEach((btn) => {
    btn.disabled = !canVote;
    btn.classList.toggle('ghost', !canVote);
    const choice = btn.dataset.choice;
    btn.classList.toggle('selected', you.choice === choice);
  });

  if (you.choice) {
    els.voteStatus.textContent = `あなたの選択: ${you.choice}`;
  } else if (canVote) {
    els.voteStatus.textContent = 'まだ未選択です。どちらかをタップしてください。';
  } else {
    els.voteStatus.textContent = '投票できません。管理者の操作をお待ちください。';
  }

  els.summaryTotal.textContent = `${state.totalPlayers} 名`;
  els.summaryActive.textContent = `${state.activePlayers} 名`;

  els.summaryA.classList.remove('highlight-minority', 'highlight-majority');
  els.summaryB.classList.remove('highlight-minority', 'highlight-majority');
  els.summaryMinority.className = '';

  const showCounts = (state.phase === 'result' || state.phase === 'final') && state.counts;
  if (showCounts) {
    els.summaryA.textContent = `${state.counts.A} 票`;
    els.summaryB.textContent = `${state.counts.B} 票`;
    if (state.minority) {
      els.summaryMinority.textContent = `${state.minority} が少数派`;
      if (state.minority === 'A') {
        els.summaryA.classList.add('highlight-minority');
        els.summaryB.classList.add('highlight-majority');
      } else if (state.minority === 'B') {
        els.summaryB.classList.add('highlight-minority');
        els.summaryA.classList.add('highlight-majority');
      }
    } else {
      els.summaryMinority.textContent = '同数のため全員残留';
      els.summaryMinority.className = 'highlight-majority';
    }
  } else {
    els.summaryA.textContent = '-';
    els.summaryB.textContent = '-';
    els.summaryMinority.textContent = '-';
  }
}

// イベント登録
els.saveName.addEventListener('click', () => {
  register();
  showToast('登録しました');
});

els.optionButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const choice = btn.dataset.choice;
    sendVote(choice);
    showToast(`${choice} に投票しました`, 'success');
  });
});

if (els.logout) {
  els.logout.addEventListener('click', () => {
    localStorage.removeItem(storageKeys.pass);
    localStorage.removeItem(storageKeys.id);
    showToast('ログアウトしました');
    window.location.replace('/login.html');
  });
}

if (ensureLoggedIn()) {
  loadProfile();
  connect();
}
