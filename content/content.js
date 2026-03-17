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

  /**
   * Set nội dung cho contenteditable div (Zalo rich input)
   * Dùng execCommand để React nhận được input event
   */
  function setContentEditable(el, text) {
    if (!el) return;
    el.focus();
    // Xóa nội dung cũ
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);
    // Gõ text mới — React lắng nghe qua execCommand
    document.execCommand('insertText', false, text);
  }

  // ─── Main Automation Flow ─────────────────────────────────────────────────────

  async function addFriend(phone, greeting, autoMessages = [], autoMessageImage = null) {
    const result = { status: 'error', zaloName: '', errorMsg: '', messageError: '' };

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

      // Thành công — gửi lời mời thành công
      result.status = 'success';
      result.message = greeting.slice(0, 150);

      closeModal();
      await delay((autoMessages && autoMessages.length > 0) || autoMessageImage ? 1200 : 400);

      // ── Bước 10-12: Tự động nhắn tin (nếu có cấu hình) ─────────────────────
      if ((autoMessages && autoMessages.length > 0) || autoMessageImage) {
        try {
          const postMessageResult = await handlePostSuccessMessaging(phone, autoMessages, autoMessageImage);
          if (postMessageResult && postMessageResult.messageError) {
            result.messageError = postMessageResult.messageError;
          }
        } catch (err) {
          result.messageError = String(err.message || err);
        }
      }

    } catch (err) {
      result.errorMsg = String(err.message || err);
      try { closeModal(); } catch (_) {}
    }

    return result;
  }

  // ─── Auto Message Flow ────────────────────────────────────────────────────────

  async function handlePostSuccessMessaging(phone, messages, imageData) {
    let messageError = '';

    try {
      console.log(`[ZaloExt] Bắt đầu tự động nhắn tin cho SĐT: ${phone}`);

      // ── Bước 10.1: Mở modal mở cửa sổ tìm kiếm ─────────────────────────────
      const addFriendBtn = document.querySelector('[data-translate-title="Thêm bạn"], [title="Thêm bạn"], div[data-translate-title="STR_ADD_FRIEND_BTN"]');
      if (!addFriendBtn) {
        throw new Error('Không tìm thấy nút Thêm bạn để mở chat sau khi kết bạn');
      }
      simulateClick(addFriendBtn);
      await delay(600);

      // ── Bước 10.2: Điền SĐT ────────────────────────────────────────────────
      const phoneInput = await waitForElement('input[placeholder="Số điện thoại"], input.phone-i-input', 4000).catch(() => null);
      if (!phoneInput) {
        throw new Error('Không tìm thấy input SĐT trong modal nhắn tin');
      }
      phoneInput.focus();
      setReactValue(phoneInput, phone);
      await delay(400);

      // ── Bước 10.3: Tìm kiếm ────────────────────────────────────────────────
      const searchBtn = await waitForElement('div[data-translate-inner="STR_SEARCH"]', 3000).catch(() => null);
      if (!searchBtn) {
        throw new Error('Không tìm thấy nút Tìm kiếm trong modal nhắn tin');
      }
      simulateClick(searchBtn);
      await delay(1500); // Chờ list kết quả hiện ra

      // ── Bước 10.4: Nhấp vào nút "Nhắn tin" trên kết quả tìm kiếm ───────────
      const chatBtn = document.querySelector('div[data-translate-inner="STR_CHAT"]');
      if (!chatBtn) {
        throw new Error('Không tìm thấy nút Nhắn tin trên kết quả tìm kiếm');
      }
      simulateClick(chatBtn);
      
      // Khung chat đã mở, chờ 1 chút
      await delay(1000);

      // ── Bước 11: Chờ rich input xuất hiện ────────────────────────────────────
      const chatInput = await waitForElement('div#richInput', 6000).catch(() => null);
      if (!chatInput) {
        throw new Error('Không tìm thấy ô chat để gửi tin nhắn tự động');
      }

      await delay(500);

      // ── Bước 11.5: Gửi ảnh nếu có ─────────────────────────────────────────
      if (imageData && imageData.bytes && imageData.bytes.length > 0) {
        try {
          await sendImage(chatInput, imageData);
          await delay(800); // Chờ Zalo xử lý xong ảnh
        } catch (err) {
          messageError = String(err.message || err);
        }
      }

      // ── Bước 12: Gửi lần lượt từng tin nhắn ─────────────────────────────────
      for (const msg of messages) {
        if (!msg.text || !msg.text.trim()) continue;

        const waitMs = (parseInt(msg.delay, 10) || 1) * 1000;
        await delay(waitMs);

        setContentEditable(chatInput, msg.text.trim());
        await delay(300);

        await submitCurrentDraft(chatInput);

        await delay(400);
        console.log(`[ZaloExt] Đã gửi: "${msg.text.slice(0, 30)}"`);
      }

      if ((!messages || messages.length === 0) && imageData && imageData.bytes && imageData.bytes.length > 0) {
        await submitCurrentDraft(chatInput);
        await delay(400);
      }

      return { messageError };
    } catch (err) {
      try { closeModal(); } catch (_) {}
      throw err;
    }
  }

  // ─── Send Image via Clipboard Paste ────────────────────────────────────────────

  async function sendImage(chatInput, imageData) {
    try {
      if (!imageData || !imageData.bytes || !imageData.bytes.length) {
        throw new Error('Thiếu dữ liệu ảnh để gửi');
      }

      const mimeType = imageData.mimeType || 'image/png';
      const fileName = imageData.name || 'image.png';

      // Convert byte array → Blob → File
      const blob = new Blob([Uint8Array.from(imageData.bytes)], { type: mimeType });
      const file = new File([blob], fileName, { type: mimeType });

      // ─ Option B: DataTransfer ClipboardEvent paste ───────────────────────────
      const dt = new DataTransfer();
      dt.items.add(file);

      chatInput.focus();

      const pasteEvent = new ClipboardEvent('paste', {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
      });
      const dispatched = chatInput.dispatchEvent(pasteEvent);

      if (!dispatched) {
        throw new Error('Zalo đã chặn sự kiện paste ảnh tự động');
      }

      // Kiểm tra nếu Zalo xử lý paste (preview xuất hiện)
      await delay(1000);

      // Kiểm tra preview: Zalo thường render .image-preview hoặc thumb
      const hasPreview = document.querySelector(
        '.image-upload-preview, .thumb-wrapper, [class*="upload-preview"], [class*="attach-preview"]'
      );

      if (hasPreview) {
        console.log('[ZaloExt] Đã đính kèm ảnh qua DataTransfer paste.');
        return;
      }

      // ─ Fallback Option A: navigator.clipboard.write() ─────────────────────────
      console.log('[ZaloExt] DataTransfer paste không hoạt động, fallback sang clipboard.write...');
      try {
        await navigator.clipboard.write([
          new ClipboardItem({ [mimeType]: blob }),
        ]);

        // Gửi Ctrl+V keyboard shortcut thật đến document
        document.execCommand('paste');
        await delay(1200);

        // Check preview lần 2
        const hasPreview2 = document.querySelector(
          '.image-upload-preview, .thumb-wrapper, [class*="upload-preview"], [class*="attach-preview"]'
        );
        if (hasPreview2) {
          console.log('[ZaloExt] Đã đính kèm ảnh qua clipboard.write fallback.');
        } else {
          throw new Error('Cả hai phương pháp paste ảnh đều thất bại');
        }
      } catch (clipErr) {
        throw new Error(`Không thể gửi ảnh tự động: ${String(clipErr.message || clipErr)}`);
      }

    } catch (err) {
      throw err;
    }
  }

  async function submitCurrentDraft(chatInput) {
    const sendButton = findSendButton(chatInput);

    if (sendButton) {
      simulateClick(sendButton);
      return;
    }

    chatInput.focus();
    chatInput.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
    }));
    chatInput.dispatchEvent(new KeyboardEvent('keyup', {
      key: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
    }));
  }

  function findSendButton(chatInput) {
    const scope = chatInput.closest('footer, form, [class*="chat-input"], [class*="composer"], [class*="input"]') || document;
    const selectors = [
      'button[aria-label="Gửi"]',
      'button[title="Gửi"]',
      '[role="button"][aria-label="Gửi"]',
      '[data-translate-title="Gửi"]',
      '[data-translate-title="STR_SEND"]',
      '[data-translate-inner="STR_SEND"]',
      '[data-id*="send"]',
      '[class*="send"]',
    ];

    for (const selector of selectors) {
      const candidate = scope.querySelector(selector) || document.querySelector(selector);
      if (candidate && isVisible(candidate)) {
        return candidate;
      }
    }

    const nearbyButtons = Array.from(scope.querySelectorAll('button, [role="button"]'));
    return nearbyButtons.find((candidate) => {
      if (!isVisible(candidate)) return false;
      const label = [candidate.getAttribute('aria-label'), candidate.getAttribute('title'), candidate.textContent]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return label.includes('gửi') || label.includes('send');
    }) || null;
  }

  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  // ─── Message Listener ─────────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'ADD_FRIEND') {
      const { phone, greeting, autoMessages, autoMessageImage } = msg;
      addFriend(phone, greeting, autoMessages, autoMessageImage).then((result) => {
        sendResponse(result);
      });
      return true;
    }
  });

})();
