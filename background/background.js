// background.js — Service Worker: Queue Manager + Safety Policy + Audit Log
// Manifest V3 Service Worker
//
// Phase 1: Bỏ auto message / image, tăng delay mặc định
// Phase 2: Hard stop policy, restriction tracking, audit log
// Phase 3: Assisted mode (prepare → operator confirm → execute)

let queueState = 'idle';
// 'idle' | 'running' | 'paused' | 'stopped' | 'awaiting_confirm'
let currentIndex = 0;
let contacts = [];
let settings = {};

// ─── Safety Policy State (Phase 2) ────────────────────────────────────────────
let consecutiveErrors = 0;
let sessionActionCount = 0;
let restrictionLog = [];

// ─── Keep-alive (prevent Service Worker từ bị kill) ───────────────────────────
chrome.alarms.create('keepAlive', { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener(function (alarm) {
  if (alarm.name === 'keepAlive') {
    chrome.storage.local.get(['queueState']);
  }
});

// ─── Message Handler ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener(function (msg, _sender, sendResponse) {
  if (msg.action === 'START_QUEUE') {
    startQueue();
  } else if (msg.action === 'PAUSE_QUEUE') {
    queueState = 'paused';
    chrome.storage.local.set({ queueState: queueState });
  } else if (msg.action === 'RESUME_QUEUE') {
    queueState = 'running';
    chrome.storage.local.set({ queueState: queueState });
    processNext();
  } else if (msg.action === 'STOP_QUEUE') {
    queueState = 'stopped';
    chrome.storage.local.set({ queueState: 'idle' });
  } else if (msg.action === 'CONFIRM_ADD_FRIEND') {
    // Phase 3: operator confirmed — execute add friend
    handleOperatorConfirm();
  } else if (msg.action === 'SKIP_CONTACT') {
    // Phase 3: operator skipped — close modal, move to next
    handleSkipContact();
  } else if (msg.action === 'GET_SESSION_STATS') {
    // Phase 4: popup requests session stats
    sendResponse({
      sessionActionCount: sessionActionCount,
      consecutiveErrors: consecutiveErrors,
      restrictionCount: restrictionLog.length,
      sessionCap: settings.sessionCap || 30,
    });
    return false;
  }
  sendResponse({ ok: true });
  return false;
});

// ─── Start Queue ──────────────────────────────────────────────────────────────
async function startQueue() {
  var data = await getStorage(['contacts', 'currentIndex', 'results']);
  contacts = data.contacts || [];
  currentIndex = data.currentIndex || 0;
  settings = await getSettings();

  if (!contacts.length) return;

  // Reset session safety counters
  consecutiveErrors = 0;
  sessionActionCount = 0;
  restrictionLog = [];

  queueState = 'running';
  chrome.storage.local.set({ queueState: 'running' });

  processNext();
}

let isProcessing = false;

// ─── Process Next SĐT ─────────────────────────────────────────────────────────
async function processNext() {
  if (queueState !== 'running') return;

  if (isProcessing) return;
  isProcessing = true;

  try {
    var data = await getStorage(['contacts', 'currentIndex', 'results']);
    contacts = data.contacts || [];
    currentIndex = data.currentIndex || 0;
    var results = data.results || { success: 0, not_found: 0, already_friend: 0, error: 0, skipped: 0 };
    settings = await getSettings();

    if (currentIndex >= contacts.length) {
      queueState = 'idle';
      chrome.storage.local.set({ queueState: 'idle' });
      broadcastToPopup({ action: 'QUEUE_DONE' });
      return;
    }

    // ── Phase 2: Session cap check ──
    var sessionCap = settings.sessionCap || 30;
    if (sessionActionCount >= sessionCap) {
      triggerHardStop('Đã đạt giới hạn ' + sessionCap + ' actions/phiên. Hãy nghỉ rồi bắt đầu phiên mới.');
      return;
    }

    var contact = contacts[currentIndex];

    broadcastToPopup({
      action: 'PROGRESS_UPDATE',
      index: currentIndex,
      status: 'running',
      total: contacts.length,
      sessionActionCount: sessionActionCount,
      consecutiveErrors: consecutiveErrors,
      sessionCap: settings.sessionCap || 30,
    });

    // Find Zalo tab
    var zaloTab = await getZaloTab();
    if (!zaloTab) {
      broadcastToPopup({ action: 'QUEUE_ERROR', error: 'Không tìm thấy tab chat.zalo.me. Hãy mở Zalo Web trước.' });
      queueState = 'idle';
      chrome.storage.local.set({ queueState: 'idle' });
      return;
    }

    // ── Phase 3: Branch by operation mode ──
    if (settings.operationMode === 'assisted') {
      await processNextAssisted(zaloTab, contact, results);
    } else {
      await processNextAuto(zaloTab, contact, results);
    }

  } finally {
    isProcessing = false;
  }
}

// ─── Auto Mode Processing ─────────────────────────────────────────────────────
async function processNextAuto(zaloTab, contact, results) {
  var result = { status: 'error', zaloName: '', errorMsg: '', restrictionSignals: [] };
  try {
    var contentResult = await chrome.tabs.sendMessage(zaloTab.id, {
      action: 'ADD_FRIEND',
      phone: contact.phone,
      greeting: settings.greeting,
    });
    if (!contentResult) throw new Error('Content script không phản hồi. Hãy tải lại (F5) tab Zalo.');
    result = contentResult;
  } catch (err) {
    result.status = 'error';
    result.errorMsg = String(err.message || err);
    if (result.errorMsg.includes('Receiving end does not exist')) {
      result.errorMsg += ' (Bạn chưa F5 tải lại tab Zalo).';
    }
  }

  await finalizeContact(contact, result, results);
}

// ─── Assisted Mode Processing ─────────────────────────────────────────────────
async function processNextAssisted(zaloTab, contact, results) {
  var result = { status: 'error', zaloName: '', errorMsg: '', restrictionSignals: [] };
  try {
    var contentResult = await chrome.tabs.sendMessage(zaloTab.id, {
      action: 'PREPARE_ADD_FRIEND',
      phone: contact.phone,
    });
    if (!contentResult) throw new Error('Content script không phản hồi. Hãy tải lại (F5) tab Zalo.');
    result = contentResult;
  } catch (err) {
    result.status = 'error';
    result.errorMsg = String(err.message || err);
    if (result.errorMsg.includes('Receiving end does not exist')) {
      result.errorMsg += ' (Bạn chưa F5 tải lại tab Zalo).';
    }
  }

  // Nếu profile đã sẵn sàng cho confirm — dừng queue, chờ operator
  if (result.status === 'ready_for_confirm') {
    queueState = 'awaiting_confirm';
    chrome.storage.local.set({ queueState: 'awaiting_confirm' });
    broadcastToPopup({
      action: 'AWAITING_CONFIRM',
      index: currentIndex,
      zaloName: result.zaloName,
      phone: contact.phone,
      restrictionSignals: result.restrictionSignals || [],
    });
    return; // Không schedule processNext — chờ operator
  }

  // Các status khác (not_found, already_friend, error) → finalize ngay
  await finalizeContact(contact, result, results);
}

// ─── Operator Confirm Handler (Phase 3) ───────────────────────────────────────
async function handleOperatorConfirm() {
  if (queueState !== 'awaiting_confirm') return;

  var zaloTab = await getZaloTab();
  if (!zaloTab) {
    broadcastToPopup({ action: 'QUEUE_ERROR', error: 'Không tìm thấy tab Zalo.' });
    return;
  }

  settings = await getSettings();

  var result = { status: 'error', zaloName: '', errorMsg: '', restrictionSignals: [] };
  try {
    var contentResult = await chrome.tabs.sendMessage(zaloTab.id, {
      action: 'EXECUTE_ADD_FRIEND',
      greeting: settings.greeting,
    });
    if (!contentResult) throw new Error('Content script không phản hồi.');
    result = contentResult;
  } catch (err) {
    result.status = 'error';
    result.errorMsg = String(err.message || err);
  }

  var data = await getStorage(['contacts', 'currentIndex', 'results']);
  contacts = data.contacts || [];
  currentIndex = data.currentIndex || 0;
  var results = data.results || { success: 0, not_found: 0, already_friend: 0, error: 0, skipped: 0 };
  var contact = contacts[currentIndex] || {};

  await finalizeContact(contact, result, results);
}

// ─── Skip Contact Handler (Phase 3) ──────────────────────────────────────────
async function handleSkipContact() {
  if (queueState !== 'awaiting_confirm') return;

  var zaloTab = await getZaloTab();
  if (zaloTab) {
    try {
      await chrome.tabs.sendMessage(zaloTab.id, { action: 'CLOSE_MODAL' });
    } catch (_) {}
  }

  var data = await getStorage(['contacts', 'currentIndex', 'results']);
  contacts = data.contacts || [];
  currentIndex = data.currentIndex || 0;
  var results = data.results || { success: 0, not_found: 0, already_friend: 0, error: 0, skipped: 0 };
  var contact = contacts[currentIndex] || {};

  var result = { status: 'skipped', zaloName: '', errorMsg: '', restrictionSignals: [] };
  await finalizeContact(contact, result, results);
}

// ─── Finalize Contact: Update State + Safety Check + Schedule Next ─────────────
async function finalizeContact(contact, result, results) {
  // ── Update contact status ──
  contacts[currentIndex].status = result.status;
  contacts[currentIndex].zaloName = result.zaloName || '';
  if (result.status === 'error') {
    contacts[currentIndex].errorMsg = result.errorMsg;
  } else {
    delete contacts[currentIndex].errorMsg;
  }
  results[result.status] = (results[result.status] || 0) + 1;

  // ── Phase 2: Safety tracking ──
  if (result.status === 'error') {
    consecutiveErrors++;
  } else {
    consecutiveErrors = 0;
  }
  sessionActionCount++;

  if (result.restrictionSignals && result.restrictionSignals.length > 0) {
    restrictionLog.push.apply(restrictionLog, result.restrictionSignals);
  }

  // ── Phase 2: Audit log ──
  await appendAuditLog({
    action: settings.operationMode === 'assisted' ? 'ASSISTED_ADD_FRIEND' : 'AUTO_ADD_FRIEND',
    phone: contact.phone || '',
    status: result.status,
    zaloName: result.zaloName || '',
    errorMsg: result.errorMsg || '',
    restrictionSignals: result.restrictionSignals || [],
    consecutiveErrors: consecutiveErrors,
    sessionActionCount: sessionActionCount,
    campaignLabel: settings.campaignLabel || '',
  });

  // ── Save state ──
  await chrome.storage.local.set({
    contacts: contacts,
    currentIndex: currentIndex + 1,
    results: results,
  });

  // ── Notify popup ──
  broadcastToPopup({
    action: 'PROGRESS_UPDATE',
    index: currentIndex,
    status: result.status,
    errorMsg: result.errorMsg,
    zaloName: result.zaloName,
    total: contacts.length,
    sessionActionCount: sessionActionCount,
    consecutiveErrors: consecutiveErrors,
    sessionCap: settings.sessionCap || 30,
  });

  // ── Phase 2: Hard stop check ──
  var maxConsecutiveErrors = settings.maxConsecutiveErrors || 3;

  if (consecutiveErrors >= maxConsecutiveErrors) {
    triggerHardStop(consecutiveErrors + ' lỗi liên tiếp — có thể Zalo đang hạn chế tài khoản');
    return;
  }

  if (result.restrictionSignals && result.restrictionSignals.length > 0) {
    triggerHardStop('Phát hiện tín hiệu restriction từ Zalo: ' + result.restrictionSignals[0].type);
    return;
  }

  // ── Schedule next ──
  var nextIdx = currentIndex + 1;
  if (nextIdx >= contacts.length) {
    queueState = 'idle';
    chrome.storage.local.set({ queueState: 'idle' });
    broadcastToPopup({ action: 'QUEUE_DONE' });
    return;
  }

  var waitMs = randomDelay(settings.delayMin * 1000, settings.delayMax * 1000);

  if (nextIdx % settings.batchSize === 0 && nextIdx < contacts.length) {
    waitMs = settings.batchRest * 1000;
    broadcastToPopup({ action: 'PROGRESS_UPDATE', index: nextIdx, status: 'resting', total: contacts.length });
  }

  queueState = 'running';
  chrome.storage.local.set({ queueState: 'running' });

  setTimeout(function () {
    if (queueState === 'running') processNext();
  }, waitMs);
}

// ─── Hard Stop (Phase 2) ──────────────────────────────────────────────────────
function triggerHardStop(reason) {
  queueState = 'stopped';
  chrome.storage.local.set({ queueState: 'idle' });

  appendAuditLog({
    action: 'HARD_STOP',
    phone: '',
    status: 'hard_stop',
    zaloName: '',
    errorMsg: reason,
    restrictionSignals: restrictionLog.slice(-5),
    consecutiveErrors: consecutiveErrors,
    sessionActionCount: sessionActionCount,
    campaignLabel: settings.campaignLabel || '',
  });

  broadcastToPopup({
    action: 'HARD_STOP',
    reason: reason,
    restrictionLog: restrictionLog.slice(-10),
    sessionActionCount: sessionActionCount,
    consecutiveErrors: consecutiveErrors,
  });
}

// ─── Audit Log (Phase 2) ──────────────────────────────────────────────────────
async function appendAuditLog(entry) {
  var data = await getStorage(['auditLog']);
  var log = data.auditLog || [];
  log.push({
    timestamp: new Date().toISOString(),
    action: entry.action,
    phone: entry.phone,
    status: entry.status,
    zaloName: entry.zaloName || '',
    errorMsg: entry.errorMsg || '',
    restrictionSignals: entry.restrictionSignals || [],
    consecutiveErrors: entry.consecutiveErrors || 0,
    sessionActionCount: entry.sessionActionCount || 0,
    campaignLabel: entry.campaignLabel || '',
  });
  // Giữ tối đa 1000 entries gần nhất
  if (log.length > 1000) log.splice(0, log.length - 1000);
  await chrome.storage.local.set({ auditLog: log });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getStorage(keys) {
  return new Promise(function (resolve) { chrome.storage.local.get(keys, resolve); });
}

function getSettings() {
  return new Promise(function (resolve) {
    chrome.storage.sync.get({
      greeting: 'Xin chào, mình tìm thấy bạn qua số điện thoại. Kết bạn với mình nhé!',
      // Phase 1.3: Tăng delay mặc định
      delayMin: 15,
      delayMax: 45,
      batchSize: 5,
      batchRest: 300,
      // Phase 3: Operation mode
      operationMode: 'assisted',
      // Phase 4: Policy config
      sessionCap: 30,
      maxConsecutiveErrors: 3,
      campaignLabel: '',
    }, resolve);
  });
}

async function getZaloTab() {
  var tabs = await chrome.tabs.query({ url: 'https://chat.zalo.me/*' });
  return tabs.length > 0 ? tabs[0] : null;
}

function broadcastToPopup(msg) {
  chrome.runtime.sendMessage(msg).catch(function () {
    // Popup might be closed — ignore
  });
}
