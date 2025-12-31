# Copee - Shopee Product Copier

Tiện ích Chrome giúp sao chép sản phẩm từ Shopee và đồng bộ lên tài khoản Copee của bạn chỉ với một cú click.

## Tính năng

✨ **Sao chép sản phẩm nhanh chóng**
- Copy toàn bộ thông tin sản phẩm từ Shopee (tiêu đề, mô tả, giá, hình ảnh, biến thể)
- Chỉ cần một cú click trên trang sản phẩm Shopee

🔄 **Tự động đồng bộ**
- Gửi dữ liệu trực tiếp đến tài khoản Copee của bạn
- Cập nhật trạng thái real-time
- Không cần copy-paste thủ công

📦 **Quản lý sản phẩm**
- Xem danh sách sản phẩm đã copy trên Copee web app
- Chỉnh sửa và tùy chỉnh trước khi đăng lên WooCommerce
- Đăng hàng loạt lên nhiều site WordPress

## Cài đặt

### Từ Chrome Web Store (Khuyến nghị)

1. Truy cập [Copee trên Chrome Web Store](#) (link sẽ được cập nhật sau khi publish)
2. Click **"Add to Chrome"**
3. Xác nhận các quyền cần thiết
4. Extension sẽ xuất hiện trên thanh công cụ của bạn

### Cài đặt từ Source Code (Development)

1. Clone repository:
   ```bash
   git clone https://github.com/your-repo/copee-web-app.git
   cd copee-web-app/copee-extension
   ```

2. Mở Chrome và truy cập `chrome://extensions/`

3. Bật **Developer mode** (góc trên bên phải)

4. Click **"Load unpacked"**

5. Chọn thư mục `copee-extension`

## Hướng dẫn sử dụng

### Bước 1: Kết nối tài khoản Copee

1. Click vào icon Copee trên thanh công cụ Chrome
2. Nếu chưa có tài khoản, đăng ký tại [app.copee.vn](https://app.copee.vn)
3. Đăng nhập vào tài khoản Copee của bạn

### Bước 2: Copy sản phẩm từ Shopee

1. Truy cập bất kỳ trang sản phẩm nào trên [Shopee.vn](https://shopee.vn)
2. Click vào icon Copee trên thanh công cụ
3. Xem trước thông tin sản phẩm trong popup
4. Click **"Copy Product"** để gửi đến Copee

### Bước 3: Quản lý trên Copee Web App

1. Truy cập [app.copee.vn/dashboard](https://app.copee.vn/dashboard)
2. Xem danh sách sản phẩm đã copy
3. Chỉnh sửa thông tin, chọn danh mục, tùy chỉnh giá
4. Đăng hàng loạt lên WooCommerce

## Yêu cầu hệ thống

- Google Chrome phiên bản 88 trở lên
- Tài khoản Copee (đăng ký miễn phí tại app.copee.vn)
- Kết nối Internet

## Quyền truy cập (Permissions)

Extension yêu cầu các quyền sau:

- **storage**: Lưu cài đặt và preferences của bạn
- **activeTab**: Đọc thông tin sản phẩm từ trang Shopee hiện tại
- **scripting**: Tương tác với trang Shopee để trích xuất dữ liệu
- **host_permissions**: Truy cập shopee.vn và app.copee.vn

Xem chi tiết về quyền riêng tư tại [PRIVACY_POLICY.md](PRIVACY_POLICY.md)

## Câu hỏi thường gặp (FAQ)

### Extension hoạt động trên những trang nào?

Extension chỉ hoạt động trên các trang sản phẩm của Shopee.vn.

### Tôi có thể copy bao nhiêu sản phẩm?

Không giới hạn số lượng sản phẩm copy. Tuy nhiên, việc đăng lên WooCommerce có thể tính phí theo lượt (xem chi tiết tại app.copee.vn/dashboard/billing).

### Extension có thu thập dữ liệu cá nhân không?

Không. Extension chỉ thu thập thông tin sản phẩm công khai từ Shopee và gửi đến tài khoản Copee của bạn. Xem [Privacy Policy](PRIVACY_POLICY.md) để biết thêm chi tiết.

### Tôi cần tài khoản Copee không?

Có. Bạn cần đăng ký tài khoản miễn phí tại [app.copee.vn](https://app.copee.vn) để sử dụng extension.

### Extension có miễn phí không?

Extension hoàn toàn miễn phí. Tuy nhiên, việc đăng sản phẩm lên WooCommerce trên Copee web app có thể tính phí theo lượt.

## Báo lỗi và góp ý

Nếu bạn gặp vấn đề hoặc có đề xuất, vui lòng:

- Gửi email đến: support@copee.vn
- Báo lỗi trên GitHub: [Issues](https://github.com/your-repo/copee-web-app/issues)
- Liên hệ qua trang web: [app.copee.vn](https://app.copee.vn)

## Cập nhật

### Version 1.1.0 (2024-12-31)
- ✨ Cập nhật logo và icon mới
- 🎨 Cải thiện giao diện popup
- 🐛 Sửa lỗi nhỏ

### Version 1.0.9
- 🚀 Phiên bản ổn định đầu tiên
- ✨ Hỗ trợ copy sản phẩm từ Shopee
- 🔄 Đồng bộ với Copee web app

## Hỗ trợ

- Website: [https://app.copee.vn](https://app.copee.vn)
- Email: support@copee.vn
- Documentation: [app.copee.vn/docs](https://app.copee.vn/docs)

## Giấy phép

Copyright © 2024 Copee. All rights reserved.

## Lưu ý quan trọng

- Extension này không liên kết với Shopee
- Chỉ sao chép thông tin sản phẩm công khai
- Người dùng chịu trách nhiệm về việc sử dụng dữ liệu sản phẩm
- Tuân thủ điều khoản sử dụng của Shopee và luật bản quyền

---

Made with ❤️ by Copee Team
