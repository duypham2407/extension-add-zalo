const DEFAULT_SETTINGS = {
  greeting: 'Xin chào, mình tìm thấy bạn qua số điện thoại. Kết bạn với mình nhé!',
  delayMin: 3,
  delayMax: 8,
  batchSize: 10,
  batchRest: 90,
  backendUrl: 'http://localhost:3000',
  apiKey: 'zalo-tool-secret-2026',
};

function loadSettings() {
  chrome.storage.sync.get(DEFAULT_SETTINGS, (s) => {
    document.getElementById('greeting').value = s.greeting;
    document.getElementById('delay-min').value = s.delayMin;
    document.getElementById('delay-max').value = s.delayMax;
    document.getElementById('batch-size').value = s.batchSize;
    document.getElementById('batch-rest').value = s.batchRest;
    document.getElementById('backend-url').value = s.backendUrl;
    document.getElementById('api-key').value = s.apiKey;
    updateCharCount(s.greeting.length);
  });
}

function updateCharCount(len) {
  document.getElementById('char-count').textContent = len;
}

document.getElementById('greeting').addEventListener('input', (e) => {
  updateCharCount(e.target.value.length);
});

function saveSettings() {
  const settings = {
    greeting: document.getElementById('greeting').value.slice(0, 150),
    delayMin: parseInt(document.getElementById('delay-min').value, 10),
    delayMax: parseInt(document.getElementById('delay-max').value, 10),
    batchSize: parseInt(document.getElementById('batch-size').value, 10),
    batchRest: parseInt(document.getElementById('batch-rest').value, 10),
    backendUrl: document.getElementById('backend-url').value.trim(),
    apiKey: document.getElementById('api-key').value.trim(),
  };

  if (settings.delayMin >= settings.delayMax) {
    alert('Delay tối thiểu phải nhỏ hơn tối đa!');
    return;
  }

  chrome.storage.sync.set(settings, () => {
    const msg = document.getElementById('save-msg');
    msg.textContent = '✅ Đã lưu!';
    setTimeout(() => { msg.textContent = ''; }, 2000);
  });
}

async function testConnection() {
  const url = document.getElementById('backend-url').value.trim();
  const key = document.getElementById('api-key').value.trim();
  const result = document.getElementById('test-result');
  result.textContent = '⏳ Đang kiểm tra...';
  result.className = '';

  try {
    const res = await fetch(`${url}/health`);
    if (res.ok) {
      result.textContent = '✅ Kết nối thành công!';
    } else {
      result.textContent = `❌ Lỗi ${res.status}`;
      result.className = 'error';
    }
  } catch (e) {
    result.textContent = '❌ Không kết nối được. Kiểm tra URL và server.';
    result.className = 'error';
  }
}

document.getElementById('save-btn').addEventListener('click', saveSettings);
document.getElementById('test-btn').addEventListener('click', testConnection);

loadSettings();
