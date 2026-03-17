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
const imageStore = window.ZaloImageStore;
const AUTO_MESSAGE_IMAGE_ID = imageStore.AUTO_MESSAGE_IMAGE_ID;
let currentPreviewUrl = '';

// ─── Load Settings ────────────────────────────────────────────────────────────
async function loadSettings() {
  const s = await getSyncStorage(DEFAULT_SETTINGS);
  document.getElementById('greeting').value = s.greeting;
  document.getElementById('delay-min').value = s.delayMin;
  document.getElementById('delay-max').value = s.delayMax;
  document.getElementById('batch-size').value = s.batchSize;
  document.getElementById('batch-rest').value = s.batchRest;
  document.getElementById('backend-url').value = s.backendUrl;
  document.getElementById('api-key').value = s.apiKey;
  updateCharCount(s.greeting.length);

  document.getElementById('auto-msg-enabled').checked = !!s.autoMessagesEnabled;
  renderMsgList(s.autoMessages || []);

  await migrateLegacyAutoMessageImage();
  await loadImagePreview();
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

document.getElementById('img-file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const record = await imageStore.saveAutoMessageImage(file, {
      imageId: AUTO_MESSAGE_IMAGE_ID,
      name: file.name,
      mimeType: file.type || 'image/png',
    });

    await setLocalStorage({
      autoMessageImageRef: createImageRef(record),
    });
    await removeLocalStorage(['autoMessageImage']);
    showImgPreview(URL.createObjectURL(record.blob));
  } catch (err) {
    alert(`Không thể lưu ảnh: ${String(err.message || err)}`);
    clearImgInput();
  }
});

function showImgPreview(imageUrl) {
  revokePreviewUrl();
  const wrap = document.getElementById('img-preview-wrap');
  const img = document.getElementById('img-preview');
  const label = document.getElementById('img-upload-label');
  currentPreviewUrl = imageUrl;
  img.src = imageUrl;
  wrap.style.display = 'flex';
  label.style.display = 'none';
}

document.getElementById('btn-remove-img').addEventListener('click', async () => {
  try {
    await imageStore.deleteAutoMessageImage(AUTO_MESSAGE_IMAGE_ID);
  } catch (_) {}

  await removeLocalStorage(['autoMessageImageRef', 'autoMessageImage']);
  clearImgPreview();
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

loadSettings().catch((err) => {
  console.error('[ZaloExt] Failed to load settings:', err);
});

function getSyncStorage(defaults) {
  return new Promise(resolve => chrome.storage.sync.get(defaults, resolve));
}

function getLocalStorage(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

function setLocalStorage(items) {
  return new Promise(resolve => chrome.storage.local.set(items, resolve));
}

function removeLocalStorage(keys) {
  return new Promise(resolve => chrome.storage.local.remove(keys, resolve));
}

function createImageRef(record) {
  return {
    imageId: record.id,
    name: record.name,
    mimeType: record.mimeType,
    updatedAt: record.updatedAt,
  };
}

async function loadImagePreview() {
  const localData = await getLocalStorage(['autoMessageImageRef']);
  const imageRef = localData.autoMessageImageRef;

  if (!imageRef || !imageRef.imageId) {
    clearImgPreview();
    return;
  }

  try {
    const record = await imageStore.getAutoMessageImage(imageRef.imageId);
    if (!record || !record.blob) {
      await removeLocalStorage(['autoMessageImageRef']);
      clearImgPreview();
      return;
    }

    showImgPreview(URL.createObjectURL(record.blob));
  } catch (err) {
    console.error('[ZaloExt] Failed to load auto message image:', err);
    clearImgPreview();
  }
}

async function migrateLegacyAutoMessageImage() {
  const localData = await getLocalStorage(['autoMessageImage', 'autoMessageImageRef']);

  if (localData.autoMessageImageRef || !localData.autoMessageImage || !localData.autoMessageImage.base64) {
    return;
  }

  const legacyImage = localData.autoMessageImage;
  const mimeType = legacyImage.mimeType || 'image/png';
  const blob = base64ToBlob(legacyImage.base64, mimeType);
  const record = await imageStore.saveAutoMessageImage(blob, {
    imageId: AUTO_MESSAGE_IMAGE_ID,
    name: legacyImage.name || 'image.png',
    mimeType,
  });

  await setLocalStorage({
    autoMessageImageRef: createImageRef(record),
  });
  await removeLocalStorage(['autoMessageImage']);
}

function base64ToBlob(base64, mimeType) {
  const byteStr = atob(base64);
  const arr = new Uint8Array(byteStr.length);

  for (let i = 0; i < byteStr.length; i++) {
    arr[i] = byteStr.charCodeAt(i);
  }

  return new Blob([arr], { type: mimeType });
}

function clearImgPreview() {
  revokePreviewUrl();
  document.getElementById('img-preview').src = '';
  document.getElementById('img-preview-wrap').style.display = 'none';
  document.getElementById('img-upload-label').style.display = 'flex';
  clearImgInput();
}

function clearImgInput() {
  document.getElementById('img-file-input').value = '';
}

function revokePreviewUrl() {
  if (!currentPreviewUrl) return;
  URL.revokeObjectURL(currentPreviewUrl);
  currentPreviewUrl = '';
}
