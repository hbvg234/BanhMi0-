// ===== HUST BANHMI 3D NETWORK =====
// Kết nối Socket.io client: tạo/tham gia phòng, đồng bộ vị trí người chơi
// khác (lerp mượt + nhấp nhô khi đi bộ), leaderboard, trạm co-op, emote
// bubble, cơ chế "trêu chọc" (stun), và chat theo phòng.

const Network = (function(){
  'use strict';
  const { lerp, lerpAngle } = Engine;

  let socket = null;
  let myNickname = '';
  let myRoomCode = null;
  let connected = false;

  // remoteId -> {
  //   nickname, avatar, cur:{x,y,z,rotY}, target:{x,y,z,rotY},
  //   nametagEl, emoteEl, emoteUntil, bobPhase, moving
  // }
  const remotePlayers = new Map();
  let nextColorIndex = 0;

  const listeners = {
    revenueUpdate: [], dayUpdate: [], chatMessage: [],
    playerJoined: [], playerLeft: [], connectError: [],
    leaderboard: [], stationUpdate: [], stunned: [], emote: [],
  };

  function on(eventName, handler) {
    if(listeners[eventName]) listeners[eventName].push(handler);
  }
  function emitLocal(eventName, data) {
    if(listeners[eventName]) listeners[eventName].forEach(fn => fn(data));
  }

  function ensureSocket() {
    if(socket) return socket;
    socket = io({ transports: ['websocket', 'polling'] });

    socket.on('connect', () => { connected = true; });
    socket.on('disconnect', () => { connected = false; });
    socket.on('connect_error', (err) => emitLocal('connectError', err));

    socket.on('player:joined', (player) => {
      if(player.id === socket.id) return;
      addRemotePlayer(player);
      emitLocal('playerJoined', player);
    });

    socket.on('player:left', ({ id }) => {
      removeRemotePlayer(id);
      emitLocal('playerLeft', { id });
    });

    socket.on('players:sync', (players) => {
      const seenIds = new Set();
      for(const p of players) {
        if(p.id === socket.id) continue;
        seenIds.add(p.id);
        if(!remotePlayers.has(p.id)) addRemotePlayer(p);
        const rp = remotePlayers.get(p.id);
        if(rp) {
          const dx = p.pos.x - rp.target.x, dz = p.pos.z - rp.target.z;
          rp.moving = (dx*dx + dz*dz) > 0.0004; // di chuyển đủ nhiều để bob
          rp.target.x = p.pos.x; rp.target.y = p.pos.y; rp.target.z = p.pos.z;
          rp.target.rotY = p.rotY;
        }
      }
      for(const id of Array.from(remotePlayers.keys())) {
        if(!seenIds.has(id)) removeRemotePlayer(id);
      }
    });

    socket.on('game:revenueUpdate', (data) => emitLocal('revenueUpdate', data));
    socket.on('game:dayUpdate', (data) => emitLocal('dayUpdate', data));
    socket.on('game:leaderboard', (data) => emitLocal('leaderboard', data));
    socket.on('chat:message', (data) => emitLocal('chatMessage', data));
    socket.on('cart:stationUpdate', (data) => emitLocal('stationUpdate', data));
    socket.on('player:stunned', (data) => emitLocal('stunned', data));

    socket.on('player:emote', (data) => {
      emitLocal('emote', data);
      if(data.id !== socket.id) showRemoteEmote(data.id, data.type);
    });

    return socket;
  }

  function addRemotePlayer(player) {
    if(remotePlayers.has(player.id)) return;
    const avatar = GameMap.createRemotePlayerAvatar(nextColorIndex++);
    const nametagEl = document.createElement('div');
    nametagEl.className = 'nametag';
    nametagEl.textContent = player.nickname || 'Ẩn danh';
    const layer = document.getElementById('nametag-layer');
    if(layer) layer.appendChild(nametagEl);

    const emoteEl = document.createElement('div');
    emoteEl.className = 'emote-bubble';
    emoteEl.style.display = 'none';
    if(layer) layer.appendChild(emoteEl);

    remotePlayers.set(player.id, {
      nickname: player.nickname,
      avatar,
      cur: { x: player.pos.x, y: player.pos.y, z: player.pos.z, rotY: player.rotY || 0 },
      target: { x: player.pos.x, y: player.pos.y, z: player.pos.z, rotY: player.rotY || 0 },
      nametagEl, emoteEl, emoteUntil: 0,
      bobPhase: Math.random() * 10, moving: false,
    });
  }

  function removeRemotePlayer(id) {
    const rp = remotePlayers.get(id);
    if(!rp) return;
    rp.avatar.dispose();
    if(rp.nametagEl && rp.nametagEl.parentNode) rp.nametagEl.parentNode.removeChild(rp.nametagEl);
    if(rp.emoteEl && rp.emoteEl.parentNode) rp.emoteEl.parentNode.removeChild(rp.emoteEl);
    remotePlayers.delete(id);
  }

  const EMOTE_ICONS = { heart:'❤️', angry:'😡', cry:'😭', gg:'👏 GG' };

  function showRemoteEmote(id, type) {
    const rp = remotePlayers.get(id);
    if(!rp) return;
    rp.emoteEl.textContent = EMOTE_ICONS[type] || '💬';
    rp.emoteEl.style.display = 'block';
    rp.emoteUntil = performance.now() + 3000;
  }

  // Gọi mỗi frame: lerp vị trí + xoay, nhấp nhô khi di chuyển, cập nhật nametag/emote
  function updateRemotePlayers(dt, camera) {
    const t = Math.min(1, dt * 10);
    const now = performance.now();
    for(const rp of remotePlayers.values()) {
      rp.cur.x = lerp(rp.cur.x, rp.target.x, t);
      rp.cur.y = lerp(rp.cur.y, rp.target.y, t);
      rp.cur.z = lerp(rp.cur.z, rp.target.z, t);
      rp.cur.rotY = lerpAngle(rp.cur.rotY, rp.target.rotY, t);

      let bobY = 0;
      if(rp.moving) {
        rp.bobPhase += dt * 9;
        bobY = Math.abs(Math.sin(rp.bobPhase)) * 0.06;
      }

      rp.avatar.setPosition(rp.cur.x, rp.cur.y + bobY, rp.cur.z);
      rp.avatar.setRotationY(rp.cur.rotY);

      if(rp.nametagEl) {
        const headPos = new Engine.Vec3(rp.cur.x, rp.cur.y + 1.9 + bobY, rp.cur.z);
        const screen = Renderer.worldToScreen(headPos, camera);
        if(screen && screen.x > -50 && screen.x < window.innerWidth+50 && screen.y > -50 && screen.y < window.innerHeight+50) {
          rp.nametagEl.style.display = 'block';
          rp.nametagEl.style.left = screen.x + 'px';
          rp.nametagEl.style.top = screen.y + 'px';
          if(rp.emoteEl.style.display === 'block') {
            if(now > rp.emoteUntil) { rp.emoteEl.style.display = 'none'; }
            else {
              rp.emoteEl.style.left = screen.x + 'px';
              rp.emoteEl.style.top = (screen.y - 26) + 'px';
            }
          }
        } else {
          rp.nametagEl.style.display = 'none';
          rp.emoteEl.style.display = 'none';
        }
      }
    }
  }

  // ===== ROOM ACTIONS =====
  function createRoom(nickname, cb) {
    myNickname = nickname;
    ensureSocket();
    const send = () => {
      socket.emit('room:create', { nickname }, (res) => {
        if(res && res.ok) myRoomCode = res.roomCode;
        cb(res);
      });
    };
    if(socket.connected) send(); else socket.once('connect', send);
  }

  function joinRoom(nickname, roomCode, cb) {
    myNickname = nickname;
    ensureSocket();
    const send = () => {
      socket.emit('room:join', { nickname, roomCode }, (res) => {
        if(res && res.ok) myRoomCode = res.roomCode;
        cb(res);
      });
    };
    if(socket.connected) send(); else socket.once('connect', send);
  }

  // ===== POSITION SYNC (throttled ~20Hz) =====
  let lastSentAt = 0;
  function sendMove(x, y, z, rotY) {
    if(!socket || !connected) return;
    const now = performance.now();
    if(now - lastSentAt < 45) return;
    lastSentAt = now;
    socket.emit('player:move', { x, y, z, rotY });
  }

  function sendOrderCompleted(earned, recipeName) {
    if(!socket || !connected) return;
    socket.emit('game:orderCompleted', { earned, recipeName });
  }
  function sendDayAdvanced(day) {
    if(!socket || !connected) return;
    socket.emit('game:dayAdvanced', { day });
  }
  function sendChat(text) {
    if(!socket || !connected) return;
    socket.emit('chat:message', { text });
  }
  function sendEmote(type) {
    if(!socket || !connected) return;
    socket.emit('player:emote', { type });
  }
  function sendTease(targetId) {
    if(!socket || !connected) return;
    socket.emit('player:tease', { targetId });
  }

  // ===== CO-OP CART STATION =====
  function joinCartStation(cb) {
    if(!socket || !connected) { if(cb) cb({ ok:false }); return; }
    socket.emit('cart:join', {}, cb || function(){});
  }
  function leaveCartStation() {
    if(!socket || !connected) return;
    socket.emit('cart:leave');
  }
  function cookMeat() {
    if(!socket || !connected) return;
    socket.emit('cart:cookMeat');
  }

  // Tìm người chơi khác gần nhất trong bán kính maxDist (dùng cho nút "Trêu chọc")
  function getNearbyPlayer(camera, maxDist) {
    let closest = null, closestDist = Infinity;
    for(const [id, rp] of remotePlayers.entries()) {
      const dx = rp.cur.x - camera.pos.x, dz = rp.cur.z - camera.pos.z;
      const d = Math.sqrt(dx*dx + dz*dz);
      if(d < maxDist && d < closestDist) { closestDist = d; closest = { id, nickname: rp.nickname, distance: d }; }
    }
    return closest;
  }

  // Vị trí hiện tại (đã lerp) của người chơi khác - dùng để vẽ blob shadow
  function getRemotePlayerPositions() {
    const out = [];
    for(const rp of remotePlayers.values()) out.push({ x: rp.cur.x, z: rp.cur.z });
    return out;
  }

  function getRoomCode() { return myRoomCode; }
  function isConnected() { return connected; }
  function getMyId() { return socket ? socket.id : null; }
  function getPlayerCount() { return remotePlayers.size + 1; }

  return {
    on, createRoom, joinRoom, sendMove, sendOrderCompleted, sendDayAdvanced,
    sendChat, sendEmote, sendTease, joinCartStation, leaveCartStation, cookMeat,
    updateRemotePlayers, getNearbyPlayer, getRemotePlayerPositions,
    getRoomCode, isConnected, getMyId, getPlayerCount,
  };
})();

window.Network = Network;
