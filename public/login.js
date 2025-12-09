const storageKeys = {
  adminPass: 'mg_admin_pass',
  playerPass: 'mg_player_pass',
};

const passInput = document.getElementById('login-pass');
const loginBtn = document.getElementById('login-btn');
const messageEl = document.getElementById('login-message');

function setMessage(text, type = 'info') {
  messageEl.textContent = text;
  messageEl.style.color = type === 'error' ? '#ef4444' : '#94a3b8';
}

async function checkPass(pass) {
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pass }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.role || null;
  } catch {
    return null;
  }
}

async function handleLogin(inputPass) {
  const pass = (inputPass || '').trim();
  if (!pass) {
    setMessage('パスワードを入力してください', 'error');
    return;
  }
  setMessage('確認中...');
  const role = await checkPass(pass);
  if (!role) {
    setMessage('パスワードが違います', 'error');
    return;
  }

  if (role === 'admin') {
    localStorage.setItem(storageKeys.adminPass, pass);
    setMessage('管理者としてログインします...');
    window.location.replace('/admin.html');
  } else {
    // プレイヤーIDが未発行ならここで発行して保存
    const existingId = localStorage.getItem('mg_player_id');
    if (!existingId) {
      const pid = window.crypto?.randomUUID
        ? window.crypto.randomUUID()
        : `pid_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      localStorage.setItem('mg_player_id', pid);
    }
    localStorage.setItem(storageKeys.playerPass, pass);
    setMessage('参加者としてログインします...');
    window.location.replace('/index.html');
  }
}

loginBtn.addEventListener('click', () => {
  handleLogin(passInput.value);
});

passInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    handleLogin(passInput.value);
  }
});

// 保存済みなら自動判定
(async () => {
  const savedAdmin = localStorage.getItem(storageKeys.adminPass);
  if (savedAdmin) {
    const role = await checkPass(savedAdmin);
    if (role === 'admin') {
      setMessage('管理者として自動ログインします...');
      window.location.replace('/admin.html');
      return;
    }
  }
  const savedPlayer = localStorage.getItem(storageKeys.playerPass);
  if (savedPlayer) {
    const role = await checkPass(savedPlayer);
    if (role === 'player') {
      setMessage('参加者として自動ログインします...');
      window.location.replace('/index.html');
      return;
    }
  }
})();
