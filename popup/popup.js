// popup.js — Zalo Auto Add Friend
// Phase 2: Hard stop banner
// Phase 3: Assisted mode — confirm/skip panel
// Phase 4: Session stats, log viewer, CSV export

var contacts = []; // { phone, name }
var results = { success: 0, not_found: 0, already_friend: 0, error: 0, skipped: 0 };
var isRunning = false;

// ─── Settings button ──────────────────────────────────────────────────────────
document.getElementById('open-settings').addEventListener('click', function () {
  chrome.runtime.openOptionsPage();
});

// ─── File upload ──────────────────────────────────────────────────────────────
document.getElementById('file-input').addEventListener('change', function (e) {
  var file = e.target.files[0];
  if (!file) return;
  readExcel(file);
});

document.getElementById('upload-label').addEventListener('dragover', function (e) {
  e.preventDefault();
  e.currentTarget.style.borderColor = '#0060af';
});
document.getElementById('upload-label').addEventListener('dragleave', function (e) {
  e.currentTarget.style.borderColor = '';
});
document.getElementById('upload-label').addEventListener('drop', function (e) {
  e.preventDefault();
  e.currentTarget.style.borderColor = '';
  var file = e.dataTransfer.files[0];
  if (file) readExcel(file);
});

function readExcel(file) {
  var reader = new FileReader();
  reader.onload = function (e) {
    var data = new Uint8Array(e.target.result);
    var workbook = XLSX.read(data, { type: 'array' });
    var sheet = workbook.Sheets[workbook.SheetNames[0]];
    var rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    // Row 0 = headers, Col 0 = phone, Col 1 = name
    contacts = [];
    var emptyCount = 0;

    for (var i = 1; i < rows.length; i++) {
      var row = rows[i];
      var rawPhone = row[0] ? String(row[0]).trim() : '';
      var name = row[1] ? String(row[1]).trim() : '';

      if (!rawPhone) { emptyCount++; continue; }

      var phone = normalizePhone(rawPhone);
      if (phone) contacts.push({ phone: phone, rawPhone: rawPhone, name: name, status: 'pending' });
      else emptyCount++;
    }

    document.getElementById('upload-text').textContent = '✅ ' + file.name;
    document.getElementById('count-total').textContent = rows.length - 1;
    document.getElementById('count-valid').textContent = contacts.length;
    document.getElementById('count-empty').textContent = emptyCount;

    document.getElementById('stats-bar').style.display = 'flex';
    document.getElementById('phone-list').style.display = 'block';
    document.getElementById('progress-wrap').style.display = 'block';
    document.getElementById('result-row').style.display = 'flex';
    document.getElementById('controls').style.display = 'flex';
    document.getElementById('progress-text').textContent = '0 / ' + contacts.length;

    renderPhoneList();

    chrome.storage.local.set({
      contacts: contacts,
      currentIndex: 0,
      results: { success: 0, not_found: 0, already_friend: 0, error: 0, skipped: 0 },
    });
  };
  reader.readAsArrayBuffer(file);
}

function normalizePhone(phone) {
  var p = phone.replace(/\D/g, '');
  if (p.startsWith('84') && p.length >= 11) p = p.slice(2);
  if (p.startsWith('0')) p = p.slice(1);
  if (p.length < 8 || p.length > 11) return null;
  return p;
}

function renderPhoneList() {
  var body = document.getElementById('list-body');
  body.innerHTML = contacts.map(function (c, i) {
    return '<div class="phone-item" id="item-' + i + '">' +
      '<div class="status-dot ' + (c.status !== 'pending' ? c.status : '') + '"></div>' +
      '<span class="phone">' + escapeHtml(c.rawPhone) + '</span>' +
      '<span class="name">' + escapeHtml(c.name || '') + '</span>' +
    '</div>';
  }).join('');
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function updateItem(index, status, errorMsg) {
  var dot = document.querySelector('#item-' + index + ' .status-dot');
  if (dot) {
    dot.className = 'status-dot ' + (status === 'running' ? 'running' : status);
    var parent = dot.parentElement;
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
  hideConfirmPanel();
  hideHardStopBanner();
  setStatus('▶ Đang chạy...');
  toggleButtons('running');
  showSessionStats();
  chrome.runtime.sendMessage({ action: 'START_QUEUE' });
}

function pauseQueue() {
  chrome.runtime.sendMessage({ action: 'PAUSE_QUEUE' });
  setStatus('⏸ Đã tạm dừng');
  toggleButtons('paused');
}

function resumeQueue() {
  hideConfirmPanel();
  chrome.runtime.sendMessage({ action: 'RESUME_QUEUE' });
  setStatus('▶ Tiếp tục...');
  toggleButtons('running');
}

function stopQueue() {
  hideConfirmPanel();
  chrome.runtime.sendMessage({ action: 'STOP_QUEUE' });
  setStatus('⏹ Đã dừng');
  toggleButtons('idle');
}

function resetAll() {
  chrome.runtime.sendMessage({ action: 'STOP_QUEUE' });
  contacts = [];
  results = { success: 0, not_found: 0, already_friend: 0, error: 0, skipped: 0 };
  chrome.storage.local.remove(['contacts', 'currentIndex', 'results']);

  hideConfirmPanel();
  hideHardStopBanner();
  hideSessionStats();

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
  var start = document.getElementById('btn-start');
  var pause = document.getElementById('btn-pause');
  var resume = document.getElementById('btn-resume');
  var stop = document.getElementById('btn-stop');

  start.style.display = state === 'idle' ? 'block' : 'none';
  pause.style.display = state === 'running' ? 'block' : 'none';
  resume.style.display = state === 'paused' ? 'block' : 'none';
  stop.style.display = state !== 'idle' ? 'block' : 'none';
}

function setStatus(msg) {
  document.getElementById('status-msg').textContent = msg;
}

// ─── Confirm Panel (Phase 3 — Assisted Mode) ─────────────────────────────────

document.getElementById('btn-confirm').addEventListener('click', function () {
  hideConfirmPanel();
  setStatus('⏳ Đang kết bạn...');
  chrome.runtime.sendMessage({ action: 'CONFIRM_ADD_FRIEND' });
});

document.getElementById('btn-skip').addEventListener('click', function () {
  hideConfirmPanel();
  setStatus('⏭️ Đã bỏ qua');
  chrome.runtime.sendMessage({ action: 'SKIP_CONTACT' });
});

function showConfirmPanel(data) {
  document.getElementById('confirm-phone').textContent = data.phone || '';
  document.getElementById('confirm-name').textContent = data.zaloName || '(không rõ)';

  var warningEl = document.getElementById('confirm-warning');
  var warningText = document.getElementById('confirm-warning-text');
  if (data.restrictionSignals && data.restrictionSignals.length > 0) {
    warningText.textContent = 'Phát hiện ' + data.restrictionSignals.length + ' tín hiệu cảnh báo từ Zalo!';
    warningEl.style.display = 'block';
  } else {
    warningEl.style.display = 'none';
  }

  document.getElementById('confirm-panel').style.display = 'block';
  toggleButtons('paused'); // Hide start, show stop
}

function hideConfirmPanel() {
  document.getElementById('confirm-panel').style.display = 'none';
}

// ─── Hard Stop Banner (Phase 2) ──────────────────────────────────────────────

document.getElementById('hard-stop-dismiss').addEventListener('click', function () {
  hideHardStopBanner();
});

function showHardStopBanner(reason) {
  document.getElementById('hard-stop-reason').textContent = reason || 'Lý do không xác định';
  document.getElementById('hard-stop-banner').style.display = 'flex';
  toggleButtons('idle');
  setStatus('🛑 Đã dừng khẩn cấp');
}

function hideHardStopBanner() {
  document.getElementById('hard-stop-banner').style.display = 'none';
}

// ─── Session Stats (Phase 4) ─────────────────────────────────────────────────

function showSessionStats() {
  document.getElementById('session-stats').style.display = 'flex';
}

function hideSessionStats() {
  document.getElementById('session-stats').style.display = 'none';
}

function updateSessionStats(data) {
  document.getElementById('ss-actions').textContent = data.sessionActionCount || 0;
  document.getElementById('ss-cap').textContent = data.sessionCap || 30;
  document.getElementById('ss-errors').textContent = data.consecutiveErrors || 0;
  showSessionStats();
}

// ─── Log Viewer (Phase 4) ─────────────────────────────────────────────────────

document.getElementById('btn-show-log').addEventListener('click', function () {
  var panel = document.getElementById('log-panel');
  if (panel.style.display === 'none') {
    loadAuditLog();
    panel.style.display = 'block';
  } else {
    panel.style.display = 'none';
  }
});

document.getElementById('log-panel-close').addEventListener('click', function () {
  document.getElementById('log-panel').style.display = 'none';
});

function loadAuditLog() {
  chrome.storage.local.get(['auditLog'], function (data) {
    var log = data.auditLog || [];
    var body = document.getElementById('log-panel-body');

    if (log.length === 0) {
      body.innerHTML = '<div class="log-empty">Chưa có dữ liệu</div>';
      return;
    }

    // Show last 50 entries, newest first
    var recent = log.slice(-50).reverse();
    body.innerHTML = recent.map(function (entry) {
      var statusClass = entry.status === 'success' ? 'log-success' :
                        entry.status === 'error' ? 'log-error' :
                        entry.status === 'hard_stop' ? 'log-hard-stop' :
                        entry.status === 'skipped' ? 'log-skipped' : 'log-info';
      var time = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString('vi-VN') : '';
      var phone = entry.phone ? escapeHtml(entry.phone) : '';
      var name = entry.zaloName ? ' — ' + escapeHtml(entry.zaloName) : '';
      var err = entry.errorMsg ? '<div class="log-err">' + escapeHtml(entry.errorMsg) + '</div>' : '';

      return '<div class="log-entry ' + statusClass + '">' +
        '<div class="log-entry-head">' +
          '<span class="log-time">' + time + '</span>' +
          '<span class="log-status">' + escapeHtml(entry.status) + '</span>' +
        '</div>' +
        '<div class="log-entry-body">' + phone + name + '</div>' +
        err +
      '</div>';
    }).join('');
  });
}

// ─── CSV Export (Phase 4) ─────────────────────────────────────────────────────

document.getElementById('btn-export-csv').addEventListener('click', function () {
  chrome.storage.local.get(['contacts', 'results', 'auditLog'], function (data) {
    var contactList = data.contacts || [];
    var auditLog = data.auditLog || [];

    if (contactList.length === 0 && auditLog.length === 0) {
      setStatus('Không có dữ liệu để xuất.');
      return;
    }

    // Build CSV from contacts (primary) with audit enrichment
    var csvRows = ['SĐT,Tên,Trạng thái,Tên Zalo,Lỗi'];

    contactList.forEach(function (c) {
      var row = [
        csvEscape(c.rawPhone || c.phone || ''),
        csvEscape(c.name || ''),
        csvEscape(c.status || 'pending'),
        csvEscape(c.zaloName || ''),
        csvEscape(c.errorMsg || ''),
      ];
      csvRows.push(row.join(','));
    });

    // If no contacts but has audit log, export audit log instead
    if (contactList.length === 0 && auditLog.length > 0) {
      csvRows = ['Thời gian,Hành động,SĐT,Trạng thái,Tên Zalo,Lỗi,Chiến dịch'];
      auditLog.forEach(function (entry) {
        var row = [
          csvEscape(entry.timestamp || ''),
          csvEscape(entry.action || ''),
          csvEscape(entry.phone || ''),
          csvEscape(entry.status || ''),
          csvEscape(entry.zaloName || ''),
          csvEscape(entry.errorMsg || ''),
          csvEscape(entry.campaignLabel || ''),
        ];
        csvRows.push(row.join(','));
      });
    }

    var csv = '\uFEFF' + csvRows.join('\n'); // BOM for Excel UTF-8
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'zalo-results-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    URL.revokeObjectURL(url);
    setStatus('📥 Đã xuất CSV!');
  });
});

function csvEscape(val) {
  var str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

// ─── Listen messages from background ─────────────────────────────────────────
chrome.runtime.onMessage.addListener(function (msg) {
  if (msg.action === 'PROGRESS_UPDATE') {
    var index = msg.index;
    var status = msg.status;
    var errorMsg = msg.errorMsg;
    var total = msg.total;

    updateItem(index, status, errorMsg);

    // Update result counters (skip 'running' and 'resting' statuses)
    if (status !== 'running' && status !== 'resting' && results[status] !== undefined) {
      results[status]++;
      var elId = 'r-' + status.replace('_', '-');
      var el = document.getElementById(elId);
      if (el) el.textContent = results[status];
    }

    // Progress bar
    var done = results.success + results.not_found + results.already_friend + results.error + (results.skipped || 0);
    var pct = total ? Math.round((done / total) * 100) : 0;
    document.getElementById('progress-fill').style.width = pct + '%';
    document.getElementById('progress-text').textContent = done + ' / ' + total;
    document.getElementById('progress-label').textContent = pct + '%';

    // Scroll active item into view
    var item = document.getElementById('item-' + index);
    if (item) item.scrollIntoView({ block: 'nearest' });

    // Update session stats from PROGRESS_UPDATE payload
    if (msg.sessionActionCount !== undefined) {
      updateSessionStats({
        sessionActionCount: msg.sessionActionCount,
        consecutiveErrors: msg.consecutiveErrors || 0,
        sessionCap: msg.sessionCap || 30,
      });
    }
  }

  if (msg.action === 'AWAITING_CONFIRM') {
    // Phase 3: show confirm panel
    showConfirmPanel({
      phone: msg.phone,
      zaloName: msg.zaloName,
      restrictionSignals: msg.restrictionSignals || [],
    });
    setStatus('👤 Chờ xác nhận — kiểm tra profile trên tab Zalo');
  }

  if (msg.action === 'HARD_STOP') {
    // Phase 2: show hard stop banner
    hideConfirmPanel();
    showHardStopBanner(msg.reason);
    if (msg.sessionActionCount !== undefined) {
      updateSessionStats({
        sessionActionCount: msg.sessionActionCount,
        consecutiveErrors: msg.consecutiveErrors || 0,
      });
    }
  }

  if (msg.action === 'QUEUE_DONE') {
    hideConfirmPanel();
    setStatus('🎉 Hoàn thành!');
    toggleButtons('idle');
  }

  if (msg.action === 'QUEUE_ERROR') {
    hideConfirmPanel();
    setStatus('❌ ' + msg.error);
    toggleButtons('idle');
  }
});

// ─── Restore state on popup open ──────────────────────────────────────────────
chrome.storage.local.get(['contacts', 'currentIndex', 'results', 'queueState'], function (data) {
  if (data.contacts && data.contacts.length > 0) {
    contacts = data.contacts;
    results = data.results || { success: 0, not_found: 0, already_friend: 0, error: 0, skipped: 0 };

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

    var done = results.success + results.not_found + results.already_friend + results.error + (results.skipped || 0);
    document.getElementById('progress-text').textContent = done + ' / ' + contacts.length;

    renderPhoneList();

    var state = data.queueState;
    if (state === 'running') {
      toggleButtons('running');
      setStatus('▶ Đang chạy...');
      showSessionStats();
    } else if (state === 'paused') {
      toggleButtons('paused');
      setStatus('⏸ Đã tạm dừng');
    } else if (state === 'awaiting_confirm') {
      // Restore confirm state — request current contact info
      setStatus('👤 Chờ xác nhận — mở popup để xem');
      toggleButtons('paused');
    }
  }
});

// Request session stats on popup open (if queue is active)
chrome.runtime.sendMessage({ action: 'GET_SESSION_STATS' }, function (response) {
  if (chrome.runtime.lastError) return; // background not available
  if (response && response.sessionActionCount > 0) {
    updateSessionStats(response);
  }
});
