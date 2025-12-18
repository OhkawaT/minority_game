const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
const wsUrl = `${protocol}://${window.location.host}`;

let ws = null;
let reconnectTimer = null;

const els = {
  phase: document.getElementById('phase-label'),
  round: document.getElementById('round-label'),
  total: document.getElementById('total-label'),
  active: document.getElementById('active-label'),
  question: document.getElementById('question-title'),
  optA: document.getElementById('opt-a-label'),
  optAVotes: document.getElementById('opt-a-votes'),
  optB: document.getElementById('opt-b-label'),
  optBVotes: document.getElementById('opt-b-votes'),
  minority: document.getElementById('minority-label'),
  questionCard: document.getElementById('question-card'),
  finalCard: document.getElementById('final-card'),
  winnerCount: document.getElementById('winner-count'),
  winnerList: document.getElementById('winner-list'),
};

function connect() {
  if (ws) ws.close();
  ws = new WebSocket(wsUrl);

  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({ type: 'register', role: 'viewer' }));
  });

  ws.addEventListener('message', (event) => {
    let payload = null;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }
    if (payload.type === 'state') {
      render(payload);
    }
  });

  ws.addEventListener('close', () => {
    if (!reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, 1000);
    }
  });
}

function render(state) {
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
  els.total.textContent = state.totalPlayers;
  els.active.textContent = state.activePlayers;

  if (state.phase === 'final' && state.finalWinners) {
    els.questionCard.style.display = 'none';
    els.finalCard.style.display = 'block';
    els.winnerCount.textContent = `${state.finalWinners.length} 名`;
    els.winnerList.innerHTML = '';
    const frag = document.createDocumentFragment();
    state.finalWinners.forEach((w) => {
      const div = document.createElement('div');
      div.className = 'winner-item';
      div.innerHTML = `<div class="name">${w.name}</div>`;
      frag.appendChild(div);
    });
    els.winnerList.appendChild(frag);
    return;
  } else {
    els.questionCard.style.display = 'block';
    els.finalCard.style.display = 'none';
  }

  els.question.textContent = state.question || '準備中';
  els.optA.textContent = state.options?.[0] || 'A';
  els.optB.textContent = state.options?.[1] || 'B';

  // 票数と少数派
  if ((state.phase === 'result' || state.phase === 'final') && state.counts) {
    els.optAVotes.textContent = `${state.counts.A} 票`;
    els.optBVotes.textContent = `${state.counts.B} 票`;
    if (state.minority === 'A') {
      els.optA.parentElement.classList.add('highlight-minority');
      els.optB.parentElement.classList.remove('highlight-minority');
      els.minority.textContent = 'A が少数派';
    } else if (state.minority === 'B') {
      els.optB.parentElement.classList.add('highlight-minority');
      els.optA.parentElement.classList.remove('highlight-minority');
      els.minority.textContent = 'B が少数派';
    } else {
      els.optA.parentElement.classList.remove('highlight-minority');
      els.optB.parentElement.classList.remove('highlight-minority');
      if (state.counts.A === 0 || state.counts.B === 0) {
        els.minority.textContent = '無効（片方0票）';
      } else {
        els.minority.textContent = '同数';
      }
    }
  } else {
    els.optAVotes.textContent = '-';
    els.optBVotes.textContent = '-';
    els.minority.textContent = '-';
    els.optA.parentElement.classList.remove('highlight-minority');
    els.optB.parentElement.classList.remove('highlight-minority');
  }
}

connect();
