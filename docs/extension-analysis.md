# 📋 Phân Tích Nghiệp Vụ — Zalo Auto Add Friend Extension

> **Version:** 1.0.0 | **Manifest Version:** 3 | **Phạm vi:** `https://chat.zalo.me/*`

---

## 🗺️ Tổng quan kiến trúc

Extension được chia làm 4 layer độc lập, giao tiếp qua Chrome Messaging API:

```
┌─────────────────────────────────────────────────────────────┐
│  NGƯỜI DÙNG                                                │
│  (Upload Excel, nhấn nút)                                  │
└────────────────────┬────────────────────────────────────────┘
                     │
              ┌──────▼──────┐
              │  POPUP UI   │  popup.html / popup.js / popup.css
              │  (Giao diện)│  ← File Input, Progress, Controls
              └──────┬──────┘
                     │ chrome.runtime.sendMessage()
              ┌──────▼──────────────────┐
              │  SERVICE WORKER         │  background/background.js
              │  (Queue Manager)        │  ← State Machine, Timer
              └──────┬──────────────────┘
                     │ chrome.tabs.sendMessage()
              ┌──────▼──────────────────┐
              │  CONTENT SCRIPT         │  content/content.js
              │  (DOM Automation)       │  ← Điều khiển Zalo Web UI
              └─────────────────────────┘

              ┌─────────────────────────┐
              │  SETTINGS PAGE          │  settings/settings.html/.js
              │  (Config Panel)         │  ← Lưu vào chrome.storage.sync
              └─────────────────────────┘
```

---

## 📁 Cấu trúc file

| File                       | Kích thước | Vai trò                              |
| -------------------------- | ---------- | ------------------------------------ |
| `manifest.json`            | 716 B      | Khai báo extension, permissions      |
| `background/background.js` | 7 KB       | Service Worker — Queue Manager       |
| `content/content.js`       | 9.4 KB     | DOM Automation trên Zalo Web         |
| `popup/popup.html`         | 2.8 KB     | Giao diện chính                      |
| `popup/popup.js`           | 9.8 KB     | Logic UI, file upload, state display |
| `popup/popup.css`          | 4.3 KB     | Styling giao diện                    |
| `settings/settings.html`   | 2.3 KB     | Trang cài đặt                        |
| `settings/settings.js`     | 2.8 KB     | Logic lưu/tải cài đặt                |
| `lib/xlsx.min.js`          | 881 KB     | Thư viện đọc file Excel              |

---

## 🔑 Permissions sử dụng

| Permission  | Mục đích                                                         |
| ----------- | ---------------------------------------------------------------- |
| `storage`   | Lưu danh sách SĐT, state, kết quả (`local`) và settings (`sync`) |
| `tabs`      | Tìm tab `chat.zalo.me` đang mở để gửi lệnh                       |
| `scripting` | Inject content script (nếu cần)                                  |
| `alarms`    | Keep-alive Service Worker, tránh bị Chrome kill sau 30s idle     |
| `activeTab` | Truy cập tab đang active                                         |

---

## 🏗️ Phân tích nghiệp vụ từng module

### 1. Settings Page (`settings/`)

**Mục đích:** Cho phép người dùng cấu hình hành vi tự động hóa.

**Các tham số cài đặt:**

| Tham số      | Mặc định                           | Giới hạn  | Mô tả                                      |
| ------------ | ---------------------------------- | --------- | ------------------------------------------ |
| `greeting`   | _"Xin chào, mình tìm thấy bạn..."_ | 150 ký tự | Lời chào gửi khi kết bạn                   |
| `delayMin`   | 3 giây                             | 1–30s     | Thời gian chờ tối thiểu giữa 2 lần kết bạn |
| `delayMax`   | 8 giây                             | 1–60s     | Thời gian chờ tối đa giữa 2 lần kết bạn    |
| `batchSize`  | 10 lần                             | 5–100     | Sau bao nhiêu lần thì nghỉ dài             |
| `batchRest`  | 90 giây                            | 30–600s   | Thời gian nghỉ dài sau mỗi batch           |
| `backendUrl` | `http://localhost:3000`            | —         | URL backend server (hiện tắt)              |
| `apiKey`     | `zalo-tool-secret-2026`            | —         | API key cho backend (hiện tắt)             |

**Lưu trữ:** `chrome.storage.sync` — đồng bộ qua các thiết bị Chrome đăng nhập cùng tài khoản Google.

**Validation:** `delayMin` phải nhỏ hơn `delayMax` (kiểm tra trước khi lưu).

**Test connection:** Gọi `GET {backendUrl}/health` để kiểm tra kết nối với backend (hiện backend logging bị comment out).

---

### 2. Popup UI (`popup/`)

**Mục đích:** Giao diện chính để người dùng upload danh sách, khởi động/dừng bot.

#### 2.1 Upload & Parse Excel

```
Người dùng chọn file .xlsx/.xls
        │
        ▼
FileReader.readAsArrayBuffer()
        │
        ▼
XLSX.read() → lấy Sheet đầu tiên
        │
        ▼
sheet_to_json({ header: 1 }) → mảng rows
        │
        ├── Row 0: headers (bỏ qua)
        ├── Col 0: Số điện thoại di động
        └── Col 1: Tên liên hệ
        │
        ▼
normalizePhone() cho từng SĐT:
  - Loại bỏ ký tự không phải số
  - Bỏ prefix "84" (nếu có)
  - Bỏ số "0" đầu tiên
  - Reject nếu độ dài < 8 hoặc > 11 số
        │
        ▼
contacts[] = [{ phone, rawPhone, name, status: 'pending' }]
        │
        ▼
Lưu vào chrome.storage.local:
{ contacts, currentIndex: 0, results: {...} }
```

**Trạng thái từng contact:**

- `pending` — chưa xử lý
- `running` — đang xử lý
- `success` — kết bạn thành công
- `not_found` — không tìm thấy SĐT trên Zalo
- `already_friend` — đã là bạn bè
- `error` — lỗi kỹ thuật

#### 2.2 Bảng điều khiển (State Machine)

```
               [Start]
                  │
         ┌────────▼────────┐
         │    RUNNING      │◄─────[Resume]
         └────────┬────────┘
                  │
         ┌────────┼────────┐
      [Pause]     │      [Stop]
         │        │         │
    ┌────▼───┐    │    ┌────▼───┐
    │ PAUSED │    │    │  IDLE  │
    └────────┘    │    └────────┘
                  │
              [Done/Error]
                  │
             ┌────▼───┐
             │  IDLE  │
             └────────┘
```

**Các nút điều khiển:**

- **▶ Bắt đầu** → gửi `START_QUEUE` đến background
- **⏸ Tạm dừng** → gửi `PAUSE_QUEUE`
- **▶ Tiếp tục** → gửi `RESUME_QUEUE`
- **⏹ Dừng** → gửi `STOP_QUEUE`
- **🔄 Reset** → xóa toàn bộ state, quay về màn hình upload

#### 2.3 Hiển thị kết quả realtime

Popup nhận message từ background qua `chrome.runtime.onMessage`:

- `PROGRESS_UPDATE` → cập nhật màu dot, progress bar, bộ đếm kết quả
- `QUEUE_DONE` → hiển thị "🎉 Hoàn thành!"
- `QUEUE_ERROR` → hiển thị thông báo lỗi

**Khôi phục state khi đóng/mở lại popup:** Đọc `chrome.storage.local` ngay khi popup khởi động để hiển thị trạng thái hiện tại (kể cả khi đang chạy).

---

### 3. Background Service Worker (`background/background.js`)

**Mục đích:** Queue Manager — điều phối việc gửi yêu cầu thêm bạn tuần tự.

#### 3.1 Keep-alive Mechanism

```javascript
chrome.alarms.create("keepAlive", { periodInMinutes: 0.4 });
// Mỗi 24 giây: gọi chrome.storage.local.get() để đánh thức SW
// → Ngăn Chrome tự kill Service Worker sau 30s idle
```

> ⚠️ **Quan trọng:** Alarm chỉ wake-up SW, KHÔNG gọi `processNext()` để tránh race condition.

#### 3.2 Queue Processing Loop

```
startQueue()
    │
    ├── Đọc contacts, currentIndex, settings từ storage
    ├── Set queueState = 'running'
    └── Gọi processNext()

processNext()
    │
    ├── Check: queueState === 'running'? Nếu không → thoát
    ├── Mutex lock: isProcessing = true (chống parallel execution)
    │
    ├── Check: currentIndex >= contacts.length?
    │       └── YES → broadcastToPopup(QUEUE_DONE), set idle
    │
    ├── Lấy contact[currentIndex]
    ├── broadcastToPopup(PROGRESS_UPDATE, status='running')
    │
    ├── getZaloTab() → tìm tab chat.zalo.me
    │       └── Không tìm thấy → broadcastToPopup(QUEUE_ERROR)
    │
    ├── chrome.tabs.sendMessage(zaloTab.id, { action: 'ADD_FRIEND', phone, greeting })
    │       → Chờ response từ content script
    │
    ├── Cập nhật contacts[currentIndex].status
    ├── Lưu state vào storage (contacts, currentIndex+1, results)
    ├── broadcastToPopup(PROGRESS_UPDATE, status=result.status)
    │
    ├── Tính waitMs:
    │       ├── Nếu nextIdx % batchSize === 0 → waitMs = batchRest * 1000
    │       └── Nếu không → waitMs = random(delayMin..delayMax) * 1000
    │
    └── setTimeout(() => processNext(), waitMs)
          → Đệ quy không đồng bộ, không đồng bộ hóa
```

#### 3.3 Anti-Pattern được xử lý

| Rủi ro                              | Giải pháp                                               |
| ----------------------------------- | ------------------------------------------------------- |
| SW bị kill giữa chừng               | `chrome.alarms` keep-alive mỗi 24s                      |
| Parallel execution (race condition) | `isProcessing` mutex lock                               |
| Content script chưa load            | Catch "Receiving end does not exist", thông báo user F5 |
| State mất khi popup đóng            | Toàn bộ state lưu trong `chrome.storage.local`          |

---

### 4. Content Script (`content/content.js`)

**Mục đích:** Tự động hóa thao tác DOM trên `chat.zalo.me` để thêm bạn.

**Khởi động:** Inject tự động khi user mở `https://chat.zalo.me/*` (`run_at: document_idle`).

#### 4.1 Luồng tự động hóa 9 bước

```
Nhận message { action: 'ADD_FRIEND', phone, greeting }
        │
        ▼
┌─────────────────────────────────────────────────────┐
│ BƯỚC 1: Click nút "Thêm bạn" trên sidebar          │
│  Selector: [data-translate-title="Thêm bạn"]        │
│  → simulateClick() → delay(600ms)                   │
└───────────────────────┬─────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────┐
│ BƯỚC 2: Nhập số điện thoại vào input                │
│  Selector: input[placeholder="Số điện thoại"]        │
│  → setReactValue() (bypass React controlled input)   │
│  → delay(400ms)                                     │
└───────────────────────┬─────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────┐
│ BƯỚC 3: Click nút "Tìm kiếm"                        │
│  Selector: div[data-translate-inner="STR_SEARCH"]    │
│  → simulateClick()                                  │
└───────────────────────┬─────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────┐
│ BƯỚC 4: Chờ profile xuất hiện (timeout 6s)          │
│  Race between:                                      │
│  - "Kết bạn" button → result: 'add'                 │
│  - Profile edit button → result: 'profile'           │
│  ├─ Timeout → status: 'not_found'                   │
│  └─ Found → tiếp tục bước 5                         │
└───────────────────────┬─────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────┐
│ BƯỚC 5: Lấy tên Zalo thực tế                        │
│  Selector: [data-id="btn_UserProfile_EditAlias"]     │
│  → lấy text từ previousElementSibling               │
└───────────────────────┬─────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────┐
│ BƯỚC 6: Kiểm tra đã là bạn chưa                     │
│  Selector: div[data-translate-inner="STR_PROFILE_   │
│            ADD_FRIEND"]                              │
│  ├─ Không có nút → status: 'already_friend'         │
│  └─ Có nút → tiếp tục bước 7                        │
└───────────────────────┬─────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────┐
│ BƯỚC 7: Click "Kết bạn" lần 1                       │
│  → Mở dialog nhập lời chào                          │
│  → delay(800ms)                                     │
└───────────────────────┬─────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────┐
│ BƯỚC 8: Điền lời chào (với retry polling)           │
│  Selector: textarea[data-id="txt_AddFrd_Msg"]        │
│  → setReactValue(greeting.slice(0, 150))             │
│  → Polling 5 lần × 300ms:                           │
│     Zalo ghi đè text bằng fetch async               │
│     → phát hiện và ghi lại                          │
└───────────────────────┬─────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────┐
│ BƯỚC 9: Click "Kết bạn" lần 2 (xác nhận)           │
│  → Gửi lời mời                                      │
│  → closeModal() → status: 'success'                  │
└─────────────────────────────────────────────────────┘
```

#### 4.2 Kỹ thuật đặc biệt

**`setReactValue()`** — Bypass React controlled components:

```javascript
// React giữ control của input qua internal fiber state
// Phải sử dụng native setter để trigger React re-render
const nativeSetter = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype,
  "value",
).set;
nativeSetter.call(el, value);
el.dispatchEvent(new Event("input", { bubbles: true }));
```

**`simulateClick()`** — Giả lập pointer events đầy đủ:

```javascript
// Zalo sử dụng pointer events, không phải chỉ click
pointerdown → mousedown → pointerup → mouseup → click
```

**`waitForElement()`** — MutationObserver để chờ React render:

```javascript
// Zalo là React SPA, DOM thay đổi bất đồng bộ
// Không thể dùng setTimeout cố định
new MutationObserver(() => {
  /* check selector */
});
```

**Retry Polling cho lời chào:**

```
Zalo có cơ chế fetch lời chào mặc định async (0.5–1s)
→ Polling 5 lần × 300ms sau khi set text
→ Phát hiện và ghi đè lại nếu bị thay đổi
```

---

## 🔄 Luồng tổng thể (End-to-End)

```
1. USER mở Popup
   └─ popup.js khôi phục state từ chrome.storage.local

2. USER upload file Excel
   └─ XLSX.js parse → normalizePhone() → contacts[]
   └─ Lưu vào chrome.storage.local

3. USER nhấn "▶ Bắt đầu"
   └─ popup.js → sendMessage(START_QUEUE)
   └─ background.js nhận → startQueue() → processNext()

4. processNext() [lặp]
   ├─ Tìm tab Zalo đang mở
   ├─ sendMessage(ADD_FRIEND, phone, greeting) → content.js
   │
   │   content.js thực hiện 9 bước tự động hóa DOM
   │   └─ Trả về { status, zaloName, errorMsg }
   │
   ├─ Lưu kết quả vào storage
   ├─ broadcastToPopup(PROGRESS_UPDATE)
   │   └─ popup.js cập nhật UI
   │
   └─ setTimeout(processNext, delay) ← đệ quy có delay

5. Sau batchSize lần
   └─ Nghỉ dài batchRest giây

6. Hết danh sách
   └─ broadcastToPopup(QUEUE_DONE)
   └─ popup.js hiển thị "🎉 Hoàn thành!"
```

---

## 📊 Phân loại kết quả

| Trạng thái       | Ý nghĩa                                          | Biểu tượng |
| ---------------- | ------------------------------------------------ | ---------- |
| `success`        | Gửi lời mời kết bạn thành công                   | ✅         |
| `not_found`      | SĐT không tìm thấy trên Zalo                     | ❌         |
| `already_friend` | Đã là bạn bè                                     | ℹ️         |
| `error`          | Lỗi kỹ thuật (DOM không tìm thấy, timeout, v.v.) | 💥         |

---

## ⚠️ Hạn chế & rủi ro hiện tại

### 1. Phụ thuộc CSS Selector cứng

Các selector như `data-translate-inner="STR_SEARCH"`, `data-id="btn_UserProfile_EditAlias"` phụ thuộc vào DOM của Zalo Web. Nếu Zalo cập nhật UI → extension sẽ hỏng.

### 2. Backend integration bị tắt

Code `postLog()` trong `background.js` đã bị comment out. Settings có trường `backendUrl` và `apiKey` nhưng không được sử dụng.

### 3. Anti-bot detection

Extension không có cơ chế chống phát hiện (user agent, mouse movement pattern, v.v.). Rủi ro bị Zalo khóa tài khoản nếu xử lý số lượng lớn.

### 4. Rate limiting

Chỉ có delay ngẫu nhiên và batch rest. Không có exponential backoff nếu gặp lỗi liên tiếp.

### 5. Không có export kết quả

Sau khi chạy xong, người dùng không thể export kết quả ra file.

---

## 🔌 Giao thức Message giữa các layer

```
popup.js → background.js:
  { action: 'START_QUEUE' }
  { action: 'PAUSE_QUEUE' }
  { action: 'RESUME_QUEUE' }
  { action: 'STOP_QUEUE' }

background.js → popup.js:
  { action: 'PROGRESS_UPDATE', index, status, errorMsg, total }
  { action: 'QUEUE_DONE' }
  { action: 'QUEUE_ERROR', error }

background.js → content.js:
  { action: 'ADD_FRIEND', phone, greeting }
  → Response: { status, zaloName, errorMsg, message }
```

---

## 💾 Storage Schema

### `chrome.storage.local` (dữ liệu session, không sync)

```js
{
  contacts: [
    {
      phone: "912345678",      // đã normalize
      rawPhone: "0912345678",  // nguyên bản từ Excel
      name: "Nguyễn Văn A",
      status: "pending" | "running" | "success" | "not_found" | "already_friend" | "error",
      errorMsg?: "..."         // chỉ khi status === 'error'
    }
  ],
  currentIndex: 5,             // index đang xử lý
  results: {
    success: 3,
    not_found: 1,
    already_friend: 0,
    error: 1
  },
  queueState: "idle" | "running" | "paused" | "stopped"
}
```

### `chrome.storage.sync` (settings, đồng bộ qua thiết bị)

```js
{
  greeting: "...",   // string, tối đa 150 ký tự
  delayMin: 3,       // số nguyên, giây
  delayMax: 8,       // số nguyên, giây
  batchSize: 10,     // số nguyên
  batchRest: 90,     // số nguyên, giây
  backendUrl: "...", // URL string
  apiKey: "..."      // string
}
```

---

_Tài liệu được tạo tự động từ phân tích mã nguồn — 2026-03-08_
