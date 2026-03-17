const DEFAULT_SETTINGS = {
  greeting: 'Xin chào, mình tìm thấy bạn qua số điện thoại. Kết bạn với mình nhé!',
  delayMin: 3,
  delayMax: 8,
  batchSize: 10,
  batchRest: 90,
  backendUrl: 'http://localhost:3000',
  apiKey: 'zalo-tool-secret-2026',
  autoMessagesEnabled: false,
  autoMessages: [],
};

// ─── Load Settings ────────────────────────────────────────────────────────────
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

    // Auto-message
    document.getElementById('auto-msg-enabled').checked = !!s.autoMessagesEnabled;
    renderMsgList(s.autoMessages || []);
  });

  // Load image từ local storage (có thể lớn, dùng local chứ không dùng sync)
  chrome.storage.local.get(['autoMessageImage'], (d) => {
    if (d.autoMessageImage && d.autoMessageImage.base64) {
      showImgPreview(`data:${d.autoMessageImage.mimeType};base64,${d.autoMessageImage.base64}`);
    }
  });
}

function updateCharCount(len) {
  document.getElementById('char-count').textContent = len;
}

document.getElementById('greeting').addEventListener('input', (e) => {
  updateCharCount(e.target.value.length);
});

// ─── Save Settings ────────────────────────────────────────────────────────────
function saveSettings() {
  const settings = {
    greeting: document.getElementById('greeting').value.slice(0, 150),
    delayMin: parseInt(document.getElementById('delay-min').value, 10),
    delayMax: parseInt(document.getElementById('delay-max').value, 10),
    batchSize: parseInt(document.getElementById('batch-size').value, 10),
    batchRest: parseInt(document.getElementById('batch-rest').value, 10),
    backendUrl: document.getElementById('backend-url').value.trim(),
    apiKey: document.getElementById('api-key').value.trim(),
    autoMessagesEnabled: document.getElementById('auto-msg-enabled').checked,
    autoMessages: collectMsgList(),
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

// ─── Auto Message List ────────────────────────────────────────────────────────

/**
 * Render danh sách tin nhắn từ mảng { text, delay }
 */
function renderMsgList(messages) {
  const list = document.getElementById('msg-list');
  list.innerHTML = '';
  if (!messages.length) return;
  messages.forEach((msg, i) => addMsgItem(msg.text, msg.delay, i));
}

/**
 * Thêm 1 item tin nhắn vào list (DOM)
 */
function addMsgItem(text = '', delayVal = 1) {
  const list = document.getElementById('msg-list');
  const index = list.children.length;

  const item = document.createElement('div');
  item.className = 'msg-item';
  item.dataset.index = index;
  item.innerHTML = `
    <div class="msg-item-header">
      <span class="msg-order">Tin nhắn ${index + 1}</span>
      <button class="btn-remove-msg" title="Xóa">✕</button>
    </div>
    <textarea class="msg-text" rows="2" maxlength="500" placeholder="Nội dung tin nhắn...">${escapeHtml(text)}</textarea>
    <div class="msg-delay-row">
      <label>Delay trước khi gửi</label>
      <div class="delay-input-wrap">
        <input type="number" class="msg-delay" min="0" max="300" value="${delayVal}" />
        <span class="delay-unit">giây</span>
      </div>
    </div>
  `;

  item.querySelector('.btn-remove-msg').addEventListener('click', () => {
    item.remove();
    reorderItems();
  });

  list.appendChild(item);
}

/**
 * Cập nhật lại chỉ số "Tin nhắn X" sau khi remove
 */
function reorderItems() {
  const items = document.querySelectorAll('.msg-item');
  items.forEach((el, i) => {
    el.querySelector('.msg-order').textContent = `Tin nhắn ${i + 1}`;
  });
}

/**
 * Thu thập dữ liệu hiện tại từ DOM list
 */
function collectMsgList() {
  const items = document.querySelectorAll('.msg-item');
  return Array.from(items).map(el => ({
    text: el.querySelector('.msg-text').value.trim(),
    delay: parseInt(el.querySelector('.msg-delay').value, 10) || 1,
  })).filter(m => m.text);
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

document.getElementById('btn-add-msg').addEventListener('click', () => {
  addMsgItem();
});

// ─── Image Upload ───────────────────────────────────────────────────────────

document.getElementById('img-file-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (ev) => {
    const dataUrl = ev.target.result; // data:image/png;base64,...
    const [header, base64] = dataUrl.split(',');
    const mimeType = header.match(/:(.*?);/)[1];

    // Lưu vào chrome.storage.local (không dùng sync vì quá lớn)
    chrome.storage.local.set({
      autoMessageImage: { base64, mimeType, name: file.name },
    }, () => {
      showImgPreview(dataUrl);
    });
  };
  reader.readAsDataURL(file);
});

function showImgPreview(dataUrl) {
  const wrap = document.getElementById('img-preview-wrap');
  const img = document.getElementById('img-preview');
  const label = document.getElementById('img-upload-label');
  img.src = dataUrl;
  wrap.style.display = 'flex';
  label.style.display = 'none';
}

document.getElementById('btn-remove-img').addEventListener('click', () => {
  chrome.storage.local.remove(['autoMessageImage'], () => {
    document.getElementById('img-preview').src = '';
    document.getElementById('img-preview-wrap').style.display = 'none';
    document.getElementById('img-upload-label').style.display = 'flex';
    document.getElementById('img-file-input').value = '';
  });
});

// ─── Test Connection ──────────────────────────────────────────────────────────
async function testConnection() {
  const url = document.getElementById('backend-url').value.trim();
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
    result.textContent = '❌ Không kết nối được.';
    result.className = 'error';
  }
}

document.getElementById('save-btn').addEventListener('click', saveSettings);
document.getElementById('test-btn').addEventListener('click', testConnection);

loadSettings();
