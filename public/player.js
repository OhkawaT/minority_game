const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
const wsUrl = `${protocol}://${window.location.host}`;

let ws = null;
let reconnectTimer = null;
let reconnectAllowed = true;
let lastState = null;
let lastAnnouncedResultAt = null;

const els = {
  phase: document.getElementById('phase-label'),
  round: document.getElementById('round-label'),
  playerCount: document.getElementById('player-count'),
  votesCount: document.getElementById('votes-count'),
  question: document.getElementById('question-text'),
  activeStatus: document.getElementById('active-status'),
  voteStatus: document.getElementById('vote-status'),
  nameDisplay: document.getElementById('name-display'),
  logout: document.getElementById('logout-btn'),
  summaryTotal: document.getElementById('summary-total'),
  summaryActive: document.getElementById('summary-active'),
  summaryA: document.getElementById('summary-a'),
  summaryB: document.getElementById('summary-b'),
  summaryMinority: document.getElementById('summary-minority'),
  toast: document.getElementById('toast'),
  resultModal: document.getElementById('result-modal'),
  resultModalTitle: document.getElementById('result-modal-title'),
  resultModalBody: document.getElementById('result-modal-body'),
  resultModalClose: document.getElementById('result-modal-close'),
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
  const name = localStorage.getItem(storageKeys.name) || '';
  if (!pass || !name) {
    window.location.replace('/login.html');
    return false;
  }
  return true;
}

function loadName() {
  const savedName = localStorage.getItem(storageKeys.name) || '';
  if (!savedName) {
    window.location.replace('/login.html');
    return;
  }
  if (els.nameDisplay) {
    els.nameDisplay.textContent = savedName;
  }
}

function showToast(message, type = 'success') {
  els.toast.textContent = message;
  els.toast.className = `toast ${type}`;
  els.toast.style.display = 'block';
  setTimeout(() => {
    els.toast.style.display = 'none';
  }, 2000);
}

function setActiveStatus(text, typeClass) {
  if (!els.activeStatus) return;
  els.activeStatus.textContent = text;
  els.activeStatus.className = `status prominent ${typeClass || ''}`.trim();
}

function closeResultModal() {
  if (!els.resultModal) return;
  els.resultModal.classList.remove('open');
  els.resultModal.setAttribute('aria-hidden', 'true');
}

function openResultModal({ title, outcomeText, outcomeKind, rows }) {
  if (!els.resultModal || !els.resultModalBody) return;
  if (els.resultModalTitle) {
    els.resultModalTitle.textContent = title;
  }

  els.resultModalBody.textContent = '';

  const outcome = document.createElement('div');
  outcome.className = `result-outcome ${outcomeKind || ''}`.trim();
  outcome.textContent = outcomeText;
  els.resultModalBody.appendChild(outcome);

  if (rows && rows.length) {
    const grid = document.createElement('div');
    grid.className = 'modal-grid';
    rows.forEach(({ label, value }) => {
      const row = document.createElement('div');
      row.className = 'modal-row';

      const labelEl = document.createElement('span');
      labelEl.className = 'label';
      labelEl.textContent = label;

      const valueEl = document.createElement('span');
      valueEl.className = 'value';
      valueEl.textContent = value;

      row.appendChild(labelEl);
      row.appendChild(valueEl);
      grid.appendChild(row);
    });
    els.resultModalBody.appendChild(grid);
  }

  els.resultModal.classList.add('open');
  els.resultModal.setAttribute('aria-hidden', 'false');
}

function showRoundResultModal(state) {
  const you = state.you || { active: false, status: 'waiting', choice: null, winner: null };
  const status = you.status || (you.active ? 'active' : 'waiting');
  const counts = state.counts || { A: 0, B: 0 };
  const choiceText = you.choice ? you.choice : '未投票';

  const outcomeKind = status === 'out' ? 'out' : status === 'waiting' ? 'waiting' : 'survive';
  const outcomeText = status === 'out' ? '脱落' : status === 'waiting' ? '未参加' : '生存';

  const minorityText = state.minority ? state.minority : '同数';
  const minorityNote = state.minority ? `少数派: ${minorityText}` : '同数（未投票は脱落）';

  openResultModal({
    title: `第${state.round || 0}ラウンド 結果`,
    outcomeText,
    outcomeKind,
    rows: [
      { label: '投票数', value: `A ${counts.A}票 / B ${counts.B}票` },
      { label: '判定', value: minorityNote },
      { label: 'あなたの選択', value: choiceText },
    ],
  });
}

function showFinalResultModal(state) {
  const you = state.you || { active: false, status: 'waiting', choice: null, winner: null };
  const status = you.status || (you.active ? 'active' : 'waiting');
  const winners = Array.isArray(state.finalWinners) ? state.finalWinners : [];
  const outcomeText = status === 'waiting' ? '未参加' : you.winner ? '勝利' : '敗北';
  const outcomeKind = status === 'waiting' ? 'waiting' : you.winner ? 'survive' : 'out';

  openResultModal({
    title: '最終結果',
    outcomeText,
    outcomeKind,
    rows: [{ label: '勝者数', value: `${winners.length} 名` }],
  });
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
      setActiveStatus('認証エラー', 'warn');
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
      const prevState = lastState;
      lastState = payload;
      render(payload, prevState);
    }
  });

  ws.addEventListener('close', () => {
    setActiveStatus('再接続中...', 'warn');
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
  const name = localStorage.getItem(storageKeys.name) || '名無し';
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
}

function sendVote(choice) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'vote', choice }));
}

function render(state, prevState) {
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

  const you = state.you || { active: false, status: 'waiting', choice: null, winner: null };
  const status = you.status || (you.active ? 'active' : 'waiting');

  if (status === 'active') {
    if (state.phase === 'final') {
      if (you.winner) {
        setActiveStatus('勝者', 'final-win');
      } else {
        setActiveStatus('敗者', 'final-lose');
      }
    } else if (state.phase === 'result') {
      setActiveStatus('生存', 'ok');
    } else {
      setActiveStatus('参加中', 'ok');
    }
  } else if (status === 'out') {
    setActiveStatus('脱落', 'out');
  } else {
    setActiveStatus('未参加（次のゲームをお待ちください）', 'warn');
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

  const canVote = state.phase === 'voting' && status === 'active';
  els.optionButtons.forEach((btn) => {
    btn.disabled = !canVote;
    btn.classList.toggle('ghost', !canVote);
    const choice = btn.dataset.choice;
    btn.classList.toggle('selected', you.choice === choice);
  });

  if (status === 'waiting') {
    els.voteStatus.textContent = '未参加です。次のゲーム開始までお待ちください。';
  } else if (status === 'out') {
    els.voteStatus.textContent = '脱落しているため投票できません。';
  } else if (you.choice) {
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
      els.summaryMinority.textContent = '同数（未投票は脱落）';
      els.summaryMinority.className = 'highlight-majority';
    }
  } else {
    els.summaryA.textContent = '-';
    els.summaryB.textContent = '-';
    els.summaryMinority.textContent = '-';
  }

  if (state.phase === 'result') {
    const announcedAt = state.lastResult?.at || null;
    if (announcedAt && announcedAt !== lastAnnouncedResultAt) {
      lastAnnouncedResultAt = announcedAt;
      const prevYou = prevState?.you || null;
      const prevStatus = prevYou ? prevYou.status || (prevYou.active ? 'active' : 'waiting') : null;
      const becameOut = prevStatus === 'active' && status === 'out';
      if (status !== 'out' || becameOut) {
        showRoundResultModal(state);
      } else {
        closeResultModal();
      }
    }
  } else if (state.phase === 'final') {
    if (!prevState || prevState.phase !== 'final') {
      showFinalResultModal(state);
    }
  } else if (prevState && (prevState.phase === 'result' || prevState.phase === 'final')) {
    closeResultModal();
  }
}

els.optionButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const choice = btn.dataset.choice;
    sendVote(choice);
    showToast(`${choice} に投票しました`, 'success');
  });
});

if (els.logout) {
  els.logout.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'leave' }));
    }
    localStorage.removeItem(storageKeys.pass);
    localStorage.removeItem(storageKeys.id);
    localStorage.removeItem(storageKeys.name);
    showToast('ログアウトしました');
    window.location.replace('/login.html');
  });
}

if (ensureLoggedIn()) {
  loadName();

  if (els.resultModalClose) {
    els.resultModalClose.addEventListener('click', closeResultModal);
  }
  if (els.resultModal) {
    els.resultModal.addEventListener('click', (event) => {
      if (event.target?.dataset?.modalClose === '1') {
        closeResultModal();
      }
    });
  }
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeResultModal();
    }
  });

  connect();
}
