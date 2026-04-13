// settings.js — Cài đặt Extension
// Phase 1.3: Updated defaults (safer pacing)
// Phase 1.4: Auto-message UI hidden, image-store removed
// Phase 4: Safety policy fields (operationMode, sessionCap, maxConsecutiveErrors, campaignLabel)

var DEFAULT_SETTINGS = {
  greeting: 'Xin chào, mình tìm thấy bạn qua số điện thoại. Kết bạn với mình nhé!',
  delayMin: 15,
  delayMax: 45,
  batchSize: 5,
  batchRest: 300,
  backendUrl: 'http://localhost:3000',
  apiKey: 'zalo-tool-secret-2026',
  // Phase 1: Auto-message disabled — kept for schema compat but unused
  autoMessagesEnabled: false,
  autoMessages: [],
  // Phase 3-4: Safety policy
  operationMode: 'assisted',
  sessionCap: 30,
  maxConsecutiveErrors: 3,
  campaignLabel: '',
};

// ─── Load Settings ────────────────────────────────────────────────────────────
function loadSettings() {
  getSyncStorage(DEFAULT_SETTINGS).then(function (s) {
    document.getElementById('greeting').value = s.greeting;
    document.getElementById('delay-min').value = s.delayMin;
    document.getElementById('delay-max').value = s.delayMax;
    document.getElementById('batch-size').value = s.batchSize;
    document.getElementById('batch-rest').value = s.batchRest;
    document.getElementById('backend-url').value = s.backendUrl;
    document.getElementById('api-key').value = s.apiKey;
    updateCharCount(s.greeting.length);

    // Safety policy fields
    document.getElementById('operation-mode').value = s.operationMode || 'assisted';
    document.getElementById('session-cap').value = s.sessionCap || 30;
    document.getElementById('max-consecutive-errors').value = s.maxConsecutiveErrors || 3;
    document.getElementById('campaign-label').value = s.campaignLabel || '';
  }).catch(function (err) {
    console.error('[ZaloExt] Failed to load settings:', err);
  });
}

function updateCharCount(len) {
  document.getElementById('char-count').textContent = len;
}

document.getElementById('greeting').addEventListener('input', function (e) {
  updateCharCount(e.target.value.length);
});

// ─── Save Settings ────────────────────────────────────────────────────────────
function saveSettings() {
  var delayMin = parseInt(document.getElementById('delay-min').value, 10);
  var delayMax = parseInt(document.getElementById('delay-max').value, 10);

  if (delayMin >= delayMax) {
    alert('Delay tối thiểu phải nhỏ hơn tối đa!');
    return;
  }

  var settings = {
    greeting: document.getElementById('greeting').value.slice(0, 150),
    delayMin: delayMin,
    delayMax: delayMax,
    batchSize: parseInt(document.getElementById('batch-size').value, 10),
    batchRest: parseInt(document.getElementById('batch-rest').value, 10),
    backendUrl: document.getElementById('backend-url').value.trim(),
    apiKey: document.getElementById('api-key').value.trim(),
    // Auto-message stays disabled — save as false to keep schema compat
    autoMessagesEnabled: false,
    autoMessages: [],
    // Safety policy
    operationMode: document.getElementById('operation-mode').value,
    sessionCap: parseInt(document.getElementById('session-cap').value, 10) || 30,
    maxConsecutiveErrors: parseInt(document.getElementById('max-consecutive-errors').value, 10) || 3,
    campaignLabel: document.getElementById('campaign-label').value.trim(),
  };

  chrome.storage.sync.set(settings, function () {
    var msg = document.getElementById('save-msg');
    msg.textContent = '✅ Đã lưu!';
    setTimeout(function () { msg.textContent = ''; }, 2000);
  });
}

// ─── Test Connection ──────────────────────────────────────────────────────────
function testConnection() {
  var url = document.getElementById('backend-url').value.trim();
  var result = document.getElementById('test-result');
  result.textContent = '⏳ Đang kiểm tra...';
  result.className = '';
  fetch(url + '/health')
    .then(function (res) {
      if (res.ok) {
        result.textContent = '✅ Kết nối thành công!';
      } else {
        result.textContent = '❌ Lỗi ' + res.status;
        result.className = 'error';
      }
    })
    .catch(function () {
      result.textContent = '❌ Không kết nối được.';
      result.className = 'error';
    });
}

// ─── Event Listeners ──────────────────────────────────────────────────────────
document.getElementById('save-btn').addEventListener('click', saveSettings);
document.getElementById('test-btn').addEventListener('click', testConnection);

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getSyncStorage(defaults) {
  return new Promise(function (resolve) {
    chrome.storage.sync.get(defaults, resolve);
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────
loadSettings();
