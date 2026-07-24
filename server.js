// ===== HUST BANHMI 3D - MULTIPLAYER SERVER =====
// Express + Socket.io server: quản lý phòng (room), đồng bộ vị trí người chơi,
// đồng bộ sự kiện game (bán hàng, doanh thu, leaderboard), trạm chế biến
// co-op (2 người 1 xe bánh mì), emote/chat bubble, và cơ chế "trêu chọc" (stun).

const path = require('path');
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'Public')));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

const PORT = process.env.PORT || 3000;
const TICK_MS = 50; // 20Hz
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Bỏ ký tự dễ nhầm (I, O, 0, 1)
const TEASE_COOLDOWN_MS = 3000;
const TEASE_MAX_DIST = 3.5; // đơn vị world, kiểm tra lỏng lẻo (client-authoritative pos)

// ===== ROOM STATE =====
// rooms: Map<roomCode, {
//   code, players: Map<socketId, {id, nickname, pos, rotY, earned}>,
//   totalMoney, day, cartStation: {cook, assembler, meatReady}, createdAt
// }>
const rooms = new Map();

function generateRoomCode() {
  let code;
  do {
    const len = 4 + Math.floor(Math.random() * 3); // 4-6 ký tự
    code = '';
    for (let i = 0; i < len; i++) {
      code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
    }
  } while (rooms.has(code));
  return code;
}

function getRoom(code) { return rooms.get(code); }

function createRoom() {
  const code = generateRoomCode();
  const room = {
    code,
    players: new Map(),
    totalMoney: 0,
    day: 1,
    cartStation: { cook: null, assembler: null, meatReady: false },
    lastTease: new Map(), // socketId -> timestamp of last tease sent
    createdAt: Date.now(),
  };
  rooms.set(code, room);
  return room;
}

function roomPlayerList(room) {
  return Array.from(room.players.values()).map((p) => ({
    id: p.id, nickname: p.nickname, pos: p.pos, rotY: p.rotY,
  }));
}

function roomLeaderboard(room) {
  return Array.from(room.players.values())
    .map((p) => ({ id: p.id, nickname: p.nickname, earned: p.earned || 0 }))
    .sort((a, b) => b.earned - a.earned);
}

function cleanupEmptyRoom(room) {
  if (room.players.size === 0) rooms.delete(room.code);
}

function clearStationRole(room, socketId) {
  let changed = false;
  if (room.cartStation.cook === socketId) { room.cartStation.cook = null; changed = true; }
  if (room.cartStation.assembler === socketId) { room.cartStation.assembler = null; changed = true; }
  if (changed) room.cartStation.meatReady = false;
  return changed;
}

// ===== SOCKET.IO EVENTS =====
io.on('connection', (socket) => {
  let currentRoomCode = null;

  socket.on('room:create', (payload = {}, cb) => {
    const nickname = sanitizeNickname(payload.nickname);
    const room = createRoom();
    joinRoom(room, nickname);
    if (typeof cb === 'function') {
      cb({ ok: true, roomCode: room.code, players: roomPlayerList(room), leaderboard: roomLeaderboard(room) });
    }
  });

  socket.on('room:join', (payload = {}, cb) => {
    const code = String(payload.roomCode || '').trim().toUpperCase();
    const nickname = sanitizeNickname(payload.nickname);
    const room = getRoom(code);
    if (!room) {
      if (typeof cb === 'function') cb({ ok: false, error: 'Không tìm thấy phòng. Kiểm tra lại mã phòng.' });
      return;
    }
    joinRoom(room, nickname);
    if (typeof cb === 'function') {
      cb({
        ok: true, roomCode: room.code, players: roomPlayerList(room),
        totalMoney: room.totalMoney, day: room.day,
        cartStation: room.cartStation, leaderboard: roomLeaderboard(room),
      });
    }
  });

  function joinRoom(room, nickname) {
    currentRoomCode = room.code;
    socket.join(room.code);

    const player = {
      id: socket.id, nickname,
      pos: { x: 0, y: 1.7, z: 5 }, rotY: 0, earned: 0,
    };
    room.players.set(socket.id, player);

    socket.to(room.code).emit('player:joined', player);

    socket.emit('room:state', {
      roomCode: room.code, totalMoney: room.totalMoney, day: room.day,
      cartStation: room.cartStation, leaderboard: roomLeaderboard(room),
    });
  }

  // ===== POSITION SYNC =====
  socket.on('player:move', (data) => {
    if (!currentRoomCode) return;
    const room = getRoom(currentRoomCode);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player) return;
    if (data && typeof data.x === 'number' && typeof data.y === 'number' && typeof data.z === 'number') {
      player.pos.x = data.x; player.pos.y = data.y; player.pos.z = data.z;
    }
    if (data && typeof data.rotY === 'number') player.rotY = data.rotY;
  });

  // ===== GAME / REVENUE EVENTS =====
  socket.on('game:orderCompleted', (data = {}) => {
    if (!currentRoomCode) return;
    const room = getRoom(currentRoomCode);
    if (!room) return;
    const player = room.players.get(socket.id);
    const earned = Math.max(0, Math.floor(Number(data.earned) || 0));
    room.totalMoney += earned;
    if (player) player.earned = (player.earned || 0) + earned;

    // Đơn hàng hoàn thành tiêu thụ trạng thái "thịt đã nướng" của trạm co-op
    room.cartStation.meatReady = false;

    io.to(room.code).emit('game:revenueUpdate', {
      earned, totalMoney: room.totalMoney,
      by: player ? player.nickname : 'Ẩn danh',
      recipeName: data.recipeName || '',
    });
    io.to(room.code).emit('game:leaderboard', { players: roomLeaderboard(room) });
    io.to(room.code).emit('cart:stationUpdate', room.cartStation);
  });

  socket.on('game:dayAdvanced', (data = {}) => {
    if (!currentRoomCode) return;
    const room = getRoom(currentRoomCode);
    if (!room) return;
    if (typeof data.day === 'number') room.day = data.day;
    io.to(room.code).emit('game:dayUpdate', { day: room.day });
  });

  // ===== CO-OP CART STATION =====
  // Người chơi bấm vào xe -> xin một vai trò (cook hoặc assembler).
  socket.on('cart:join', (data = {}, cb) => {
    if (!currentRoomCode) { if (cb) cb({ ok: false }); return; }
    const room = getRoom(currentRoomCode);
    if (!room) { if (cb) cb({ ok: false }); return; }
    const st = room.cartStation;
    let role = null;

    if (st.cook === socket.id || st.assembler === socket.id) {
      role = st.cook === socket.id ? 'cook' : 'assembler';
    } else if (!st.cook) {
      st.cook = socket.id; role = 'cook';
    } else if (!st.assembler) {
      st.assembler = socket.id; role = 'assembler';
    }

    io.to(room.code).emit('cart:stationUpdate', st);
    if (typeof cb === 'function') cb({ ok: !!role, role, station: st });
  });

  socket.on('cart:leave', () => {
    if (!currentRoomCode) return;
    const room = getRoom(currentRoomCode);
    if (!room) return;
    if (clearStationRole(room, socket.id)) {
      io.to(room.code).emit('cart:stationUpdate', room.cartStation);
    }
  });

  // Cook báo hiệu đã nướng xong thịt/trứng -> mở khóa cho assembler ráp bánh
  socket.on('cart:cookMeat', () => {
    if (!currentRoomCode) return;
    const room = getRoom(currentRoomCode);
    if (!room) return;
    if (room.cartStation.cook !== socket.id) return; // chỉ cook mới được báo
    room.cartStation.meatReady = true;
    io.to(room.code).emit('cart:stationUpdate', room.cartStation);
  });

  // ===== EMOTES =====
  socket.on('player:emote', (data = {}) => {
    if (!currentRoomCode) return;
    const room = getRoom(currentRoomCode);
    if (!room) return;
    const player = room.players.get(socket.id);
    const type = String(data.type || '').slice(0, 20);
    if (!type) return;
    io.to(room.code).emit('player:emote', {
      id: socket.id, nickname: player ? player.nickname : 'Ẩn danh', type,
    });
  });

  // ===== VERSUS: TRÊU CHỌC (STUN) =====
  socket.on('player:tease', (data = {}) => {
    if (!currentRoomCode) return;
    const room = getRoom(currentRoomCode);
    if (!room) return;
    const targetId = data.targetId;
    const target = room.players.get(targetId);
    const me = room.players.get(socket.id);
    if (!target || !me || targetId === socket.id) return;

    const now = Date.now();
    const last = room.lastTease.get(socket.id) || 0;
    if (now - last < TEASE_COOLDOWN_MS) return; // chống spam
    const dx = target.pos.x - me.pos.x, dz = target.pos.z - me.pos.z;
    const dist = Math.sqrt(dx*dx + dz*dz);
    if (dist > TEASE_MAX_DIST) return; // quá xa, bỏ qua (kiểm tra lỏng, tin client pos)

    room.lastTease.set(socket.id, now);
    io.to(targetId).emit('player:stunned', { by: me.nickname, durationMs: 2000 });
  });

  // ===== CHAT =====
  socket.on('chat:message', (data = {}) => {
    if (!currentRoomCode) return;
    const room = getRoom(currentRoomCode);
    if (!room) return;
    const player = room.players.get(socket.id);
    const text = String(data.text || '').slice(0, 200).trim();
    if (!text) return;

    io.to(room.code).emit('chat:message', {
      id: socket.id, nickname: player ? player.nickname : 'Ẩn danh',
      text, time: Date.now(),
    });
  });

  // ===== DISCONNECT =====
  socket.on('disconnect', () => {
    if (!currentRoomCode) return;
    const room = getRoom(currentRoomCode);
    if (!room) return;
    room.players.delete(socket.id);
    room.lastTease.delete(socket.id);
    const stationChanged = clearStationRole(room, socket.id);
    socket.to(room.code).emit('player:left', { id: socket.id });
    if (stationChanged) socket.to(room.code).emit('cart:stationUpdate', room.cartStation);
    cleanupEmptyRoom(room);
  });
});

// ===== BROADCAST LOOP (20Hz tickrate) =====
setInterval(() => {
  for (const room of rooms.values()) {
    if (room.players.size === 0) continue;
    io.to(room.code).emit('players:sync', roomPlayerList(room));
  }
}, TICK_MS);

function sanitizeNickname(name) {
  const clean = String(name || '').trim().slice(0, 20);
  return clean || 'Khách' + Math.floor(Math.random() * 1000);
}

server.listen(PORT, () => {
  console.log(`🛺 HUST BANHMI 3D server đang chạy tại http://localhost:${PORT}`);
  console.log(`   Dùng "ipconfig" (Windows) hoặc "ifconfig" (Mac/Linux) để lấy IP LAN`);
  console.log(`   và cho bạn bè cùng mạng Wi-Fi truy cập http://<IP_CUA_BAN>:${PORT}`);
});
