// popup.js — Zalo Auto Add Friend

let contacts = []; // { phone, name }
let results = { success: 0, not_found: 0, already_friend: 0, error: 0 };
let isRunning = false;

// ─── Settings button ──────────────────────────────────────────────────────────
document.getElementById('open-settings').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// ─── File upload ──────────────────────────────────────────────────────────────
document.getElementById('file-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  readExcel(file);
});

document.getElementById('upload-label').addEventListener('dragover', (e) => {
  e.preventDefault();
  e.currentTarget.style.borderColor = '#0060af';
});
document.getElementById('upload-label').addEventListener('dragleave', (e) => {
  e.currentTarget.style.borderColor = '';
});
document.getElementById('upload-label').addEventListener('drop', (e) => {
  e.preventDefault();
  e.currentTarget.style.borderColor = '';
  const file = e.dataTransfer.files[0];
  if (file) readExcel(file);
});

function readExcel(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const data = new Uint8Array(e.target.result);
    const workbook = XLSX.read(data, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    // Row 0 = headers, Col 0 = ĐT di động, Col 1 = Tên
    contacts = [];
    let emptyCount = 0;

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const rawPhone = row[0] ? String(row[0]).trim() : '';
      const name     = row[1] ? String(row[1]).trim() : '';

      if (!rawPhone) { emptyCount++; continue; }

      // Normalize: bỏ số 0 đầu hoặc +84
      const phone = normalizePhone(rawPhone);
      if (phone) contacts.push({ phone, rawPhone, name, status: 'pending' });
      else emptyCount++;
    }

    document.getElementById('upload-text').textContent = `✅ ${file.name}`;
    document.getElementById('count-total').textContent = rows.length - 1;
    document.getElementById('count-valid').textContent = contacts.length;
    document.getElementById('count-empty').textContent = emptyCount;

    document.getElementById('stats-bar').style.display = 'flex';
    document.getElementById('phone-list').style.display = 'block';
    document.getElementById('progress-wrap').style.display = 'block';
    document.getElementById('result-row').style.display = 'flex';
    document.getElementById('controls').style.display = 'flex';
    document.getElementById('progress-text').textContent = `0 / ${contacts.length}`;

    renderPhoneList();

    // Lưu contacts vào storage
    chrome.storage.local.set({ contacts, currentIndex: 0, results: { success: 0, not_found: 0, already_friend: 0, error: 0 } });
  };
  reader.readAsArrayBuffer(file);
}

function normalizePhone(phone) {
  let p = phone.replace(/\D/g, '');
  if (p.startsWith('84') && p.length >= 11) p = p.slice(2);
  if (p.startsWith('0')) p = p.slice(1);
  if (p.length < 8 || p.length > 11) return null;
  return p;
}

function renderPhoneList() {
  const body = document.getElementById('list-body');
  body.innerHTML = contacts.map((c, i) => `
    <div class="phone-item" id="item-${i}">
      <div class="status-dot ${c.status !== 'pending' ? c.status : ''}"></div>
      <span class="phone">${c.rawPhone}</span>
      <span class="name">${c.name || ''}</span>
    </div>
  `).join('');
}

function updateItem(index, status, errorMsg) {
  const dot = document.querySelector(`#item-${index} .status-dot`);
  if (dot) {
    dot.className = 'status-dot ' + (status === 'running' ? 'running' : status);
    const parent = dot.parentElement;
    if (status === 'error' && errorMsg) {
      parent.setAttribute('title', errorMsg);
      parent.style.color = '#f87171';
    } else {
      parent.removeAttribute('title');
      parent.style.color = '';
    }
  }
}

// ─── Controls ─────────────────────────────────────────────────────────────────
document.getElementById('btn-start').addEventListener('click', startQueue);
document.getElementById('btn-pause').addEventListener('click', pauseQueue);
document.getElementById('btn-resume').addEventListener('click', resumeQueue);
document.getElementById('btn-stop').addEventListener('click', stopQueue);
document.getElementById('btn-reset').addEventListener('click', resetAll);

function startQueue() {
  if (!contacts.length) return;
  isRunning = true;
  setStatus('▶ Đang chạy...');
  toggleButtons('running');
  chrome.runtime.sendMessage({ action: 'START_QUEUE' });
}

function pauseQueue() {
  chrome.runtime.sendMessage({ action: 'PAUSE_QUEUE' });
  setStatus('⏸ Đã tạm dừng');
  toggleButtons('paused');
}

function resumeQueue() {
  chrome.runtime.sendMessage({ action: 'RESUME_QUEUE' });
  setStatus('▶ Tiếp tục...');
  toggleButtons('running');
}

function stopQueue() {
  chrome.runtime.sendMessage({ action: 'STOP_QUEUE' });
  setStatus('⏹ Đã dừng');
  toggleButtons('idle');
}

function resetAll() {
  chrome.runtime.sendMessage({ action: 'STOP_QUEUE' });
  contacts = [];
  results = { success: 0, not_found: 0, already_friend: 0, error: 0 };
  chrome.storage.local.remove(['contacts', 'currentIndex', 'results']);

  document.getElementById('stats-bar').style.display = 'none';
  document.getElementById('phone-list').style.display = 'none';
  document.getElementById('progress-wrap').style.display = 'none';
  document.getElementById('result-row').style.display = 'none';
  document.getElementById('controls').style.display = 'none';
  document.getElementById('upload-text').textContent = 'Chọn file Excel (.xlsx)';
  document.getElementById('file-input').value = '';
  setStatus('');
}

function toggleButtons(state) {
  const start  = document.getElementById('btn-start');
  const pause  = document.getElementById('btn-pause');
  const resume = document.getElementById('btn-resume');
  const stop   = document.getElementById('btn-stop');

  start.style.display  = state === 'idle' ? 'block' : 'none';
  pause.style.display  = state === 'running' ? 'block' : 'none';
  resume.style.display = state === 'paused' ? 'block' : 'none';
  stop.style.display   = state !== 'idle' ? 'block' : 'none';
}

function setStatus(msg) {
  document.getElementById('status-msg').textContent = msg;
}

// ─── Listen messages from background ─────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'PROGRESS_UPDATE') {
    const { index, status, errorMsg, total } = msg;
    updateItem(index, status, errorMsg);

    // Update result counters
    if (status !== 'running' && results[status] !== undefined) {
      results[status]++;
      document.getElementById(`r-${status.replace('_', '-')}`).textContent = results[status];
    }

    // Progress bar
    const done = results.success + results.not_found + results.already_friend + results.error;
    const pct = total ? Math.round((done / total) * 100) : 0;
    document.getElementById('progress-fill').style.width = pct + '%';
    document.getElementById('progress-text').textContent = `${done} / ${total}`;
    document.getElementById('progress-label').textContent = `${pct}%`;

    // Scroll active item into view
    const item = document.getElementById(`item-${index}`);
    if (item) item.scrollIntoView({ block: 'nearest' });
  }

  if (msg.action === 'QUEUE_DONE') {
    setStatus('🎉 Hoàn thành!');
    toggleButtons('idle');
  }

  if (msg.action === 'QUEUE_ERROR') {
    setStatus(`❌ ${msg.error}`);
    toggleButtons('idle');
  }
});

// ─── Restore state on popup open ──────────────────────────────────────────────
chrome.storage.local.get(['contacts', 'currentIndex', 'results', 'queueState'], (data) => {
  if (data.contacts && data.contacts.length > 0) {
    contacts = data.contacts;
    results = data.results || { success: 0, not_found: 0, already_friend: 0, error: 0 };
    const idx = data.currentIndex || 0;

    document.getElementById('stats-bar').style.display = 'flex';
    document.getElementById('phone-list').style.display = 'block';
    document.getElementById('progress-wrap').style.display = 'block';
    document.getElementById('result-row').style.display = 'flex';
    document.getElementById('controls').style.display = 'flex';
    document.getElementById('count-valid').textContent = contacts.length;
    document.getElementById('r-success').textContent = results.success;
    document.getElementById('r-not-found').textContent = results.not_found;
    document.getElementById('r-already').textContent = results.already_friend;
    document.getElementById('r-error').textContent = results.error;

    const done = results.success + results.not_found + results.already_friend + results.error;
    document.getElementById('progress-text').textContent = `${done} / ${contacts.length}`;

    renderPhoneList();

    const state = data.queueState;
    if (state === 'running') {
      toggleButtons('running');
      setStatus('▶ Đang chạy...');
    } else if (state === 'paused') {
      toggleButtons('paused');
      setStatus('⏸ Đã tạm dừng');
    }
  }
});
