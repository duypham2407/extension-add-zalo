// content.js — DOM interaction trên chat.zalo.me
// Chạy trong context của trang Zalo Web
//
// Phase 1: Bỏ auto message, bỏ auto image, bỏ greeting rewrite loop
// Phase 2: Thêm detectRestrictionSignals()
// Phase 3: Thêm prepareAddFriend() + executeAddFriend() cho assisted mode

(function () {
  'use strict';

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * Chờ selector xuất hiện trong DOM (Zalo là React SPA)
   */
  function waitForElement(selector, timeout = 6000) {
    return new Promise((resolve, reject) => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);

      const observer = new MutationObserver(() => {
        const found = document.querySelector(selector);
        if (found) { observer.disconnect(); resolve(found); }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => { observer.disconnect(); reject(new Error('Timeout: ' + selector)); }, timeout);
    });
  }

  /**
   * Delay ngẫu nhiên
   */
  function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  /**
   * Simulate click (đảm bảo React nhận event)
   */
  function simulateClick(el) {
    if (!el) return;
    const box = el.getBoundingClientRect();
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;

    el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: cx, clientY: cy }));
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: cx, clientY: cy }));
    el.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: cx, clientY: cy }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: cx, clientY: cy }));
    el.click();
  }

  /**
   * Set giá trị cho input/textarea React (bypass controlled component)
   */
  function setReactValue(el, value) {
    if (!el) return;
    el.focus();

    const nativeSetter = Object.getOwnPropertyDescriptor(
      window[el.tagName === 'TEXTAREA' ? 'HTMLTextAreaElement' : 'HTMLInputElement'].prototype,
      'value'
    ).set;

    nativeSetter.call(el, value);

    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Process', bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup',   { key: 'Process', bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));

    el.blur();
  }

  /**
   * Đóng modal hiện tại (nhấn Escape)
   */
  function closeModal() {
    document.body.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
  }

  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  // ─── Restriction Detection (Phase 2) ─────────────────────────────────────────

  /**
   * Quét DOM tìm dấu hiệu Zalo đang restrict/rate-limit tài khoản.
   * Trả về mảng signals — nếu rỗng nghĩa là không phát hiện gì.
   */
  function detectRestrictionSignals() {
    var signals = [];

    // 1. Toast / snackbar / notification
    var toasts = document.querySelectorAll(
      '[class*="toast"], [class*="snackbar"], [class*="notification"], [class*="alert-msg"], [class*="warning"]'
    );
    toasts.forEach(function (t) {
      var text = t.textContent.trim();
      if (text && text.length > 0 && text.length < 500) {
        signals.push({ type: 'toast', text: text, timestamp: Date.now() });
      }
    });

    // 2. Restriction / rate-limit keywords (Vietnamese + English)
    var restrictionPatterns = [
      'tạm thời', 'giới hạn', 'không thể gửi', 'thử lại sau',
      'bị hạn chế', 'bị chặn', 'quá nhiều', 'spam',
      'temporarily', 'restricted', 'limit', 'too many',
      'blocked', 'try again later', 'captcha'
    ];

    // Chỉ scan visible modal / overlay, không scan toàn bộ body (tốn)
    var overlays = document.querySelectorAll(
      '[class*="modal"], [class*="dialog"], [class*="overlay"], [class*="popup"], [role="dialog"], [role="alertdialog"]'
    );
    overlays.forEach(function (overlay) {
      if (!isVisible(overlay)) return;
      var text = overlay.innerText || '';
      var lower = text.toLowerCase();
      for (var i = 0; i < restrictionPatterns.length; i++) {
        if (lower.includes(restrictionPatterns[i])) {
          signals.push({ type: 'keyword_match', pattern: restrictionPatterns[i], context: text.slice(0, 200), timestamp: Date.now() });
          break; // 1 match per overlay đủ rồi
        }
      }
    });

    // 3. Nút Kết bạn bị disabled
    var disabledBtns = document.querySelectorAll(
      '[data-translate-inner="STR_PROFILE_ADD_FRIEND"][disabled], ' +
      '[data-translate-inner="STR_PROFILE_ADD_FRIEND"][aria-disabled="true"]'
    );
    if (disabledBtns.length > 0) {
      signals.push({ type: 'disabled_button', selector: 'STR_PROFILE_ADD_FRIEND', timestamp: Date.now() });
    }

    return signals;
  }

  // ─── Core: Search Phone + Read Profile ────────────────────────────────────────
  // Dùng chung cho cả auto mode và assisted mode

  /**
   * Mở modal "Thêm bạn", nhập SĐT, bấm tìm kiếm, chờ profile xuất hiện.
   * Trả về { found, zaloName, hasAddButton, errorMsg }
   */
  async function searchAndOpenProfile(phone) {
    var info = { found: false, zaloName: '', hasAddButton: false, errorMsg: '' };

    // Bước 1: Mở modal "Thêm bạn"
    var addFriendBtn = await waitForElement('[data-translate-title="Thêm bạn"], [title="Thêm bạn"]', 5000)
      .catch(function () { return null; });

    if (!addFriendBtn) {
      info.errorMsg = 'Không tìm thấy nút Thêm bạn trên sidebar';
      return info;
    }
    simulateClick(addFriendBtn);
    await delay(600);

    // Bước 2: Nhập số điện thoại
    var phoneInput = await waitForElement('input[placeholder="Số điện thoại"], input.phone-i-input', 4000)
      .catch(function () { return null; });

    if (!phoneInput) {
      info.errorMsg = 'Không tìm thấy input SĐT trong modal';
      closeModal();
      return info;
    }

    phoneInput.focus();
    setReactValue(phoneInput, phone);
    await delay(400);

    // Bước 3: Click "Tìm kiếm"
    var searchBtn = await waitForElement('div[data-translate-inner="STR_SEARCH"]', 3000)
      .catch(function () { return null; });

    if (!searchBtn) {
      info.errorMsg = 'Không tìm thấy nút Tìm kiếm';
      closeModal();
      return info;
    }
    simulateClick(searchBtn);

    // Bước 4: Chờ profile xuất hiện
    await delay(1500);

    var profileDetected = await Promise.race([
      waitForElement('div[data-translate-inner="STR_PROFILE_ADD_FRIEND"]', 6000).then(function () { return 'add'; }),
      waitForElement('[data-id="btn_UserProfile_EditAlias"]', 6000).then(function () { return 'profile'; }),
    ]).catch(function () { return null; });

    if (!profileDetected) {
      info.found = false;
      closeModal();
      await delay(500);
      return info;
    }

    info.found = true;

    // Bước 5: Lấy tên thực tế
    await delay(300);
    var editBtn = document.querySelector('[data-id="btn_UserProfile_EditAlias"]');
    if (editBtn && editBtn.previousElementSibling) {
      info.zaloName = editBtn.previousElementSibling.getAttribute('title') ||
                      editBtn.previousElementSibling.textContent.replace(/\u00A0/g, ' ').trim();
    }

    // Bước 6: Kiểm tra nút Kết bạn
    var ketBanBtn = document.querySelector('div[data-translate-inner="STR_PROFILE_ADD_FRIEND"]');
    info.hasAddButton = !!ketBanBtn;

    return info;
  }

  /**
   * Thực hiện bấm Kết bạn + điền lời chào + confirm.
   * Gọi sau khi profile đã mở (searchAndOpenProfile thành công).
   */
  async function performAddFriend(greeting) {
    var result = { success: false, errorMsg: '' };

    // Bấm "Kết bạn" lần 1 — mở form điền lời chào
    var ketBanBtn = document.querySelector('div[data-translate-inner="STR_PROFILE_ADD_FRIEND"]');
    if (!ketBanBtn) {
      result.errorMsg = 'Không tìm thấy nút Kết bạn';
      return result;
    }
    simulateClick(ketBanBtn);
    await delay(800);

    // Điền lời chào
    var textarea = await waitForElement('textarea[data-id="txt_AddFrd_Msg"]', 5000)
      .catch(function () { return null; });

    if (!textarea) {
      result.errorMsg = 'Không tìm thấy ô lời chào';
      return result;
    }

    var finalGreeting = greeting.slice(0, 150);
    textarea.focus();
    setReactValue(textarea, finalGreeting);

    // Phase 1.2: Chờ đủ lâu cho Zalo fetch default greeting, rồi set lại đúng 1 lần nếu cần
    await delay(1800);
    if (textarea.value !== finalGreeting) {
      console.log('[ZaloExt] Zalo overrode greeting, reverting once.');
      setReactValue(textarea, finalGreeting);
      await delay(500);
    }

    // Bấm "Kết bạn" lần 2 (confirm)
    var confirmBtn = document.querySelector('div[data-translate-inner="STR_PROFILE_ADD_FRIEND"]');
    if (!confirmBtn) {
      result.errorMsg = 'Không tìm thấy nút Kết bạn confirm';
      return result;
    }
    simulateClick(confirmBtn);
    await delay(600);

    result.success = true;
    return result;
  }

  // ─── Auto Mode: addFriend (Phase 1 — simplified, no auto message) ─────────────

  async function addFriend(phone, greeting) {
    var result = { status: 'error', zaloName: '', errorMsg: '', restrictionSignals: [] };

    try {
      var profile = await searchAndOpenProfile(phone);

      if (profile.errorMsg) {
        result.errorMsg = profile.errorMsg;
        return result;
      }

      if (!profile.found) {
        result.status = 'not_found';
        return result;
      }

      result.zaloName = profile.zaloName;

      if (!profile.hasAddButton) {
        result.status = 'already_friend';
        closeModal();
        await delay(500);
        return result;
      }

      var addResult = await performAddFriend(greeting);

      if (!addResult.success) {
        result.errorMsg = addResult.errorMsg;
        closeModal();
        return result;
      }

      result.status = 'success';
      result.message = greeting.slice(0, 150);

      // Detect restriction signals sau khi action hoàn tất
      result.restrictionSignals = detectRestrictionSignals();

      closeModal();
      await delay(400);

    } catch (err) {
      result.errorMsg = String(err.message || err);
      try { closeModal(); } catch (_) {}
    }

    return result;
  }

  // ─── Assisted Mode (Phase 3) ──────────────────────────────────────────────────

  /**
   * PREPARE: Mở profile, đọc thông tin, KHÔNG bấm kết bạn.
   * Dùng trong assisted mode — chờ operator xác nhận.
   */
  async function prepareAddFriend(phone) {
    var result = { status: 'error', zaloName: '', errorMsg: '', ready: false, restrictionSignals: [] };

    try {
      var profile = await searchAndOpenProfile(phone);

      if (profile.errorMsg) {
        result.errorMsg = profile.errorMsg;
        return result;
      }

      if (!profile.found) {
        result.status = 'not_found';
        return result;
      }

      result.zaloName = profile.zaloName;

      if (!profile.hasAddButton) {
        result.status = 'already_friend';
        closeModal();
        await delay(500);
        return result;
      }

      // KHÁC BIỆT: không bấm kết bạn, chỉ báo ready
      result.status = 'ready_for_confirm';
      result.ready = true;
      result.restrictionSignals = detectRestrictionSignals();
      // Không đóng modal — để operator thấy profile

    } catch (err) {
      result.errorMsg = String(err.message || err);
      try { closeModal(); } catch (_) {}
    }

    return result;
  }

  /**
   * EXECUTE: Bấm Kết bạn + điền lời chào + confirm.
   * Gọi sau khi operator đã xác nhận qua popup.
   */
  async function executeAddFriend(greeting) {
    var result = { status: 'error', zaloName: '', errorMsg: '', restrictionSignals: [] };

    try {
      var addResult = await performAddFriend(greeting);

      if (!addResult.success) {
        result.errorMsg = addResult.errorMsg;
        closeModal();
        return result;
      }

      result.status = 'success';
      result.message = greeting.slice(0, 150);
      result.restrictionSignals = detectRestrictionSignals();

      closeModal();
      await delay(400);

    } catch (err) {
      result.errorMsg = String(err.message || err);
      try { closeModal(); } catch (_) {}
    }

    return result;
  }

  // ─── Message Listener ─────────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener(function (msg, _sender, sendResponse) {
    // Auto mode — full add friend flow (Phase 1: no auto message)
    if (msg.action === 'ADD_FRIEND') {
      addFriend(msg.phone, msg.greeting).then(sendResponse);
      return true;
    }

    // Assisted mode — prepare only (Phase 3)
    if (msg.action === 'PREPARE_ADD_FRIEND') {
      prepareAddFriend(msg.phone).then(sendResponse);
      return true;
    }

    // Assisted mode — execute after operator confirm (Phase 3)
    if (msg.action === 'EXECUTE_ADD_FRIEND') {
      executeAddFriend(msg.greeting).then(sendResponse);
      return true;
    }

    // Close modal (used by skip / cancel)
    if (msg.action === 'CLOSE_MODAL') {
      closeModal();
      sendResponse({ ok: true });
      return false;
    }

    // On-demand restriction check
    if (msg.action === 'DETECT_RESTRICTIONS') {
      sendResponse({ signals: detectRestrictionSignals() });
      return false;
    }
  });

})();
