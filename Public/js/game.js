// ===== HUST BANHMI 3D GAME =====
// Logic game: di chuyển (với view bobbing), tương tác, nhiệm vụ, crafting
// co-op, hiệu ứng hạt (khói/sparkle/tim), Day/Night, emote, trêu chọc (stun),
// bảng xếp hạng, và âm thanh giả lập qua Web Audio API.

(function(){
  'use strict';
  // KHÔNG destructure Engine ở top-level: nếu engine.js lỗi/chưa nạp, dòng
  // này sẽ throw ngay và DOMContentLoaded/init() sẽ không bao giờ được đăng
  // ký -> toàn bộ nút bấm im lặng không phản hồi. Gán an toàn bên trong init().
  let Vec3, Camera, Ray;

  // ===== STATE =====
  const state = {
    money: 0,          // Doanh thu CHUNG của cả phòng (đồng bộ qua server)
    reputation: 100,
    day: 1,
    customersServed: 0,
    dayCustomers: 0,
    isPlaying: false,
    inDialog: false,
    inCrafting: false,
    currentCustomer: null,
    currentOrder: null,
    nickname: '',
    roomCode: null,
    cartRole: null,        // null | 'cook' | 'assembler' (chỉ dùng khi có >=2 người)
    cartStationSnapshot: { cook: null, assembler: null, meatReady: false },
    stunned: false,
  };

  let camera = null;
  let scene = null;
  let interactables = [];
  let particles = null;

  // Input
  let joystickActive = false;
  let joystickDX = 0, joystickDY = 0;
  let touchStartX = 0, touchStartY = 0;
  let isTouchingScreen = false;
  let lookDX = 0, lookDY = 0;

  // Movement / view bobbing
  const MOVE_SPEED = 0.08;
  const LOOK_SENSITIVITY = 0.003;
  const PLAYER_RADIUS = 0.4;
  const EYE_HEIGHT = 1.7;
  let bobPhase = 0;
  let bobAmount = 0;

  // Day/Night cycle
  const DAYNIGHT_CYCLE_SECONDS = 150; // 1 vòng ngày-đêm demo = 150s thực
  let dayNightTimer = 45; // bắt đầu giữa buổi sáng cho đẹp
  let nightFactor = 0; // 0 = giữa trưa, 1 = nửa đêm
  const DAY_SKY = [138, 168, 198];
  const NIGHT_SKY = [14, 12, 26];

  // Particle emission timers
  let smokeTimer = 0;

  // Recipes
  const RECIPES = [
    { id:'thapcam', name:'Bánh Mì Thập Cẩm', price:25000, ingredients:['bread','pate','meat','cucumber','carrot','cilantro','sauce'], time:5 },
    { id:'thuong', name:'Bánh Mì Thường', price:12000, ingredients:['bread','pate','cucumber','cilantro'], time:3 },
    { id:'trung', name:'Bánh Mì Trứng', price:18000, ingredients:['bread','butter','egg','cucumber','cilantro'], time:4 },
    { id:'cha', name:'Bánh Mì Chả', price:20000, ingredients:['bread','pate','meat','cucumber','cilantro','chili'], time:4 },
    { id:'dacbiet', name:'Bánh Mì Đặc Biệt', price:35000, ingredients:['bread','pate','meat','egg','cucumber','carrot','cilantro','chili','sauce'], time:7 },
  ];

  // Customers
  const CUSTOMERS = [
    { avatar:'👨‍🎓', name:'Sinh viên Bách Khoa', patience:15 },
    { avatar:'👩‍💼', name:'Cô giáo', patience:12 },
    { avatar:'👷', name:'Anh thợ xây', patience:10 },
    { avatar:'👵', name:'Bà cụ', patience:18 },
    { avatar:'🧑‍🍳', name:'Đầu bếp', patience:11 },
    { avatar:'👧', name:'Học sinh', patience:14 },
    { avatar:'🧔', name:'Anh Grab', patience:9 },
    { avatar:'👩‍🔬', name:'Nhà khoa học', patience:16 },
  ];

  // ===== SOUND EFFECTS (Web Audio API, không dùng file ngoài) =====
  const SFX = (function(){
    let ctx = null;
    function ensureCtx() {
      if(!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if(AC) ctx = new AC();
      }
      if(ctx && ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    function playSizzle(duration = 1.2) {
      const c = ensureCtx();
      if(!c) return;
      const bufferSize = Math.floor(c.sampleRate * duration);
      const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
      const data = buffer.getChannelData(0);
      for(let i=0;i<bufferSize;i++) data[i] = (Math.random()*2-1) * 0.7;
      const src = c.createBufferSource();
      src.buffer = buffer;
      const filter = c.createBiquadFilter();
      filter.type = 'bandpass'; filter.frequency.value = 3200; filter.Q.value = 0.6;
      const gain = c.createGain();
      const t0 = c.currentTime;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(0.3, t0 + 0.1);
      gain.gain.linearRampToValueAtTime(0.22, t0 + duration*0.6);
      gain.gain.linearRampToValueAtTime(0.0001, t0 + duration);
      src.connect(filter); filter.connect(gain); gain.connect(c.destination);
      src.start(t0); src.stop(t0 + duration);
    }
    function playTing() {
      const c = ensureCtx();
      if(!c) return;
      [880, 1318.5].forEach((freq, i) => {
        const osc = c.createOscillator();
        osc.type = 'sine'; osc.frequency.value = freq;
        const gain = c.createGain();
        const t0 = c.currentTime + i * 0.09;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.linearRampToValueAtTime(0.28, t0 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
        osc.connect(gain); gain.connect(c.destination);
        osc.start(t0); osc.stop(t0 + 0.55);
      });
    }
    function playPop() {
      const c = ensureCtx();
      if(!c) return;
      const osc = c.createOscillator();
      osc.type = 'triangle'; osc.frequency.setValueAtTime(500, c.currentTime);
      osc.frequency.exponentialRampToValueAtTime(120, c.currentTime + 0.15);
      const gain = c.createGain();
      gain.gain.setValueAtTime(0.25, c.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.16);
      osc.connect(gain); gain.connect(c.destination);
      osc.start(); osc.stop(c.currentTime + 0.17);
    }
    return { ensureCtx, playSizzle, playTing, playPop };
  })();

  // ===== DOM =====
  const canvas = document.getElementById('game-canvas');
  const loadingScreen = document.getElementById('loading-screen');
  const startScreen = document.getElementById('start-screen');
  const helpScreen = document.getElementById('help-screen');
  const hud = document.getElementById('hud');
  const hudMoney = document.getElementById('hud-money');
  const hudRep = document.getElementById('hud-rep');
  const hudDay = document.getElementById('hud-day');
  const hudRoomCode = document.getElementById('hud-room-code');
  const interactionPrompt = document.getElementById('interaction-prompt');
  const promptText = document.getElementById('prompt-text');
  const dialogBox = document.getElementById('dialog-box');
  const dialogAvatar = document.getElementById('dialog-avatar');
  const dialogName = document.getElementById('dialog-name');
  const dialogText = document.getElementById('dialog-text');
  const dialogOptions = document.getElementById('dialog-options');
  const craftingUI = document.getElementById('crafting-ui');
  const craftingTitle = document.getElementById('crafting-title');
  const craftRoleBanner = document.getElementById('craft-role-banner');
  const craftCookPanel = document.getElementById('craft-cook-panel');
  const craftingRecipes = document.getElementById('crafting-recipes');
  const notification = document.getElementById('notification');
  const notifText = document.getElementById('notif-text');
  const joystickZone = document.getElementById('joystick-zone');
  const joystickKnob = document.getElementById('joystick-knob');
  const btnAction = document.getElementById('btn-action');

  // Multiplayer UI
  const inputNickname = document.getElementById('input-nickname');
  const inputRoomCode = document.getElementById('input-room-code');
  const btnCreateRoom = document.getElementById('btn-create-room');
  const btnJoinRoom = document.getElementById('btn-join-room');
  const mpError = document.getElementById('mp-error');
  const mpStatus = document.getElementById('mp-status');

  // Chat UI
  const chatBox = document.getElementById('chat-box');
  const chatToggle = document.getElementById('chat-toggle');
  const chatLog = document.getElementById('chat-log');
  const chatForm = document.getElementById('chat-form');
  const chatInput = document.getElementById('chat-input');

  // Leaderboard / emote / tease / stun UI
  const leaderboardList = document.getElementById('leaderboard-list');
  const emoteBar = document.getElementById('emote-bar');
  const btnEmoteToggle = document.getElementById('btn-emote-toggle');
  const teaseBtn = document.getElementById('tease-btn');
  const teaseTargetName = document.getElementById('tease-target-name');
  const stunOverlay = document.getElementById('stun-overlay');
  const stunText = document.getElementById('stun-text');

  // ===== INIT =====
  function init() {
    setupUI();

    if (typeof Engine === 'undefined') { alert('Lỗi: không tải được engine.js.'); return; }
    if (typeof GameMap === 'undefined') { alert('Lỗi: không tải được map.js.'); return; }
    if (typeof Renderer === 'undefined') { alert('Lỗi: không tải được renderer.js.'); return; }
    if (typeof Network === 'undefined') { alert('Lỗi: không tải được network.js.'); return; }

    ({ Vec3, Camera, Ray } = Engine);
    camera = new Camera();
    camera.pos.set(0, EYE_HEIGHT, 5);
    camera.rotY = Math.PI;
    particles = new Engine.ParticleSystem();

    setupNetworkListeners();

    let loadProgress = 0;
    const loadInterval = setInterval(() => {
      loadProgress += Math.random() * 15;
      if(loadProgress >= 100) {
        loadProgress = 100;
        clearInterval(loadInterval);
        setTimeout(() => {
          loadingScreen.style.display = 'none';
          startScreen.style.display = 'flex';
        }, 300);
      }
      document.getElementById('loading-fill').style.width = loadProgress + '%';
    }, 100);

    try {
      const world = GameMap.buildWorld();
      scene = world.scene;
      interactables = world.interactables;

      if(!Renderer.init(canvas)) { alert('Trình duyệt không hỗ trợ WebGL!'); return; }

      setupEvents();
      requestAnimationFrame(gameLoop);
    } catch (err) {
      console.error('Lỗi khi khởi tạo game:', err);
      alert('Có lỗi khi tải game: ' + err.message + '\n(Mở Console trình duyệt để xem chi tiết)');
    }
  }

  function setupUI() {
    btnCreateRoom.addEventListener('click', () => handleCreateRoom());
    btnCreateRoom.addEventListener('touchstart', (e) => { e.preventDefault(); SFX.ensureCtx(); handleCreateRoom(); }, {passive:false});

    btnJoinRoom.addEventListener('click', () => handleJoinRoom());
    btnJoinRoom.addEventListener('touchstart', (e) => { e.preventDefault(); SFX.ensureCtx(); handleJoinRoom(); }, {passive:false});

    inputRoomCode.addEventListener('input', () => {
      inputRoomCode.value = inputRoomCode.value.toUpperCase();
    });

    document.getElementById('btn-help').addEventListener('click', () => {
      startScreen.style.display = 'none';
      helpScreen.style.display = 'flex';
    });
    document.getElementById('btn-back').addEventListener('click', () => {
      helpScreen.style.display = 'none';
      startScreen.style.display = 'flex';
    });

    document.getElementById('btn-close-craft').addEventListener('click', closeCrafting);
    document.getElementById('btn-close-craft').addEventListener('touchstart', (e) => { e.preventDefault(); closeCrafting(); }, {passive:false});

    // Chat
    chatToggle.addEventListener('click', () => chatBox.classList.toggle('collapsed'));
    chatToggle.addEventListener('touchstart', (e) => { e.preventDefault(); chatBox.classList.toggle('collapsed'); }, {passive:false});
    chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = chatInput.value.trim();
      if(!text) return;
      Network.sendChat(text);
      chatInput.value = '';
    });

    // Emote bar
    btnEmoteToggle.addEventListener('click', (e) => { e.stopPropagation(); emoteBar.classList.toggle('collapsed'); });
    btnEmoteToggle.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); emoteBar.classList.toggle('collapsed'); }, {passive:false});
    document.querySelectorAll('.emote-btn').forEach(btn => {
      const send = () => {
        Network.sendEmote(btn.dataset.emote);
        emoteBar.classList.add('collapsed');
        SFX.playPop();
      };
      btn.addEventListener('click', send);
      btn.addEventListener('touchstart', (e) => { e.preventDefault(); send(); }, {passive:false});
    });

    // Tease button
    const doTease = () => {
      const nearby = Network.getNearbyPlayer(camera, 3.2);
      if(!nearby) return;
      Network.sendTease(nearby.id);
      teaseBtn.style.opacity = '0.4';
      teaseBtn.style.pointerEvents = 'none';
      setTimeout(() => { teaseBtn.style.opacity = '1'; teaseBtn.style.pointerEvents = 'auto'; }, 3000);
    };
    teaseBtn.addEventListener('click', doTease);
    teaseBtn.addEventListener('touchstart', (e) => { e.preventDefault(); doTease(); }, {passive:false});
  }

  function readNickname() {
    return (inputNickname.value || '').trim().slice(0, 20);
  }

  function setMpBusy(busy) {
    btnCreateRoom.disabled = busy;
    btnJoinRoom.disabled = busy;
    mpError.textContent = '';
    mpStatus.textContent = busy ? 'Đang kết nối...' : '';
  }

  function handleCreateRoom() {
    const nickname = readNickname();
    state.nickname = nickname || 'Khách';
    setMpBusy(true);
    Network.createRoom(nickname, (res) => {
      setMpBusy(false);
      if(!res || !res.ok) {
        mpError.textContent = (res && res.error) || 'Không thể tạo phòng. Thử lại sau.';
        return;
      }
      if(res.leaderboard) renderLeaderboard(res.leaderboard);
      onRoomReady(res.roomCode);
    });
  }

  function handleJoinRoom() {
    const nickname = readNickname();
    const code = (inputRoomCode.value || '').trim().toUpperCase();
    if(!code) {
      mpError.textContent = 'Nhập mã phòng để tham gia.';
      return;
    }
    state.nickname = nickname || 'Khách';
    setMpBusy(true);
    Network.joinRoom(nickname, code, (res) => {
      setMpBusy(false);
      if(!res || !res.ok) {
        mpError.textContent = (res && res.error) || 'Không thể vào phòng. Kiểm tra lại mã phòng.';
        return;
      }
      if(typeof res.totalMoney === 'number') state.money = res.totalMoney;
      if(typeof res.day === 'number') state.day = res.day;
      if(res.cartStation) state.cartStationSnapshot = res.cartStation;
      if(res.leaderboard) renderLeaderboard(res.leaderboard);
      onRoomReady(res.roomCode);
    });
  }

  function onRoomReady(roomCode) {
    state.roomCode = roomCode;
    hudRoomCode.textContent = roomCode;
    mpStatus.textContent = `Đã vào phòng ${roomCode}!`;
    addSystemChatLine(`Bạn đã vào phòng ${roomCode} với tên "${state.nickname}"`);
    startGame();
  }

  function setupNetworkListeners() {
    Network.on('connectError', () => {
      mpError.textContent = 'Không thể kết nối tới server. Kiểm tra kết nối mạng.';
      setMpBusy(false);
    });

    Network.on('revenueUpdate', (data) => {
      state.money = data.totalMoney;
      updateHUD();
      SFX.playTing();
      const who = data.by && data.by !== state.nickname ? `${data.by} vừa bán` : 'Bạn vừa bán';
      if (data.recipeName) {
        showNotification(`💰 ${who} ${data.recipeName} +${data.earned.toLocaleString()}đ`, '#4caf50');
      }
    });

    Network.on('leaderboard', (data) => renderLeaderboard(data.players));

    Network.on('dayUpdate', (data) => {
      if(typeof data.day === 'number' && data.day > state.day) {
        state.day = data.day;
        updateHUD();
      }
    });

    Network.on('chatMessage', (data) => appendChatLine(data.nickname, data.text));

    Network.on('playerJoined', (player) => addSystemChatLine(`${player.nickname} đã vào phòng`));
    Network.on('playerLeft', () => addSystemChatLine(`Một người chơi đã rời phòng`));

    Network.on('stationUpdate', (station) => {
      state.cartStationSnapshot = station;
      if(state.inCrafting && state.cartRole) refreshCoopUI();
    });

    Network.on('stunned', (data) => {
      state.stunned = true;
      stunText.textContent = `${data.by || 'Ai đó'} vừa trêu bạn! 😵`;
      stunOverlay.style.display = 'flex';
      const dur = data.durationMs || 2000;
      setTimeout(() => {
        state.stunned = false;
        stunOverlay.style.display = 'none';
      }, dur);
    });
  }

  function appendChatLine(nickname, text) {
    const line = document.createElement('div');
    line.className = 'chat-line';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'chat-name';
    nameSpan.textContent = nickname + ':';
    line.appendChild(nameSpan);
    line.appendChild(document.createTextNode(text));
    chatLog.appendChild(line);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  function addSystemChatLine(text) {
    const line = document.createElement('div');
    line.className = 'chat-line chat-system';
    line.textContent = text;
    chatLog.appendChild(line);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  // ===== LEADERBOARD =====
  function renderLeaderboard(players) {
    if(!players) return;
    leaderboardList.innerHTML = '';
    const myId = Network.getMyId();
    players.slice(0, 8).forEach((p, idx) => {
      const row = document.createElement('div');
      row.className = 'lb-row' + (p.id === myId ? ' lb-me' : '') + (idx === 0 ? ' lb-first' : '');
      const name = document.createElement('span');
      name.className = 'lb-name';
      name.textContent = p.nickname;
      const money = document.createElement('span');
      money.className = 'lb-money';
      money.textContent = (p.earned || 0).toLocaleString();
      row.appendChild(name);
      row.appendChild(money);
      leaderboardList.appendChild(row);
    });
  }

  function startGame() {
    startScreen.style.display = 'none';
    canvas.style.display = 'block';
    hud.style.display = 'block';
    state.isPlaying = true;
    updateHUD();
    spawnCustomer();
  }

  // ===== EVENTS =====
  function setupEvents() {
    joystickZone.addEventListener('touchstart', handleJoystickStart, {passive:false});
    joystickZone.addEventListener('touchmove', handleJoystickMove, {passive:false});
    joystickZone.addEventListener('touchend', handleJoystickEnd, {passive:false});
    joystickZone.addEventListener('touchcancel', handleJoystickEnd, {passive:false});

    canvas.addEventListener('touchstart', handleLookStart, {passive:false});
    canvas.addEventListener('touchmove', handleLookMove, {passive:false});
    canvas.addEventListener('touchend', handleLookEnd, {passive:false});

    btnAction.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); SFX.ensureCtx(); doAction(); }, {passive:false});
    btnAction.addEventListener('click', (e) => { e.stopPropagation(); doAction(); });

    window.addEventListener('resize', () => Renderer.resize());
  }

  function handleJoystickStart(e) {
    e.preventDefault();
    if(e.touches.length > 0) { joystickActive = true; updateJoystick(e.touches[0]); }
  }
  function handleJoystickMove(e) {
    e.preventDefault();
    if(joystickActive && e.touches.length > 0) updateJoystick(e.touches[0]);
  }
  function handleJoystickEnd(e) {
    e.preventDefault();
    joystickActive = false; joystickDX = 0; joystickDY = 0;
    joystickKnob.style.transform = 'translate(0px,0px)';
  }
  function updateJoystick(touch) {
    const rect = joystickZone.getBoundingClientRect();
    const cx = rect.left + rect.width/2, cy = rect.top + rect.height/2;
    let dx = touch.clientX - cx, dy = touch.clientY - cy;
    const dist = Math.sqrt(dx*dx + dy*dy);
    const maxDist = 35;
    if(dist > maxDist) { dx = (dx/dist)*maxDist; dy = (dy/dist)*maxDist; }
    joystickKnob.style.transform = `translate(${dx}px,${dy}px)`;
    joystickDX = dx / maxDist; joystickDY = dy / maxDist;
  }

  function handleLookStart(e) {
    for(let i=0; i<e.touches.length; i++) {
      const t = e.touches[i];
      if(t.clientX > window.innerWidth * 0.4) {
        isTouchingScreen = true; touchStartX = t.clientX; touchStartY = t.clientY;
        break;
      }
    }
  }
  function handleLookMove(e) {
    if(!isTouchingScreen) return;
    for(let i=0; i<e.touches.length; i++) {
      const t = e.touches[i];
      if(t.clientX > window.innerWidth * 0.4) {
        lookDX = (t.clientX - touchStartX) * LOOK_SENSITIVITY;
        lookDY = (t.clientY - touchStartY) * LOOK_SENSITIVITY * 0.5;
        touchStartX = t.clientX; touchStartY = t.clientY;
        break;
      }
    }
  }
  function handleLookEnd() { isTouchingScreen = false; lookDX = 0; lookDY = 0; }

  // ===== GAME LOOP =====
  let lastTime = 0;

  function gameLoop(time) {
    const dt = Math.min((time - lastTime) / 1000, 0.05);
    lastTime = time;

    if(state.isPlaying && !state.inDialog && !state.inCrafting) update(dt);

    // Day/Night luôn tiến (kể cả khi đang ở dialog/crafting) để không giật khi thoát ra
    updateDayNight(dt);

    if(camera) Network.updateRemotePlayers(dt, camera);
    if(particles) particles.update(dt);

    if(scene) {
      const env = computeEnvironment();
      Renderer.render(scene, camera, env);
      Renderer.renderEffects(buildEffectsList(), camera);
    }

    requestAnimationFrame(gameLoop);
  }

  function updateDayNight(dt) {
    dayNightTimer = (dayNightTimer + dt) % DAYNIGHT_CYCLE_SECONDS;
    const t = dayNightTimer / DAYNIGHT_CYCLE_SECONDS;
    nightFactor = (1 - Math.cos(t * Math.PI * 2)) / 2; // 0 (trưa) -> 1 (nửa đêm) -> 0
  }

  function lerpColor(a, b, t) {
    return [
      Math.round(Engine.lerp(a[0], b[0], t)),
      Math.round(Engine.lerp(a[1], b[1], t)),
      Math.round(Engine.lerp(a[2], b[2], t)),
    ];
  }

  function computeEnvironment() {
    const sky = lerpColor(DAY_SKY, NIGHT_SKY, nightFactor);
    return {
      ambient: Engine.lerp(0.92, 0.36, nightFactor),
      fogColor: sky,
      skyColor: sky,
      fogNear: 10,
      fogFar: Engine.lerp(55, 26, nightFactor),
    };
  }

  function buildEffectsList() {
    const items = particles.getRenderItems();

    // Blob shadow dưới chân người chơi (mình)
    items.push({ kind:'disc', pos:new Vec3(camera.pos.x, 0.02, camera.pos.z), size:0.32, color:[0,0,0], alpha:0.32 });

    // Blob shadow dưới xe bánh mì
    const cartPos = GameMap.getCartPosition();
    if(cartPos) items.push({ kind:'disc', pos:new Vec3(cartPos.x, 0.02, cartPos.z), size:1.15, color:[0,0,0], alpha:0.28 });

    // Blob shadow dưới người chơi khác
    for(const rp of Network.getRemotePlayerPositions()) {
      items.push({ kind:'disc', pos:new Vec3(rp.x, 0.02, rp.z), size:0.3, color:[0,0,0], alpha:0.3 });
    }

    // Đèn sáng ban đêm (cột đèn + lửa xe bánh mì)
    if(nightFactor > 0.1) {
      const glowAlpha = Math.min(1, (nightFactor - 0.1) / 0.5);
      for(const lp of GameMap.getLampPositions()) {
        items.push({ kind:'glow', pos:new Vec3(lp.x, lp.y, lp.z), size:0.85, color:[255,225,150], alpha:glowAlpha*0.8 });
      }
      const fp = GameMap.getCartFirePosition();
      if(fp) items.push({ kind:'glow', pos:new Vec3(fp.x, fp.y+0.25, fp.z), size:0.6, color:[255,150,60], alpha:Math.max(glowAlpha,0.55) });
    }

    return items;
  }

  function update(dt) {
    // ===== Movement (bỏ qua nếu đang bị stun) =====
    let isMoving = false;
    if(joystickActive && !state.stunned) {
      const forward = -joystickDY * MOVE_SPEED;
      const right = joystickDX * MOVE_SPEED;
      isMoving = Math.abs(joystickDX) > 0.05 || Math.abs(joystickDY) > 0.05;

      const oldX = camera.pos.x, oldZ = camera.pos.z;

      camera.pos.x -= Math.sin(camera.rotY) * forward;
      camera.pos.z -= Math.cos(camera.rotY) * forward;
      camera.pos.x += Math.cos(camera.rotY) * right;
      camera.pos.z -= Math.sin(camera.rotY) * right;

      if(GameMap.checkCollision(camera.pos, PLAYER_RADIUS)) {
        camera.pos.x = oldX; camera.pos.z = oldZ;
      }

      camera.pos.x = Math.max(-27, Math.min(27, camera.pos.x));
      camera.pos.z = Math.max(-27, Math.min(27, camera.pos.z));
    }

    // View bobbing: chỉ ảnh hưởng camera.pos.y (không gửi lên server) để tạo
    // cảm giác đi bộ chân thực mà không phá vỡ collision/network sync.
    if(isMoving) {
      bobPhase += dt * 9;
      bobAmount = Engine.lerp(bobAmount, Math.abs(Math.sin(bobPhase)) * 0.045, Math.min(1, dt*10));
    } else {
      bobAmount = Engine.lerp(bobAmount, 0, Math.min(1, dt*8));
    }
    camera.pos.y = EYE_HEIGHT + bobAmount;

    // Look (bỏ qua nếu bị stun để tăng cảm giác "choáng")
    if(!state.stunned && (lookDX !== 0 || lookDY !== 0)) {
      camera.rotY -= lookDX;
      camera.rotX -= lookDY;
      camera.rotX = Math.max(-1.2, Math.min(1.2, camera.rotX));
      lookDX = 0; lookDY = 0;
    }

    checkInteraction();
    updateTeaseButton();

    // Khói bay lên liên tục từ lò nướng
    smokeTimer += dt;
    if(smokeTimer > 0.22) {
      smokeTimer = 0;
      const fp = GameMap.getCartFirePosition();
      if(fp) particles.emit('smoke', new Vec3(fp.x, fp.y, fp.z), 2);
    }

    // Customer patience
    if(state.currentCustomer && patienceLeft > 0) {
      patienceLeft -= dt;
      if(patienceLeft <= 0) customerLeave(false);
    }

    // Gửi vị trí lên server (y luôn gửi 0 - mặt đất - không gửi bobbing)
    Network.sendMove(camera.pos.x, 0, camera.pos.z, camera.rotY);
  }

  function updateTeaseButton() {
    const nearby = Network.getNearbyPlayer(camera, 3.2);
    if(nearby && !state.stunned) {
      teaseBtn.style.display = 'flex';
      teaseTargetName.textContent = nearby.nickname;
    } else {
      teaseBtn.style.display = 'none';
    }
  }

  function checkInteraction() {
    const forward = new Vec3(-Math.sin(camera.rotY), -Math.sin(camera.rotX), -Math.cos(camera.rotY));
    const ray = new Ray(camera.pos, forward);
    const hit = GameMap.raycastInteractables(ray);

    if(hit) {
      interactionPrompt.style.display = 'block';
      if(hit.type === 'cart') {
        promptText.textContent = '👆 Chạm để chế biến bánh mì';
        btnAction.textContent = '🥖';
        btnAction.classList.add('active');
      }
    } else {
      interactionPrompt.style.display = 'none';
      btnAction.textContent = '👋';
      btnAction.classList.remove('active');
    }
  }

  function doAction() {
    if(state.inDialog || state.inCrafting || state.stunned) return;

    const forward = new Vec3(-Math.sin(camera.rotY), -Math.sin(camera.rotX), -Math.cos(camera.rotY));
    const ray = new Ray(camera.pos, forward);
    const hit = GameMap.raycastInteractables(ray);

    if(hit && hit.type === 'cart') {
      if(Network.getPlayerCount() > 1) {
        openCoopCart();
      } else {
        openCrafting(); // Chơi một mình: giữ nguyên luồng gốc, không cần trạm co-op
      }
    }
  }

  // ===== CUSTOMERS =====
  let patienceLeft = 0;

  function spawnCustomer() {
    if(state.dayCustomers >= 3 + state.day) { endDay(); return; }

    state.currentCustomer = CUSTOMERS[Math.floor(Math.random() * CUSTOMERS.length)];
    state.currentOrder = RECIPES[Math.floor(Math.random() * RECIPES.length)];
    patienceLeft = state.currentCustomer.patience;

    showDialog(state.currentCustomer, `Cho em 1 ổ ${state.currentOrder.name}!`);
  }

  function showDialog(customer, text) {
    state.inDialog = true;
    dialogAvatar.textContent = customer.avatar;
    dialogName.textContent = customer.name;
    dialogText.textContent = text;
    dialogOptions.innerHTML = '';

    const btn = document.createElement('button');
    btn.className = 'dialog-option primary';
    btn.textContent = 'OK! Để anh làm ngay →';
    const go = () => {
      closeDialog();
      if(Network.getPlayerCount() > 1) openCoopCart(); else openCrafting();
    };
    btn.addEventListener('click', go);
    btn.addEventListener('touchstart', (e) => { e.preventDefault(); go(); }, {passive:false});
    dialogOptions.appendChild(btn);

    dialogBox.style.display = 'flex';
  }

  function closeDialog() { state.inDialog = false; dialogBox.style.display = 'none'; }

  function customerLeave(success) {
    state.dayCustomers++;
    state.currentCustomer = null;
    state.currentOrder = null;

    if(!success) {
      state.reputation = Math.max(0, state.reputation - 10);
      showNotification('😡 Khách bỏ đi!', '#f44336');
      updateHUD();
    }

    setTimeout(() => spawnCustomer(), 2000);
  }

  // ===== CRAFTING (chơi một mình - luồng gốc) =====
  function openCrafting() {
    state.inCrafting = true;
    state.cartRole = null;
    craftingTitle.textContent = '🥖 CHẾ BIẾN BÁNH MÌ';
    craftRoleBanner.style.display = 'none';
    craftCookPanel.style.display = 'none';
    craftingUI.style.display = 'flex';
    renderRecipeGrid(true);
  }

  // ===== CRAFTING CO-OP (>=2 người trong phòng) =====
  function openCoopCart() {
    Network.joinCartStation((res) => {
      if(!res || !res.ok) {
        showNotification('🚫 Trạm bánh mì đang bận, đợi chút nhé!', '#f44336');
        return;
      }
      state.inCrafting = true;
      state.cartRole = res.role;
      state.cartStationSnapshot = res.station || state.cartStationSnapshot;
      craftingUI.style.display = 'flex';
      refreshCoopUI();
    });
  }

  function refreshCoopUI() {
    const role = state.cartRole;
    const st = state.cartStationSnapshot;
    if(role === 'cook') {
      craftingTitle.textContent = '🔥 TRẠM NƯỚNG (Đầu bếp)';
      craftRoleBanner.style.display = 'block';
      craftRoleBanner.textContent = st.meatReady
        ? '✅ Đã nướng xong! Đang chờ người ráp bánh giao cho khách...'
        : '👨‍🍳 Bạn là ĐẦU BẾP — nướng thịt/trứng để đồng đội ráp bánh!';
      craftCookPanel.style.display = 'flex';
      craftingRecipes.style.display = 'none';
      renderCookPanel(st.meatReady);
    } else {
      craftingTitle.textContent = '🥪 TRẠM RÁP BÁNH (Người bán)';
      craftRoleBanner.style.display = 'block';
      craftRoleBanner.textContent = st.meatReady
        ? '✅ Nguyên liệu đã sẵn sàng — chọn đúng món khách yêu cầu!'
        : '⏳ Đang chờ đầu bếp nướng thịt/trứng...';
      craftCookPanel.style.display = 'none';
      craftingRecipes.style.display = 'grid';
      renderRecipeGrid(false);
    }
  }

  function renderCookPanel(ready) {
    craftCookPanel.innerHTML = '';
    const btn = document.createElement('button');
    btn.className = 'cook-btn' + (ready ? ' ready' : '');
    btn.textContent = ready ? '✅' : '🔥';
    let cooking = false;
    const doCook = () => {
      if(cooking || ready) return;
      cooking = true;
      btn.classList.add('cooking');
      SFX.playSizzle(1.3);
      const fp = GameMap.getCartFirePosition();
      if(fp) particles.emit('smoke', new Vec3(fp.x, fp.y, fp.z), 8);
      setTimeout(() => {
        cooking = false;
        Network.cookMeat();
      }, 1300);
    };
    btn.addEventListener('click', doCook);
    btn.addEventListener('touchstart', (e) => { e.preventDefault(); doCook(); }, {passive:false});
    craftCookPanel.appendChild(btn);

    const hint = document.createElement('div');
    hint.className = 'cook-hint';
    hint.textContent = ready ? 'Tuyệt vời! Đợi đồng đội ráp bánh.' : 'Chạm để nướng thịt/trứng 🔥';
    craftCookPanel.appendChild(hint);
  }

  function renderRecipeGrid(soloMode) {
    craftingRecipes.innerHTML = '';
    const canAssemble = soloMode || state.cartStationSnapshot.meatReady;

    RECIPES.forEach(recipe => {
      const card = document.createElement('div');
      card.className = 'recipe-card' + (canAssemble ? '' : ' locked');
      card.innerHTML = `
        <div class="recipe-name">🥖 ${recipe.name}</div>
        <div class="recipe-ingredients">${recipe.ingredients.join(' ')}</div>
        <div class="recipe-price">💰 ${recipe.price.toLocaleString()}đ • ⏱️ ${recipe.time}s</div>
      `;

      const makeRecipe = () => {
        if(!canAssemble) {
          showNotification('🔥 Chờ đầu bếp nướng thịt xong đã!', '#e8a838');
          return;
        }
        if(state.currentOrder && state.currentOrder.id === recipe.id) {
          completeOrder(recipe);
        } else {
          showNotification('❌ Sai đơn hàng!', '#f44336');
        }
      };

      card.addEventListener('click', makeRecipe);
      card.addEventListener('touchstart', (e) => { e.preventDefault(); makeRecipe(); }, {passive:false});
      craftingRecipes.appendChild(card);
    });
  }

  function closeCrafting() {
    state.inCrafting = false;
    craftingUI.style.display = 'none';
    if(state.cartRole) {
      Network.leaveCartStation();
      state.cartRole = null;
    }
  }

  function completeOrder(recipe) {
    closeCrafting();

    const speedBonus = patienceLeft / state.currentCustomer.patience;
    let earned = recipe.price;
    if(speedBonus > 0.7) earned = Math.floor(earned * 1.3);
    else if(speedBonus > 0.4) earned = Math.floor(earned * 1.1);

    // Doanh thu được cộng ở server và đồng bộ tới cả phòng qua 'revenueUpdate'
    // (không cộng trực tiếp vào state.money để tránh lệch số giữa các người chơi).
    Network.sendOrderCompleted(earned, recipe.name);

    // VFX: sparkle + tim bay lên tại quầy xe bánh mì
    const cartPos = GameMap.getCartPosition();
    if(cartPos) {
      const p = new Vec3(cartPos.x, cartPos.y + 1.3, cartPos.z);
      particles.emit('sparkle', p, 14);
      if(speedBonus > 0.5) particles.emit('heart', p, 5);
    }

    state.reputation = Math.min(100, state.reputation + 3);
    state.customersServed++;

    updateHUD();

    state.currentCustomer = null;
    state.currentOrder = null;
    state.dayCustomers++;

    setTimeout(() => spawnCustomer(), 1500);
  }

  // ===== DAY SYSTEM =====
  function endDay() {
    state.isPlaying = false;
    showNotification(`🌙 Hết ngày ${state.day}!`, '#e8a838');

    setTimeout(() => {
      state.day++;
      state.dayCustomers = 0;
      updateHUD();
      Network.sendDayAdvanced(state.day);

      dialogAvatar.textContent = '🌙';
      dialogName.textContent = 'Kết thúc ngày';
      dialogText.textContent = `Ngày ${state.day-1} hoàn thành!\nTổng tiền (cả phòng): ${state.money.toLocaleString()}đ\nUy tín: ${state.reputation}/100`;
      dialogOptions.innerHTML = '';

      const nextBtn = document.createElement('button');
      nextBtn.className = 'dialog-option primary';
      nextBtn.textContent = 'Ngày mai →';
      const go = () => { closeDialog(); state.isPlaying = true; spawnCustomer(); };
      nextBtn.addEventListener('click', go);
      nextBtn.addEventListener('touchstart', (e) => { e.preventDefault(); go(); }, {passive:false});
      dialogOptions.appendChild(nextBtn);

      dialogBox.style.display = 'flex';
      state.inDialog = true;
    }, 2000);
  }

  // ===== UI HELPERS =====
  function updateHUD() {
    hudMoney.textContent = state.money.toLocaleString() + 'đ';
    hudRep.textContent = state.reputation;
    hudDay.textContent = 'Ngày ' + state.day;
  }

  function showNotification(text, color) {
    notifText.textContent = text;
    notifText.style.color = color;
    notification.style.display = 'flex';
    setTimeout(() => { notification.style.display = 'none'; }, 2000);
  }

  // ===== START =====
  window.addEventListener('DOMContentLoaded', init);
})();
