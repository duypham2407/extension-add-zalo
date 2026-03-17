(function (root) {
  'use strict';

  const DB_NAME = 'zalo-auto-add-friend';
  const DB_VERSION = 1;
  const STORE_NAME = 'images';
  const AUTO_MESSAGE_IMAGE_ID = 'auto-message-image';

  function openImageStore() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        reject(new Error('Không thể mở kho ảnh IndexedDB'));
      };
    });
  }

  async function withStore(mode, handler) {
    const db = await openImageStore();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);

      let settled = false;
      let resultValue;

      function finish(fn, value) {
        if (settled) return;
        settled = true;
        db.close();
        fn(value);
      }

      tx.oncomplete = () => {
        finish(resolve, resultValue);
      };

      tx.onabort = () => {
        finish(reject, new Error('Giao dịch ảnh IndexedDB đã bị hủy'));
      };

      tx.onerror = () => {
        finish(reject, new Error('Giao dịch ảnh IndexedDB thất bại'));
      };

      handler(store, value => {
        resultValue = value;
      }, error => finish(reject, error));
    });
  }

  async function saveAutoMessageImage(fileOrBlob, metadata = {}) {
    if (!fileOrBlob) {
      throw new Error('Không có dữ liệu ảnh để lưu');
    }

    const record = {
      id: metadata.imageId || metadata.id || AUTO_MESSAGE_IMAGE_ID,
      name: metadata.name || fileOrBlob.name || 'image.png',
      mimeType: metadata.mimeType || fileOrBlob.type || 'image/png',
      blob: fileOrBlob,
      updatedAt: metadata.updatedAt || Date.now(),
    };

    return withStore('readwrite', (store, resolve, reject) => {
      const request = store.put(record);

      request.onsuccess = () => {
        resolve(record);
      };

      request.onerror = () => {
        reject(new Error('Không thể lưu ảnh vào IndexedDB'));
      };
    });
  }

  async function getAutoMessageImage(imageId = AUTO_MESSAGE_IMAGE_ID) {
    return withStore('readonly', (store, resolve, reject) => {
      const request = store.get(imageId);

      request.onsuccess = () => {
        resolve(request.result || null);
      };

      request.onerror = () => {
        reject(new Error('Không thể đọc ảnh từ IndexedDB'));
      };
    });
  }

  async function deleteAutoMessageImage(imageId = AUTO_MESSAGE_IMAGE_ID) {
    return withStore('readwrite', (store, resolve, reject) => {
      const request = store.delete(imageId);

      request.onsuccess = () => {
        resolve(true);
      };

      request.onerror = () => {
        reject(new Error('Không thể xóa ảnh khỏi IndexedDB'));
      };
    });
  }

  const api = {
    AUTO_MESSAGE_IMAGE_ID,
    openImageStore,
    saveAutoMessageImage,
    getAutoMessageImage,
    deleteAutoMessageImage,
  };

  root.ZaloImageStore = api;
})(typeof self !== 'undefined' ? self : window);
