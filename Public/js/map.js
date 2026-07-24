// ===== HUST BANHMI 3D MAP =====
// Bản đồ khuôn viên Bách Khoa với quầy bánh mì, cây cối, tòa nhà

const GameMap = (function(){
  'use strict';
  const { Vec3, MeshBuilder, Scene } = Engine;
  const { sin, cos, PI, min, max } = Math;

  // Colors (RGB 0-255)
  const C = {
    grass: [60, 100, 40],
    dirt: [120, 90, 50],
    road: [100, 100, 100],
    roadLine: [200, 200, 180],
    sidewalk: [140, 130, 120],
    wall: [180, 160, 130],
    wallDark: [140, 120, 90],
    roof: [160, 60, 40],
    roofDark: [120, 40, 25],
    wood: [140, 100, 50],
    woodDark: [100, 70, 30],
    metal: [80, 80, 90],
    glass: [150, 200, 220],
    treeTrunk: [100, 70, 35],
    treeLeaf: [40, 120, 35],
    treeLeafDark: [25, 80, 20],
    cartBody: [200, 160, 80],
    cartAccent: [180, 50, 40],
    fire: [255, 120, 30],
    fireDark: [200, 80, 20],
    water: [60, 120, 180],
    bench: [120, 80, 40],
    lamp: [255, 240, 180],
    lampPost: [60, 60, 70],
    sign: [240, 220, 180],
    signPost: [80, 60, 30],
  };

  // Palette dùng riêng để phân biệt avatar của các người chơi khác trong phòng
  const PLAYER_COLORS = [
    [232, 168, 56], [90, 170, 220], [220, 90, 130], [120, 200, 120],
    [200, 140, 220], [230, 200, 90], [90, 220, 200], [230, 120, 90],
  ];

  const scene = new Scene();
  const interactables = []; // Objects player can interact with
  const lampPositions = []; // {x,z} - dùng để bật glow đèn ban đêm
  let cartPosition = null;  // {x,y,z} - dùng để đổ bóng & bật đèn xe bánh mì ban đêm

  function addInteractable(mesh, type, data) {
    interactables.push({ mesh, type, data, bounds: getBounds(mesh) });
    return mesh;
  }

  function getBounds(mesh) {
    const v = mesh.verts;
    let minX=Infinity, minY=Infinity, minZ=Infinity;
    let maxX=-Infinity, maxY=-Infinity, maxZ=-Infinity;
    for(let i=0;i<v.length;i+=3){
      const x=v[i]+mesh.position.x, y=v[i+1]+mesh.position.y, z=v[i+2]+mesh.position.z;
      minX=min(minX,x); minY=min(minY,y); minZ=min(minZ,z);
      maxX=max(maxX,x); maxY=max(maxY,y); maxZ=max(maxZ,z);
    }
    return { min: new Vec3(minX,minY,minZ), max: new Vec3(maxX,maxY,maxZ) };
  }

  // ===== BUILD WORLD =====
  function buildWorld() {
    // Ground
    const ground = MeshBuilder.plane(60, 60, C.grass);
    ground.position.y = 0;
    scene.add(ground);

    // Road (main path)
    for(let z=-25; z<25; z+=2){
      const roadPiece = MeshBuilder.box(4, 0.05, 2, C.road);
      roadPiece.position.set(0, 0.02, z);
      scene.add(roadPiece);
    }
    // Road lines
    for(let z=-24; z<24; z+=6){
      const line = MeshBuilder.box(0.3, 0.06, 2.5, C.roadLine);
      line.position.set(0, 0.03, z);
      scene.add(line);
    }

    // Sidewalks
    for(let z=-25; z<25; z+=2){
      const sw1 = MeshBuilder.box(2, 0.08, 2, C.sidewalk);
      sw1.position.set(-3.5, 0.04, z);
      scene.add(sw1);
      const sw2 = MeshBuilder.box(2, 0.08, 2, C.sidewalk);
      sw2.position.set(3.5, 0.04, z);
      scene.add(sw2);
    }

    // ===== BANHMI CART (the main interactive object) =====
    buildCart(0, 0, -8);

    // ===== BUILDINGS =====
    // Main building (giảng đường style)
    buildBuilding(-15, 0, -15, 8, 6, 10, C.wall, C.roof);
    buildBuilding(15, 0, -12, 6, 5, 8, C.wallDark, C.roofDark);
    buildBuilding(-12, 0, 12, 5, 4, 6, C.wall, C.roof);

    // Small shops
    buildShop(8, 0, 5, 'Cafe');
    buildShop(-8, 0, 8, 'Sách');

    // ===== TREES =====
    const treePositions = [
      [-6,-6], [6,-6], [-10,0], [10,0], [-5,15], [5,15],
      [-18,-5], [18,-5], [-20,10], [20,10], [0,18], [-12,-18],
      [12,-18], [-22,0], [22,0], [0,-22]
    ];
    treePositions.forEach(([x,z]) => buildTree(x, z));

    // ===== LAMPS =====
    const lampPositions = [[-3,-10], [3,-10], [-3,0], [3,0], [-3,10], [3,10]];
    lampPositions.forEach(([x,z]) => buildLamp(x, z));

    // ===== BENCHES =====
    buildBench(-5, 0, 3, 0);
    buildBench(5, 0, 3, PI);
    buildBench(-5, 0, -3, 0);
    buildBench(5, 0, -3, PI);

    // ===== FOUNTAIN (center) =====
    buildFountain(0, 0, 12);

    // ===== SIGN =====
    buildSign(0, 0, -14, 'HUST BANHMI');

    // ===== FENCE =====
    buildFence();

    return { scene, interactables };
  }

  // ===== BUILD CART =====
  function buildCart(x, y, z) {
    cartPosition = { x, y, z };
    const group = [];

    // Cart body (main counter)
    const body = MeshBuilder.box(3, 1.2, 1.5, C.cartBody);
    body.position.set(x, y+0.6, z);
    scene.add(body); group.push(body);

    // Counter top
    const counter = MeshBuilder.box(3.2, 0.1, 1.7, C.wood);
    counter.position.set(x, y+1.25, z);
    scene.add(counter); group.push(counter);

    // Roof
    const roof = MeshBuilder.pyramid(3.5, 1, 2, C.roof);
    roof.position.set(x, y+2.3, z);
    scene.add(roof); group.push(roof);

    // Roof supports
    [-1.4, 1.4].forEach(ox => {
      const post = MeshBuilder.box(0.1, 1.2, 0.1, C.woodDark);
      post.position.set(x+ox, y+1.8, z+0.6);
      scene.add(post); group.push(post);
      const post2 = MeshBuilder.box(0.1, 1.2, 0.1, C.woodDark);
      post2.position.set(x+ox, y+1.8, z-0.6);
      scene.add(post2); group.push(post2);
    });

    // Wheels
    [-1, 1].forEach(ox => {
      const wheel = MeshBuilder.cylinder(0.4, 0.15, 8, C.metal);
      wheel.rotation.z = PI/2;
      wheel.position.set(x+ox, y+0.4, z+0.9);
      scene.add(wheel); group.push(wheel);
      const wheel2 = MeshBuilder.cylinder(0.4, 0.15, 8, C.metal);
      wheel2.rotation.z = PI/2;
      wheel2.position.set(x+ox, y+0.4, z-0.9);
      scene.add(wheel2); group.push(wheel2);
    });

    // Handle bar
    const handle = MeshBuilder.box(0.1, 0.1, 1.2, C.metal);
    handle.position.set(x+1.8, y+1, z);
    scene.add(handle); group.push(handle);

    // Grill/Fire area
    const grill = MeshBuilder.box(0.8, 0.05, 0.6, C.metal);
    grill.position.set(x-0.8, y+1.3, z+0.4);
    scene.add(grill); group.push(grill);

    // Fire (small cone)
    const fire = MeshBuilder.cone(0.2, 0.3, 6, C.fire);
    fire.position.set(x-0.8, y+1.35, z+0.4);
    scene.add(fire); group.push(fire);

    // Bread on counter
    const bread1 = MeshBuilder.box(0.3, 0.1, 0.8, [220, 180, 100]);
    bread1.position.set(x+0.5, y+1.35, z-0.3);
    scene.add(bread1); group.push(bread1);

    const bread2 = MeshBuilder.box(0.3, 0.1, 0.8, [220, 180, 100]);
    bread2.position.set(x+0.9, y+1.35, z-0.3);
    scene.add(bread2); group.push(bread2);

    // Menu board
    const menuBoard = MeshBuilder.box(0.8, 1, 0.05, C.sign);
    menuBoard.position.set(x-1.2, y+1.5, z+1);
    menuBoard.rotation.y = -0.3;
    scene.add(menuBoard); group.push(menuBoard);

    // Mark as interactable
    const cartObj = MeshBuilder.box(3.5, 2.5, 2.5, C.cartBody);
    cartObj.position.set(x, y+1.25, z);
    cartObj.visible = false;
    scene.add(cartObj);
    addInteractable(cartObj, 'cart', { name: 'Xe Bánh Mì', recipes: ['thapcam','thuong','trung','cha'] });
  }

  // ===== BUILD BUILDING =====
  function buildBuilding(x, y, z, w, h, d, wallColor, roofColor) {
    // Main body
    const body = MeshBuilder.box(w, h, d, wallColor);
    body.position.set(x, y+h/2, z);
    scene.add(body);

    // Roof
    const roof = MeshBuilder.pyramid(w+0.5, 1.5, d+0.5, roofColor);
    roof.position.set(x, y+h+0.75, z);
    scene.add(roof);

    // Door
    const door = MeshBuilder.box(1.2, 2, 0.1, C.woodDark);
    door.position.set(x, y+1, z+d/2+0.05);
    scene.add(door);

    // Windows
    [-w/3, 0, w/3].forEach(ox => {
      const win = MeshBuilder.box(0.8, 1, 0.1, C.glass);
      win.position.set(x+ox, y+h/2+0.5, z+d/2+0.05);
      scene.add(win);
    });
  }

  // ===== BUILD SHOP =====
  function buildShop(x, y, z, type) {
    const body = MeshBuilder.box(3, 2.5, 2.5, C.wall);
    body.position.set(x, y+1.25, z);
    scene.add(body);

    const roof = MeshBuilder.pyramid(3.5, 1, 3, C.roof);
    roof.position.set(x, y+3, z);
    scene.add(roof);

    const door = MeshBuilder.box(1, 1.8, 0.1, C.wood);
    door.position.set(x, y+0.9, z+1.3);
    scene.add(door);

    const sign = MeshBuilder.box(1.5, 0.4, 0.1, C.sign);
    sign.position.set(x, y+2.8, z+1.3);
    scene.add(sign);
  }

  // ===== BUILD TREE =====
  function buildTree(x, z) {
    const h = 1.5 + Math.random() * 1;
    // Trunk
    const trunk = MeshBuilder.cylinder(0.15, h, 6, C.treeTrunk);
    trunk.position.set(x, h/2, z);
    scene.add(trunk);

    // Leaves (multiple cones for low-poly look)
    const leaf1 = MeshBuilder.cone(1.2, 1.5, 6, C.treeLeaf);
    leaf1.position.set(x, h+0.5, z);
    scene.add(leaf1);

    const leaf2 = MeshBuilder.cone(0.9, 1.2, 6, C.treeLeafDark);
    leaf2.position.set(x, h+1.2, z);
    scene.add(leaf2);

    const leaf3 = MeshBuilder.cone(0.6, 0.8, 6, C.treeLeaf);
    leaf3.position.set(x, h+1.7, z);
    scene.add(leaf3);
  }

  // ===== BUILD LAMP =====
  function buildLamp(x, z) {
    lampPositions.push({ x, y: 2.6, z });
    const post = MeshBuilder.cylinder(0.08, 2.5, 6, C.lampPost);
    post.position.set(x, 1.25, z);
    scene.add(post);

    const bulb = MeshBuilder.box(0.3, 0.3, 0.3, C.lamp);
    bulb.position.set(x, 2.6, z);
    scene.add(bulb);

    // Light glow (small cone pointing down)
    const glow = MeshBuilder.cone(0.4, 0.3, 6, [255, 240, 180]);
    glow.position.set(x, 2.4, z);
    scene.add(glow);
  }

  // ===== BUILD BENCH =====
  function buildBench(x, y, z, rotY) {
    const seat = MeshBuilder.box(1.5, 0.1, 0.5, C.bench);
    seat.position.set(x, y+0.5, z);
    seat.rotation.y = rotY;
    scene.add(seat);

    const back = MeshBuilder.box(1.5, 0.4, 0.1, C.bench);
    back.position.set(x, y+0.8, z-0.25);
    back.rotation.y = rotY;
    scene.add(back);

    // Legs
    [-0.6, 0.6].forEach(ox => {
      const leg = MeshBuilder.box(0.08, 0.5, 0.08, C.metal);
      leg.position.set(x+ox*cos(rotY), y+0.25, z+ox*sin(rotY));
      scene.add(leg);
    });
  }

  // ===== BUILD FOUNTAIN =====
  function buildFountain(x, y, z) {
    // Base
    const base = MeshBuilder.cylinder(2, 0.3, 12, C.sidewalk);
    base.position.set(x, y+0.15, z);
    scene.add(base);

    // Water basin
    const basin = MeshBuilder.cylinder(1.5, 0.2, 12, C.water);
    basin.position.set(x, y+0.35, z);
    scene.add(basin);

    // Center pillar
    const pillar = MeshBuilder.cylinder(0.2, 1, 8, C.sidewalk);
    pillar.position.set(x, y+0.7, z);
    scene.add(pillar);

    // Top
    const top = MeshBuilder.cone(0.5, 0.3, 8, C.water);
    top.position.set(x, y+1.4, z);
    scene.add(top);
  }

  // ===== BUILD SIGN =====
  function buildSign(x, y, z, text) {
    const post1 = MeshBuilder.box(0.1, 2, 0.1, C.signPost);
    post1.position.set(x-0.8, y+1, z);
    scene.add(post1);

    const post2 = MeshBuilder.box(0.1, 2, 0.1, C.signPost);
    post2.position.set(x+0.8, y+1, z);
    scene.add(post2);

    const board = MeshBuilder.box(2, 0.8, 0.1, C.sign);
    board.position.set(x, y+1.8, z);
    scene.add(board);
  }

  // ===== BUILD FENCE =====
  function buildFence() {
    const bounds = 28;
    for(let i=-bounds; i<=bounds; i+=3) {
      // Front/back
      const post1 = MeshBuilder.box(0.15, 1.2, 0.15, C.woodDark);
      post1.position.set(i, 0.6, -bounds);
      scene.add(post1);
      const post2 = MeshBuilder.box(0.15, 1.2, 0.15, C.woodDark);
      post2.position.set(i, 0.6, bounds);
      scene.add(post2);

      // Rails
      if(i < bounds) {
        const rail1 = MeshBuilder.box(3, 0.08, 0.05, C.wood);
        rail1.position.set(i+1.5, 1, -bounds);
        scene.add(rail1);
        const rail2 = MeshBuilder.box(3, 0.08, 0.05, C.wood);
        rail2.position.set(i+1.5, 0.7, -bounds);
        scene.add(rail2);
        const rail3 = MeshBuilder.box(3, 0.08, 0.05, C.wood);
        rail3.position.set(i+1.5, 1, bounds);
        scene.add(rail3);
        const rail4 = MeshBuilder.box(3, 0.08, 0.05, C.wood);
        rail4.position.set(i+1.5, 0.7, bounds);
        scene.add(rail4);
      }
    }
    // Side fences
    for(let i=-bounds+3; i<bounds; i+=3) {
      const post1 = MeshBuilder.box(0.15, 1.2, 0.15, C.woodDark);
      post1.position.set(-bounds, 0.6, i);
      scene.add(post1);
      const post2 = MeshBuilder.box(0.15, 1.2, 0.15, C.woodDark);
      post2.position.set(bounds, 0.6, i);
      scene.add(post2);

      if(i < bounds-3) {
        const rail1 = MeshBuilder.box(0.05, 0.08, 3, C.wood);
        rail1.position.set(-bounds, 1, i+1.5);
        scene.add(rail1);
        const rail2 = MeshBuilder.box(0.05, 0.08, 3, C.wood);
        rail2.position.set(-bounds, 0.7, i+1.5);
        scene.add(rail2);
        const rail3 = MeshBuilder.box(0.05, 0.08, 3, C.wood);
        rail3.position.set(bounds, 1, i+1.5);
        scene.add(rail3);
        const rail4 = MeshBuilder.box(0.05, 0.08, 3, C.wood);
        rail4.position.set(bounds, 0.7, i+1.5);
        scene.add(rail4);
      }
    }
  }

  // ===== COLLISION =====
  function checkCollision(pos, radius) {
    // Simple AABB collision with buildings
    const buildings = [
      {min:new Vec3(-19,0,-20), max:new Vec3(-11,6,-10)},
      {min:new Vec3(12,0,-16), max:new Vec3(18,5,-8)},
      {min:new Vec3(-14.5,0,9), max:new Vec3(-9.5,4,15)},
      {min:new Vec3(6.5,0,3.75), max:new Vec3(9.5,2.5,6.25)},
      {min:new Vec3(-9.5,0,6.75), max:new Vec3(-6.5,2.5,9.25)},
      // Cart collision
      {min:new Vec3(-1.75,0,-9.25), max:new Vec3(1.75,2.5,-6.75)},
    ];

    for(const b of buildings){
      if(pos.x+radius > b.min.x && pos.x-radius < b.max.x &&
         pos.z+radius > b.min.z && pos.z-radius < b.max.z){
        return true;
      }
    }
    return false;
  }

  // ===== RAYCAST FOR INTERACTION =====
  function raycastInteractables(ray) {
    let closest = null, closestDist = Infinity;
    for(const obj of interactables){
      const b = obj.bounds;
      const t = Engine.rayAABB(ray, b.min, b.max);
      if(t !== null && t < closestDist && t < 4) { // 4 units interaction range
        closestDist = t;
        closest = obj;
      }
    }
    return closest;
  }

  // ===== REMOTE PLAYER AVATAR (mini xe bánh mì low-poly) =====
  // Tạo mesh nhóm đại diện cho một người chơi khác trong phòng. Trả về
  // một object có setPosition/setRotationY/dispose để network.js điều khiển,
  // cùng anchorMesh (dùng để tính vị trí màn hình cho nametag).
  function createRemotePlayerAvatar(colorIndex) {
    const color = PLAYER_COLORS[colorIndex % PLAYER_COLORS.length];
    const darker = color.map(c => Math.floor(c * 0.65));
    const parts = [];

    const body = MeshBuilder.cylinder(0.3, 0.9, 8, color);
    body.position.y = 0.9;
    scene.add(body); parts.push(body);

    const head = MeshBuilder.box(0.4, 0.4, 0.4, [255, 220, 180]);
    head.position.y = 1.55;
    scene.add(head); parts.push(head);

    const hat = MeshBuilder.cone(0.28, 0.3, 8, darker);
    hat.position.y = 1.8;
    scene.add(hat); parts.push(hat);

    // Lưu lại chiều cao gốc (offset so với mặt đất) của từng phần để khi cập
    // nhật vị trí ta chỉ cộng thêm y của mặt đất, không làm mất hình dạng.
    const baseY = parts.map(p => p.position.y);

    const group = {
      parts,
      anchorMesh: head,
      setPosition(x, y, z) {
        for(let i=0;i<parts.length;i++){
          parts[i].position.x = x;
          parts[i].position.z = z;
          parts[i].position.y = baseY[i] + y;
        }
      },
      setRotationY(ry) {
        for(const p of parts) p.rotation.y = ry;
      },
      dispose() {
        for(const p of parts) scene.remove(p);
      }
    };
    return group;
  }

  function getLampPositions() { return lampPositions; }
  function getCartPosition() { return cartPosition; }
  function getCartFirePosition() {
    if(!cartPosition) return null;
    return { x: cartPosition.x - 0.8, y: cartPosition.y + 1.35, z: cartPosition.z + 0.4 };
  }

  return {
    buildWorld, checkCollision, raycastInteractables,
    createRemotePlayerAvatar, scene,
    getLampPositions, getCartPosition, getCartFirePosition
  };
})();

window.GameMap = GameMap;
