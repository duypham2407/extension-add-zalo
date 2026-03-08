// content.js — DOM automation trên chat.zalo.me
// Chạy trong context của trang Zalo Web

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
    
    // Trigger React's native setter
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window[el.tagName === 'TEXTAREA' ? 'HTMLTextAreaElement' : 'HTMLInputElement'].prototype,
      'value'
    ).set;
    
    nativeSetter.call(el, value);

    // Fire all necessary events
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
    document.body.click(); // Đôi khi click ra ngoài hiệu quả hơn
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
  }

  // ─── Main Automation Flow ─────────────────────────────────────────────────────

  async function addFriend(phone, greeting) {
    const result = { status: 'error', zaloName: '', errorMsg: '' };

    try {
      // ── Bước 1: Mở modal "Thêm bạn" ─────────────────────────────────────────
      // Tìm nút "Thêm bạn" trên sidebar (icon add friend)
      const addFriendBtn = await waitForElement('[data-translate-title="Thêm bạn"], [title="Thêm bạn"]', 5000)
        .catch(() => null);

      if (!addFriendBtn) {
        result.errorMsg = 'Không tìm thấy nút Thêm bạn trên sidebar';
        return result;
      }
      simulateClick(addFriendBtn);
      await delay(600);

      // ── Bước 2: Nhập số điện thoại ──────────────────────────────────────────
      const phoneInput = await waitForElement('input[placeholder="Số điện thoại"], input.phone-i-input', 4000)
        .catch(() => null);

      if (!phoneInput) {
        result.errorMsg = 'Không tìm thấy input SĐT trong modal';
        closeModal();
        return result;
      }

      phoneInput.focus();
      setReactValue(phoneInput, phone);
      await delay(400);

      // ── Bước 3: Click "Tìm kiếm" ────────────────────────────────────────────
      const searchBtn = await waitForElement('div[data-translate-inner="STR_SEARCH"]', 3000)
        .catch(() => null);

      if (!searchBtn) {
        result.errorMsg = 'Không tìm thấy nút Tìm kiếm';
        closeModal();
        return result;
      }
      simulateClick(searchBtn);

      // ── Bước 4: Chờ profile xuất hiện ────────────────────────────────────────
      // Sau khi tìm kiếm thành công, modal chuyển sang profile
      // Dấu hiệu: nút "Kết bạn" STR_PROFILE_ADD_FRIEND hoặc "Hủy kết bạn"
      await delay(1500);

      // Chờ tối đa 6s
      const profileDetected = await Promise.race([
        waitForElement('div[data-translate-inner="STR_PROFILE_ADD_FRIEND"]', 6000).then(() => 'add'),
        waitForElement('[data-id="btn_UserProfile_EditAlias"]', 6000).then(() => 'profile'),
      ]).catch(() => null);

      if (!profileDetected) {
        // Modal không chuyển → không tìm thấy
        result.status = 'not_found';
        closeModal();
        await delay(500);
        return result;
      }

      // ── Bước 5: Lấy tên thực tế từ Zalo ──────────────────────────────────────
      await delay(300);
      const editBtn = document.querySelector('[data-id="btn_UserProfile_EditAlias"]');
      if (editBtn && editBtn.previousElementSibling) {
        result.zaloName = editBtn.previousElementSibling.getAttribute('title') ||
                          editBtn.previousElementSibling.textContent.replace(/\u00A0/g, ' ').trim();
      }

      // ── Bước 6: Kiểm tra đã là bạn chưa ──────────────────────────────────────
      const ketBanBtn = document.querySelector('div[data-translate-inner="STR_PROFILE_ADD_FRIEND"]');

      if (!ketBanBtn) {
        // Không có nút Kết bạn → đã là bạn
        result.status = 'already_friend';
        closeModal();
        await delay(500);
        return result;
      }

      // ── Bước 7: Click "Kết bạn" lần 1 ────────────────────────────────────────
      simulateClick(ketBanBtn);
      await delay(800);

      // ── Bước 8: Điền lời chào ─────────────────────────────────────────────────
      const textarea = await waitForElement('textarea[data-id="txt_AddFrd_Msg"]', 5000)
        .catch(() => null);

      if (!textarea) {
        result.errorMsg = 'Không tìm thấy ô lời chào';
        closeModal();
        return result;
      }

      const finalGreeting = greeting.slice(0, 150);

      // Điền lần đầu tiên ngay lập tức
      textarea.focus();
      setReactValue(textarea, finalGreeting);
      
      // Delay & Retry Polling: Zalo có cơ chế fetch câu chào mặc định bất đồng bộ 
      // và sẽ ghi đè vào textarea sau khoảng 0.5s - 1s.
      // Dùng vòng lặp kiểm tra liên tục trong 1.5s để bảo vệ đoạn text của chúng ta.
      for (let i = 0; i < 5; i++) {
        await delay(300);
        if (textarea.value !== finalGreeting) {
          console.log(`[ZaloExt] Zalo overridden text detected at poll ${i+1}. Reverting...`);
          setReactValue(textarea, finalGreeting);
        }
      }

      // ── Bước 9: Click "Kết bạn" lần 2 (confirm) ──────────────────────────────
      const ketBanBtnConfirm = document.querySelector('div[data-translate-inner="STR_PROFILE_ADD_FRIEND"]');

      if (!ketBanBtnConfirm) {
        result.errorMsg = 'Không tìm thấy nút Kết bạn confirm';
        closeModal();
        return result;
      }
      simulateClick(ketBanBtnConfirm);
      await delay(600);

      // Thành công — popup thành công sẽ xuất hiện, đóng nó
      result.status = 'success';
      result.message = greeting.slice(0, 150);
      closeModal();
      await delay(400);

    } catch (err) {
      result.errorMsg = String(err.message || err);
      try { closeModal(); } catch (_) {}
    }

    return result;
  }

  // ─── Message Listener ─────────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'ADD_FRIEND') {
      const { phone, greeting } = msg;
      addFriend(phone, greeting).then((result) => {
        sendResponse(result);
      });
      return true; // Keep message channel open for async
    }
  });

})();
