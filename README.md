# 🛺 HUST BANHMI 3D — Multiplayer

Game 3D low-poly bán bánh mì, chạy bằng custom WebGL rendering engine (không
dùng Three.js). Phiên bản này hỗ trợ chơi **multiplayer** cùng bạn bè qua
LAN (Wi-Fi chung) hoặc online qua Internet, trên cả điện thoại và máy tính.

## 📁 Cấu trúc dự án

```
hust-banhmi-3d/
├── package.json
├── .gitignore
├── server.js              # Express + Socket.io server, quản lý phòng
├── README.md
└── public/
    ├── index.html
    ├── css/style.css
    └── js/
        ├── engine.js       # Vec3, Mat4, Camera, MeshBuilder, Raycast
        ├── map.js           # Bản đồ 3D, Collision, avatar người chơi khác
        ├── renderer.js       # WebGL shader & render loop
        ├── network.js        # Socket.io client: phòng, đồng bộ, chat
        └── game.js            # Game state, UI, joystick, crafting
```

## ▶️ Chạy Local

Yêu cầu: [Node.js](https://nodejs.org) >= 16.

```bash
cd hust-banhmi-3d
npm install
npm start
```

Mở trình duyệt tại: `http://localhost:3000`

## 📶 Chơi chung LAN (cùng Wi-Fi)

1. Chạy server như trên trên máy tính của bạn (máy chủ).
2. Lấy địa chỉ IP LAN của máy chủ:
   - **Windows**: mở CMD, gõ `ipconfig`, tìm dòng `IPv4 Address` (thường dạng `192.168.x.x`).
   - **Mac/Linux**: mở Terminal, gõ `ifconfig` (hoặc `ip addr`), tìm địa chỉ trong dải `192.168.x.x` hoặc `10.x.x.x`.
3. Đảm bảo điện thoại/máy tính của bạn bè **cùng mạng Wi-Fi** với máy chủ.
4. Trên điện thoại/máy khác, mở trình duyệt và truy cập:
   `http://<IP_MÁY_CHỦ>:3000` (ví dụ: `http://192.168.1.5:3000`)
5. Một người **[TẠO PHÒNG MỚI]** để lấy mã phòng (VD: `HUST88`), rồi gửi mã đó
   cho bạn bè. Những người khác nhập mã vào ô **[NHẬP MÃ PHÒNG]** và bấm **VÀO**.

> Lưu ý: nếu không kết nối được, kiểm tra Firewall trên máy chủ có đang chặn
> cổng `3000` không (Windows Defender Firewall → Allow an app).

## 🌍 Deploy online để chơi từ xa

### Render.com (miễn phí)
1. Đưa code lên GitHub (xem hướng dẫn bên dưới).
2. Vào [render.com](https://render.com) → **New** → **Web Service** → chọn repo GitHub.
3. Cấu hình:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
4. Bấm **Create Web Service**, đợi deploy xong, Render sẽ cấp một URL dạng
   `https://ten-app.onrender.com` — gửi link này cho bạn bè để chơi từ bất kỳ đâu.

### Railway.app (miễn phí có giới hạn)
1. Đưa code lên GitHub.
2. Vào [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**.
3. Railway tự nhận diện Node.js, dùng `npm start` làm start command (có thể chỉnh trong **Settings**).
4. Sau khi deploy, vào **Settings → Networking** để tạo domain public, rồi gửi link cho bạn bè.

## ⬆️ Đưa code lên GitHub

```bash
cd hust-banhmi-3d
git init
git add .
git commit -m "HUST BANHMI 3D - multiplayer"
git branch -M main
git remote add origin https://github.com/<username>/<ten-repo>.git
git push -u origin main
```

## 🎮 Cách chơi

- **Joystick trái**: di chuyển.
- **Vuốt bên phải màn hình**: xoay camera.
- **Nút tương tác (🥖/👋)**: đến gần xe bánh mì để chế biến đơn hàng.
- **Mã phòng**: hiển thị góc trên HUD khi đang chơi, gửi cho bạn bè để họ vào cùng phòng.
- **Chat**: bấm nút 💬 góc dưới trái để mở khung chat trong phòng.
- Doanh thu (💰) được **cộng chung cho cả phòng** và đồng bộ realtime giữa mọi người chơi.

## ✨ Tính năng mới (v2.1 — Graphics & Social Upgrade)

**Đồ họa & VFX**
- Hệ hạt (particle system) tự viết: khói bay từ lò nướng, sparkle khi hoàn thành đơn, tim bay khi khách hài lòng.
- Chu kỳ Ngày/Đêm thời gian thực: bầu trời, sương mù (fog) và ánh sáng ambient thay đổi liên tục; đèn đường & lửa xe bánh mì tự "sáng lên" (glow sprite) khi trời tối.
- View bobbing: camera rung nhẹ khi đi bộ; người chơi khác cũng nhấp nhô khi di chuyển.
- Blob shadow: bóng đổ mờ dưới chân nhân vật và dưới xe bánh mì.

**Multiplayer vui nhộn**
- **Emote**: bấm nút 😀 để gửi ❤️ / 😡 / 😭 / 👏GG, hiện bong bóng nổi trên đầu nhân vật trong 3 giây.
- **Co-op nướng bánh**: khi phòng có ≥2 người, xe bánh mì trở thành trạm 2 vai trò — Đầu bếp (nướng thịt/trứng) và Người ráp bánh (chọn đúng món & giao cho khách). Chơi một mình vẫn dùng luồng gốc (không cần trạm).
- **Trêu chọc (Versus)**: đứng gần người chơi khác sẽ hiện nút "😝 Trêu", bấm để làm đối phương choáng (stun) 2 giây.
- **Bảng xếp hạng (Leaderboard)**: góc trên phải hiển thị doanh thu từng người trong phòng, tự sắp xếp người dẫn đầu.

**UI/UX & Âm thanh**
- Font "Baloo 2" phong cách trẻ trung, năng động cho tiêu đề và nút bấm.
- Âm thanh giả lập bằng Web Audio API (không cần file audio ngoài): tiếng "xèo xèo" khi nướng thịt, tiếng "ting" khi nhận tiền.

## ⚙️ Chi tiết kỹ thuật

- **Tickrate**: server broadcast vị trí người chơi ở 20Hz (mỗi 50ms).
- **Nội suy (interpolation)**: client dùng lerp để làm mượt chuyển động của
  người chơi khác, tránh giật khi nhận dữ liệu vị trí.
- **Room code**: 4-6 ký tự in hoa, tự sinh ngẫu nhiên khi tạo phòng.
- Khi một người chơi ngắt kết nối, server tự động xóa avatar của họ khỏi
  phòng và báo cho những người còn lại.
