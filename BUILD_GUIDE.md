# Hướng dẫn đóng gói và upload lên Chrome Web Store

## Bước 1: Chuẩn bị trước khi đóng gói

### 1.1. Kiểm tra các file bắt buộc

Đảm bảo các file sau tồn tại:

- ✅ `manifest.json` - Đã có, version 1.1.0
- ✅ `public/icons/icon16.png` - Icon 16x16
- ✅ `public/icons/icon32.png` - Icon 32x32
- ✅ `public/icons/icon48.png` - Icon 48x48
- ✅ `public/icons/icon128.png` - Icon 128x128
- ✅ `public/popup.html` - Popup UI với logo mới
- ✅ `src/background/background.js` - Service worker
- ✅ `src/content/shopee.js` - Content script
- ✅ `src/popup/popup.js` - Popup logic
- ✅ `README.md` - Hướng dẫn sử dụng
- ✅ `PRIVACY_POLICY.md` - Chính sách bảo mật
- ✅ `STORE_LISTING.md` - Thông tin cho Store

### 1.2. Kiểm tra manifest.json

Đảm bảo manifest.json có đầy đủ thông tin:
- ✅ Name: "Copee - Shopee Product Copier"
- ✅ Version: "1.1.0"
- ✅ Description: ngắn gọn, < 132 ký tự
- ✅ Icons: tất cả 4 kích thước
- ✅ Permissions: storage, activeTab, scripting
- ✅ Host permissions: shopee.vn, copee domains

### 1.3. Test extension locally

1. Mở Chrome và vào `chrome://extensions/`
2. Bật **Developer mode**
3. Click **"Load unpacked"**
4. Chọn thư mục `copee-extension`
5. Test các chức năng:
   - ✅ Icon hiển thị đúng
   - ✅ Popup mở được
   - ✅ Copy sản phẩm từ Shopee
   - ✅ Kết nối với Copee web app

## Bước 2: Đóng gói Extension

### 2.1. Tạo file ZIP

**Cách 1: Sử dụng Terminal (Khuyến nghị)**

```bash
# Di chuyển đến thư mục extension
cd /Users/tudinhtu/HCMJS/copee-web-app/copee-extension

# Tạo file ZIP (loại trừ các file không cần thiết)
zip -r copee-extension-v1.1.0.zip . \
  -x "*.git*" \
  -x "*.DS_Store" \
  -x "BUILD_GUIDE.md" \
  -x "STORE_LISTING.md" \
  -x "create-icons.sh" \
  -x "*.zip"
```

**Cách 2: Sử dụng Finder**

1. Chọn các file/folder cần thiết:
   - `manifest.json`
   - `public/` folder
   - `src/` folder
   - `README.md`
   - `PRIVACY_POLICY.md`

2. Right-click → "Compress X items"
3. Đổi tên file thành `copee-extension-v1.1.0.zip`

### 2.2. Kiểm tra file ZIP

```bash
# Xem nội dung file ZIP
unzip -l copee-extension-v1.1.0.zip

# Đảm bảo có các file:
# - manifest.json
# - public/popup.html
# - public/icons/ (4 icon files)
# - src/background/background.js
# - src/content/shopee.js
# - src/popup/popup.js
# - README.md
# - PRIVACY_POLICY.md
```

## Bước 3: Chuẩn bị Screenshots

### 3.1. Yêu cầu

- **Kích thước:** 1280x800 hoặc 640x400 pixels
- **Số lượng:** Tối thiểu 1, tối đa 5
- **Định dạng:** PNG hoặc JPEG

### 3.2. Screenshots cần chụp

1. **Extension Popup** - Popup với thông tin sản phẩm
2. **Shopee Page** - Icon extension trên trang Shopee
3. **Copee Dashboard** - Danh sách sản phẩm đã copy
4. **Upload WooCommerce** - Giao diện upload hàng loạt
5. **Product Details** - Chi tiết sản phẩm đã copy

### 3.3. Tools để chụp screenshots

- **macOS:** Cmd + Shift + 4 (chọn vùng)
- **Windows:** Windows + Shift + S
- **Chrome DevTools:** F12 → Device Toolbar → Screenshot

### 3.4. Resize screenshots

```bash
# Sử dụng sips (macOS)
sips -z 800 1280 screenshot.png --out screenshot-resized.png

# Hoặc dùng online tools:
# - resize-image.net
# - iloveimg.com/resize-image
```

## Bước 4: Upload lên Chrome Web Store

### 4.1. Đăng ký Chrome Web Store Developer

1. Truy cập: https://chrome.google.com/webstore/devconsole
2. Đăng nhập với Google Account
3. Thanh toán phí đăng ký một lần: **$5 USD**
4. Chấp nhận Developer Agreement

### 4.2. Tạo Extension mới

1. Click **"New Item"**
2. Upload file ZIP: `copee-extension-v1.1.0.zip`
3. Chờ Chrome kiểm tra file (vài phút)

### 4.3. Điền thông tin Store Listing

#### Product Details Tab

**Store Listing Language:** Vietnamese

**Name:**
```
Copee - Shopee Product Copier
```

**Summary (132 characters max):**
```
Copy sản phẩm từ Shopee lên WooCommerce chỉ với một click. Tiết kiệm thời gian, tăng hiệu quả kinh doanh online.
```

**Description:**
- Copy nội dung từ `STORE_LISTING.md` phần "Detailed Description"

**Category:**
- Primary: Shopping
- Secondary: Productivity

**Language:**
- Vietnamese (Tiếng Việt)

#### Graphic Assets

**Icon:**
- Upload `public/icons/icon128.png`

**Screenshots:**
- Upload 4-5 screenshots đã chuẩn bị

**Promotional Images (Optional):**
- Small tile: 440x280
- Large tile: 920x680
- Marquee: 1400x560

#### Additional Fields

**Official URL:**
```
https://app.copee.vn
```

**Homepage URL:**
```
https://app.copee.vn
```

**Support URL:**
```
https://app.copee.vn/support
```

### 4.4. Privacy Tab

**Privacy Policy:**
- Chọn: "Published on my website"
- URL: Đăng `PRIVACY_POLICY.md` lên website và điền link
  - Ví dụ: `https://app.copee.vn/privacy-policy`
  - Hoặc: Link đến file trên GitHub

**Single Purpose:**
```
Sao chép thông tin sản phẩm từ Shopee.vn và gửi đến tài khoản Copee web app của người dùng.
```

**Permission Justifications:**
- Copy từ `STORE_LISTING.md` phần "Justification for Permissions"

**Data Usage:**
- Chọn: "Does not collect user data"
- Hoặc điền chi tiết theo Privacy Policy

**Certification:**
- ✅ Check tất cả các boxes xác nhận tuân thủ chính sách

### 4.5. Distribution Tab

**Visibility:**
- Public (Công khai)
- Unlisted (Chỉ người có link)
- Private (Riêng tư)

**Regions:**
- Chọn: Vietnam
- Hoặc: All regions

**Pricing:**
- Free

### 4.6. Submit for Review

1. Click **"Submit for review"**
2. Chờ Google review (thường 1-3 ngày làm việc)
3. Nhận email thông báo kết quả

## Bước 5: Sau khi Publish

### 5.1. Khi extension được approve

1. Extension sẽ xuất hiện trên Chrome Web Store
2. Lấy link extension: `https://chrome.google.com/webstore/detail/[extension-id]`
3. Cập nhật link trong README.md và website

### 5.2. Update extension

Khi có phiên bản mới:

1. Tăng version trong `manifest.json`
2. Tạo file ZIP mới
3. Vào Developer Dashboard → Edit extension
4. Upload file ZIP mới
5. Submit for review

### 5.3. Monitor

- Kiểm tra reviews và ratings thường xuyên
- Trả lời câu hỏi của users
- Theo dõi crash reports
- Cập nhật extension định kỳ

## Lưu ý quan trọng

### ✅ Checklist trước khi submit

- [ ] Manifest.json version đã tăng
- [ ] Tất cả icons đã cập nhật
- [ ] Privacy Policy đã được host online
- [ ] Screenshots chất lượng cao
- [ ] Test extension trên nhiều scenarios
- [ ] Description không có lỗi chính tả
- [ ] Không vi phạm chính sách Chrome Web Store

### ⚠️ Những điều cần tránh

- ❌ Không sử dụng logo/thương hiệu của Shopee
- ❌ Không đề cập "chính thức" hoặc "liên kết" với Shopee
- ❌ Không yêu cầu quá nhiều permissions
- ❌ Không thu thập dữ liệu không cần thiết
- ❌ Không có malware hoặc code đáng ngờ

## Support

Nếu có vấn đề trong quá trình upload:

- Chrome Web Store Help: https://support.google.com/chrome_webstore/
- Developer Policies: https://developer.chrome.com/docs/webstore/program-policies/

---

**Chúc bạn thành công với extension! 🚀**
