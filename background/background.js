// background.js — Service Worker: Queue Manager + Keep-alive
// Manifest V3 Service Worker

importScripts('../lib/image-store.js');

let queueState = 'idle'; // 'idle' | 'running' | 'paused' | 'stopped'
let currentIndex = 0;
let contacts = [];
let settings = {};
const imageStore = self.ZaloImageStore;

// ─── Keep-alive (prevent Service Worker từ bị kill) ───────────────────────────
chrome.alarms.create('keepAlive', { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive') {
    // Chỉ cần gọi 1 API bất kỳ của Chrome để đánh thức (wake up) Service Worker
    // và reset bộ đếm thời gian idle 30s của browser.
    // KHÔNG gọi lại processNext() ở đây để tránh đẻ thread song song (Race Condition).
    chrome.storage.local.get(['queueState']);
  }
});

// ─── Message Handler ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'START_QUEUE') {
    startQueue();
  } else if (msg.action === 'PAUSE_QUEUE') {
    queueState = 'paused';
    chrome.storage.local.set({ queueState });
  } else if (msg.action === 'RESUME_QUEUE') {
    queueState = 'running';
    chrome.storage.local.set({ queueState });
    processNext();
  } else if (msg.action === 'STOP_QUEUE') {
    queueState = 'stopped';
    chrome.storage.local.set({ queueState: 'idle' });
  }
  sendResponse({ ok: true });
  return false;
});

// ─── Start Queue ──────────────────────────────────────────────────────────────
async function startQueue() {
  const data = await getStorage(['contacts', 'currentIndex', 'results']);
  contacts    = data.contacts || [];
  currentIndex = data.currentIndex || 0;
  settings    = await getSettings();

  if (!contacts.length) return;

  queueState = 'running';
  chrome.storage.local.set({ queueState: 'running' });

  processNext();
}

let isProcessing = false;

// ─── Process Next SĐT ─────────────────────────────────────────────────────────
async function processNext() {
  if (queueState !== 'running') return;
  
  // Khóa (lock) để chống chạy song song trong mọi rủi ro
  if (isProcessing) return;
  isProcessing = true;

  try {
    const data = await getStorage(['contacts', 'currentIndex', 'results']);
    contacts    = data.contacts || [];
    currentIndex = data.currentIndex || 0;
    const results = data.results || { success: 0, not_found: 0, already_friend: 0, error: 0 };
    settings    = await getSettings();

    if (currentIndex >= contacts.length) {
      // Done
      queueState = 'idle';
      chrome.storage.local.set({ queueState: 'idle' });
      broadcastToPopup({ action: 'QUEUE_DONE' });
      return;
    }

    const contact = contacts[currentIndex];

    // Notify popup: item is running
    broadcastToPopup({ action: 'PROGRESS_UPDATE', index: currentIndex, status: 'running', total: contacts.length });

    // Find Zalo tab
    const zaloTab = await getZaloTab();
    if (!zaloTab) {
      broadcastToPopup({ action: 'QUEUE_ERROR', error: 'Không tìm thấy tab chat.zalo.me. Hãy mở Zalo Web trước.' });
      queueState = 'idle';
      chrome.storage.local.set({ queueState: 'idle' });
      return;
    }

    // Send to content script
    let result = { status: 'error', zaloName: '', errorMsg: '', message: '', messageError: '' };
    try {
      const imageResolution = settings.autoMessagesEnabled
        ? await resolveAutoMessageImage()
        : { imageData: null, messageError: '' };

      const contentResult = await chrome.tabs.sendMessage(zaloTab.id, {
        action: 'ADD_FRIEND',
        phone: contact.phone,
        greeting: settings.greeting,
        autoMessages: settings.autoMessagesEnabled ? (settings.autoMessages || []) : [],
        autoMessageImage: imageResolution.imageData,
      });
      if (!contentResult) throw new Error("Content script không phản hồi. Hãy tải lại (F5) tab Zalo.");
      result = contentResult;

      if (imageResolution.messageError && result.status !== 'error') {
        result.messageError = mergeMessageError(result.messageError, imageResolution.messageError);
      }
    } catch (err) {
      result.status = 'error';
      result.errorMsg = String(err.message || err);
      // Nếu có chứa "Receiving end does not exist" -> chưa inject content.js
      if (result.errorMsg.includes('Receiving end does not exist')) {
        result.errorMsg += ' (Bạn chưa F5 tải lại tab Zalo).';
      }
    }

    // Update contacts status
    contacts[currentIndex].status = result.status;
    if (result.status === 'error') {
      contacts[currentIndex].errorMsg = result.errorMsg; // Save err in array
    } else {
      delete contacts[currentIndex].errorMsg;
    }
    if (result.messageError) {
      contacts[currentIndex].messageError = result.messageError;
    } else {
      delete contacts[currentIndex].messageError;
    }
    results[result.status] = (results[result.status] || 0) + 1;

    // Save state
    await chrome.storage.local.set({
      contacts,
      currentIndex: currentIndex + 1,
      results,
    });

    // Notify popup: item done
    broadcastToPopup({
      action: 'PROGRESS_UPDATE',
      index: currentIndex,
      status: result.status,
      errorMsg: result.errorMsg,
      total: contacts.length,
    });

    // Long rest after batchSize items
    const nextIdx = currentIndex + 1;
    let waitMs = randomDelay(settings.delayMin * 1000, settings.delayMax * 1000);

    if (nextIdx % settings.batchSize === 0 && nextIdx < contacts.length) {
      waitMs = settings.batchRest * 1000;
      broadcastToPopup({ action: 'PROGRESS_UPDATE', index: nextIdx, status: 'resting', total: contacts.length });
    }

    // Schedule next
    setTimeout(() => {
      if (queueState === 'running') processNext();
    }, waitMs);
  } finally {
    isProcessing = false;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getStorage(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

function getSettings() {
  return new Promise(resolve =>
    chrome.storage.sync.get({
      greeting: 'Xin chào, mình tìm thấy bạn qua số điện thoại. Kết bạn với mình nhé!',
      delayMin: 3,
      delayMax: 8,
      batchSize: 10,
      batchRest: 90,
      backendUrl: 'http://localhost:3000',
      apiKey: 'zalo-tool-secret-2026',
      autoMessagesEnabled: false,
      autoMessages: [],
    }, resolve)
  );
}

async function getZaloTab() {
  const tabs = await chrome.tabs.query({ url: 'https://chat.zalo.me/*' });
  return tabs.length > 0 ? tabs[0] : null;
}

function broadcastToPopup(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {
    // Popup might be closed — ignore
  });
}

function mergeMessageError(currentMessage, nextMessage) {
  if (!currentMessage) return nextMessage || '';
  if (!nextMessage || currentMessage.includes(nextMessage)) return currentMessage;
  return `${currentMessage} | ${nextMessage}`;
}

async function resolveAutoMessageImage() {
  const localData = await getStorage(['autoMessageImageRef']);
  const imageRef = localData.autoMessageImageRef;

  if (!imageRef || !imageRef.imageId) {
    return { imageData: null, messageError: '' };
  }

  try {
    const record = await imageStore.getAutoMessageImage(imageRef.imageId);

    if (!record || !record.blob) {
      return {
        imageData: null,
        messageError: 'Không tìm thấy ảnh auto-message đã lưu. Vui lòng chọn lại ảnh trong Cài đặt.',
      };
    }

    return {
      imageData: {
        name: record.name || imageRef.name || 'image.png',
        mimeType: record.mimeType || imageRef.mimeType || 'image/png',
        bytes: await blobToByteArray(record.blob),
      },
      messageError: '',
    };
  } catch (err) {
    return {
      imageData: null,
      messageError: `Không thể tải ảnh auto-message: ${String(err.message || err)}`,
    };
  }
}

async function blobToByteArray(blob) {
  const buffer = await blob.arrayBuffer();
  return Array.from(new Uint8Array(buffer));
}

// async function postLog(logData, cfg) {
//   if (!cfg.backendUrl) return;
//   try {
//     await fetch(`${cfg.backendUrl}/api/logs`, {
//       method: 'POST',
//       headers: {
//         'Content-Type': 'application/json',
//         'x-api-key': cfg.apiKey,
//       },
//       body: JSON.stringify(logData),
//     });
//   } catch (err) {
//     console.warn('[ZaloExt] Failed to post log:', err.message);
//   }
// }
