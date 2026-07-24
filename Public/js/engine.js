// ===== HUST BANHMI 3D ENGINE =====
// Engine 3D low-poly tùy chỉnh - nhẹ cho mobile
// Custom WebGL rendering engine (KHÔNG dùng Three.js hay thư viện đồ họa ngoài)

const Engine = (function(){
  'use strict';

  // ===== MATH =====
  const PI = Math.PI, TAU = PI * 2;
  const sin = Math.sin, cos = Math.cos, tan = Math.tan;
  const sqrt = Math.sqrt, abs = Math.abs, min = Math.min, max = Math.max;
  const floor = Math.floor, ceil = Math.ceil, round = Math.round;

  function clamp(v, lo, hi) { return max(lo, min(hi, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function deg2rad(d) { return d * PI / 180; }

  // Shortest-path angle lerp (avoids spinning the long way around when
  // interpolating rotY for remote players, e.g. from 3.0 to -3.0 rad)
  function lerpAngle(a, b, t) {
    let diff = ((b - a + PI) % TAU + TAU) % TAU - PI;
    return a + diff * t;
  }

  // ===== VECTOR3 =====
  class Vec3 {
    constructor(x=0, y=0, z=0) { this.x = x; this.y = y; this.z = z; }
    set(x,y,z) { this.x=x; this.y=y; this.z=z; return this; }
    copy(v) { this.x=v.x; this.y=v.y; this.z=v.z; return this; }
    add(v) { this.x+=v.x; this.y+=v.y; this.z+=v.z; return this; }
    sub(v) { this.x-=v.x; this.y-=v.y; this.z-=v.z; return this; }
    scale(s) { this.x*=s; this.y*=s; this.z*=s; return this; }
    dot(v) { return this.x*v.x + this.y*v.y + this.z*v.z; }
    cross(v) {
      const x = this.y*v.z - this.z*v.y;
      const y = this.z*v.x - this.x*v.z;
      const z = this.x*v.y - this.y*v.x;
      return this.set(x,y,z);
    }
    len() { return sqrt(this.x*this.x + this.y*this.y + this.z*this.z); }
    lenSq() { return this.x*this.x + this.y*this.y + this.z*this.z; }
    normalize() {
      const l = this.len();
      if(l > 0.0001) this.scale(1/l);
      return this;
    }
    dist(v) { const dx=this.x-v.x, dy=this.y-v.y, dz=this.z-v.z; return sqrt(dx*dx+dy*dy+dz*dz); }
    clone() { return new Vec3(this.x, this.y, this.z); }
  }

  // ===== MATRIX4 =====
  class Mat4 {
    constructor() { this.m = new Float32Array(16); this.identity(); }
    identity() {
      const m = this.m;
      m[0]=1; m[1]=0; m[2]=0; m[3]=0;
      m[4]=0; m[5]=1; m[6]=0; m[7]=0;
      m[8]=0; m[9]=0; m[10]=1; m[11]=0;
      m[12]=0; m[13]=0; m[14]=0; m[15]=1;
      return this;
    }
    perspective(fov, aspect, near, far) {
      const f = 1 / tan(fov / 2);
      const nf = 1 / (near - far);
      const m = this.m;
      m[0]=f/aspect; m[1]=0; m[2]=0; m[3]=0;
      m[4]=0; m[5]=f; m[6]=0; m[7]=0;
      m[8]=0; m[9]=0; m[10]=(far+near)*nf; m[11]=-1;
      m[12]=0; m[13]=0; m[14]=2*far*near*nf; m[15]=0;
      return this;
    }
    translate(x,y,z) {
      const m = this.m;
      m[12] += m[0]*x + m[4]*y + m[8]*z;
      m[13] += m[1]*x + m[5]*y + m[9]*z;
      m[14] += m[2]*x + m[6]*y + m[10]*z;
      m[15] += m[3]*x + m[7]*y + m[11]*z;
      return this;
    }
    rotateY(angle) {
      const c = cos(angle), s = sin(angle);
      const m = this.m;
      const a0=m[0], a2=m[2], a4=m[4], a6=m[6], a8=m[8], a10=m[10], a12=m[12], a14=m[14];
      m[0]=a0*c+a2*s; m[2]=a0*-s+a2*c;
      m[4]=a4*c+a6*s; m[6]=a4*-s+a6*c;
      m[8]=a8*c+a10*s; m[10]=a8*-s+a10*c;
      m[12]=a12*c+a14*s; m[14]=a12*-s+a14*c;
      return this;
    }
    rotateX(angle) {
      const c = cos(angle), s = sin(angle);
      const m = this.m;
      const a1=m[1], a2=m[2], a5=m[5], a6=m[6], a9=m[9], a10=m[10], a13=m[13], a14=m[14];
      m[1]=a1*c+a2*-s; m[2]=a1*s+a2*c;
      m[5]=a5*c+a6*-s; m[6]=a5*s+a6*c;
      m[9]=a9*c+a10*-s; m[10]=a9*s+a10*c;
      m[13]=a13*c+a14*-s; m[14]=a13*s+a14*c;
      return this;
    }
    multiply(b) {
      const a = this.m, bm = b.m;
      const r = new Float32Array(16);
      for(let i=0;i<4;i++){
        for(let j=0;j<4;j++){
          r[i*4+j] = a[i*4]*bm[j] + a[i*4+1]*bm[4+j] + a[i*4+2]*bm[8+j] + a[i*4+3]*bm[12+j];
        }
      }
      this.m.set(r);
      return this;
    }
    clone() { const c = new Mat4(); c.m.set(this.m); return c; }
  }

  // ===== CAMERA =====
  class Camera {
    constructor() {
      this.pos = new Vec3(0, 1.7, 0);
      this.rotY = 0;
      this.rotX = 0;
      this.fov = deg2rad(70);
      this.near = 0.1;
      this.far = 100;
      this.view = new Mat4();
      this.proj = new Mat4();
    }
    update(aspect) {
      this.proj.perspective(this.fov, aspect, this.near, this.far);
      this.view.identity().rotateX(this.rotX).rotateY(this.rotY).translate(-this.pos.x, -this.pos.y, -this.pos.z);
    }
    forward() {
      return new Vec3(-sin(this.rotY), 0, -cos(this.rotY));
    }
    right() {
      return new Vec3(cos(this.rotY), 0, -sin(this.rotY));
    }
    moveForward(speed) {
      this.pos.x -= sin(this.rotY) * speed;
      this.pos.z -= cos(this.rotY) * speed;
    }
    moveRight(speed) {
      this.pos.x += cos(this.rotY) * speed;
      this.pos.z -= sin(this.rotY) * speed;
    }
  }

  // ===== MESH =====
  class Mesh {
    constructor(verts, tris, colors) {
      this.verts = verts; // Float32Array [x,y,z, x,y,z, ...]
      this.tris = tris;   // Uint16Array [i0,i1,i2, i0,i1,i2, ...]
      this.colors = colors; // Uint8Array [r,g,b, r,g,b, ...] per tri
      this.position = new Vec3(0,0,0);
      this.rotation = new Vec3(0,0,0);
      this.scale = new Vec3(1,1,1);
      this.visible = true;
    }
    getWorldMatrix() {
      const m = new Mat4();
      m.translate(this.position.x, this.position.y, this.position.z);
      m.rotateY(this.rotation.y);
      m.rotateX(this.rotation.x);
      // Scale is applied to verts at creation for simplicity
      return m;
    }
  }

  // ===== MESH BUILDERS (Low-poly primitives) =====
  const MeshBuilder = {
    // Box: w,h,d dimensions
    box(w, h, d, color) {
      const hw=w/2, hh=h/2, hd=d/2;
      const verts = new Float32Array([
        // Front
        -hw,-hh, hd,  hw,-hh, hd,  hw, hh, hd,  -hw, hh, hd,
        // Back
        -hw,-hh,-hd,  -hw, hh,-hd,  hw, hh,-hd,  hw,-hh,-hd,
        // Top
        -hw, hh,-hd,  -hw, hh, hd,  hw, hh, hd,  hw, hh,-hd,
        // Bottom
        -hw,-hh,-hd,  hw,-hh,-hd,  hw,-hh, hd,  -hw,-hh, hd,
        // Right
         hw,-hh,-hd,  hw, hh,-hd,  hw, hh, hd,  hw,-hh, hd,
        // Left
        -hw,-hh,-hd,  -hw,-hh, hd,  -hw, hh, hd,  -hw, hh,-hd,
      ]);
      const tris = new Uint16Array([
        0,1,2, 0,2,3,      // Front
        4,5,6, 4,6,7,      // Back
        8,9,10, 8,10,11,   // Top
        12,13,14, 12,14,15, // Bottom
        16,17,18, 16,18,19, // Right
        20,21,22, 20,22,23, // Left
      ]);
      const colorsArr = new Uint8Array(tris.length / 3 * 3);
      for(let i=0;i<tris.length/3;i++){
        colorsArr[i*3]=color[0]; colorsArr[i*3+1]=color[1]; colorsArr[i*3+2]=color[2];
      }
      return new Mesh(verts, tris, colorsArr);
    },

    // Cylinder (low-poly)
    cylinder(radius, height, segments, color) {
      const verts = [];
      const tris = [];
      const h2 = height / 2;
      // Top cap center
      verts.push(0, h2, 0);
      // Bottom cap center
      verts.push(0, -h2, 0);
      // Rim verts
      for(let i=0;i<=segments;i++){
        const a = (i/segments) * TAU;
        const x = cos(a) * radius, z = sin(a) * radius;
        verts.push(x, h2, z); // top rim
        verts.push(x, -h2, z); // bottom rim
      }
      const topCenter = 0, bottomCenter = 1;
      const rimStart = 2;
      for(let i=0;i<segments;i++){
        const top0 = rimStart + i*2, top1 = rimStart + ((i+1)%segments)*2;
        const bot0 = top0+1, bot1 = top1+1;
        // Top cap
        tris.push(topCenter, top1, top0);
        // Bottom cap
        tris.push(bottomCenter, bot0, bot1);
        // Side
        tris.push(top0, top1, bot0);
        tris.push(top1, bot1, bot0);
      }
      const colorsArr = new Uint8Array(tris.length / 3 * 3);
      for(let i=0;i<tris.length/3;i++){
        colorsArr[i*3]=color[0]; colorsArr[i*3+1]=color[1]; colorsArr[i*3+2]=color[2];
      }
      return new Mesh(new Float32Array(verts), new Uint16Array(tris), colorsArr);
    },

    // Cone
    cone(radius, height, segments, color) {
      const verts = [0, height, 0]; // tip
      const tris = [];
      for(let i=0;i<=segments;i++){
        const a = (i/segments) * TAU;
        verts.push(cos(a)*radius, 0, sin(a)*radius);
      }
      for(let i=0;i<segments;i++){
        tris.push(0, i+1, ((i+1)%segments)+1);
      }
      const colorsArr = new Uint8Array(tris.length / 3 * 3);
      for(let i=0;i<tris.length/3;i++){
        colorsArr[i*3]=color[0]; colorsArr[i*3+1]=color[1]; colorsArr[i*3+2]=color[2];
      }
      return new Mesh(new Float32Array(verts), new Uint16Array(tris), colorsArr);
    },

    // Plane (ground)
    plane(w, d, color) {
      const hw=w/2, hd=d/2;
      const verts = new Float32Array([
        -hw,0,-hd,  hw,0,-hd,  hw,0,hd,  -hw,0,hd,
      ]);
      const tris = new Uint16Array([0,1,2, 0,2,3]);
      const colorsArr = new Uint8Array([color[0],color[1],color[2], color[0],color[1],color[2]]);
      return new Mesh(verts, tris, colorsArr);
    },

    // Pyramid (roof)
    pyramid(w, h, d, color) {
      const hw=w/2, hd=d/2;
      const verts = new Float32Array([
        0,h,0,
        -hw,0,-hd, hw,0,-hd, hw,0,hd, -hw,0,hd,
      ]);
      const tris = new Uint16Array([
        0,2,1, 0,3,2, 0,4,3, 0,1,4,
        1,2,3, 1,3,4,
      ]);
      const colorsArr = new Uint8Array(tris.length / 3 * 3);
      for(let i=0;i<tris.length/3;i++){
        colorsArr[i*3]=color[0]; colorsArr[i*3+1]=color[1]; colorsArr[i*3+2]=color[2];
      }
      return new Mesh(verts, tris, colorsArr);
    }
  };

  // ===== SCENE =====
  class Scene {
    constructor() {
      this.meshes = [];
      this.lights = [];
    }
    add(mesh) { this.meshes.push(mesh); return mesh; }
    remove(mesh) {
      const i = this.meshes.indexOf(mesh);
      if(i >= 0) this.meshes.splice(i, 1);
    }
  }

  // ===== HEART SHAPE (dùng cho particle 'heart', vẽ dạng billboard) =====
  // Điểm 2D cục bộ (-1..1) tạo hình trái tim, tam giác hóa dạng quạt từ tâm.
  const HEART_POINTS = (function(){
    const pts = [];
    const N = 16;
    for(let i=0;i<N;i++){
      const t = (i/N) * TAU;
      // Công thức tham số hình trái tim, chuẩn hóa về khoảng [-1,1]
      const x = 16*Math.pow(sin(t),3);
      const y = 13*cos(t) - 5*cos(2*t) - 2*cos(3*t) - cos(4*t);
      pts.push([x/17, y/17]);
    }
    return pts;
  })();

  // ===== PARTICLE SYSTEM =====
  // Hệ hạt nhẹ cho mobile: mảng phẳng, không cấp phát object mới ngoài lúc emit,
  // update() chỉ tính toán số học đơn giản. Render thực tế do renderer.js đảm nhiệm
  // (billboard quads / hình trái tim), engine chỉ quản lý vòng đời + vật lý hạt.
  class ParticleSystem {
    constructor(maxParticles = 220) {
      this.maxParticles = maxParticles;
      this.particles = [];
    }

    emit(type, pos, count = 6) {
      const room = this.maxParticles - this.particles.length;
      const n = Math.min(count, Math.max(0, room));
      for (let i = 0; i < n; i++) {
        const p = {
          type,
          x: pos.x, y: pos.y, z: pos.z,
          vx: 0, vy: 0, vz: 0,
          life: 0, maxLife: 1, size: 0.12,
          color: [255, 255, 255], gravity: 0, spin: (Math.random()-0.5)*2,
        };
        switch (type) {
          case 'smoke':
            p.maxLife = 1.3 + Math.random() * 0.7;
            p.vx = (Math.random()-0.5) * 0.18;
            p.vy = 0.55 + Math.random() * 0.35;
            p.vz = (Math.random()-0.5) * 0.18;
            p.size = 0.10 + Math.random() * 0.08;
            p.growRate = 0.14; // to dần theo thời gian
            const g = 90 + Math.floor(Math.random()*30);
            p.color = [g, g, g];
            break;
          case 'sparkle': {
            p.maxLife = 0.45 + Math.random() * 0.3;
            const ang = Math.random() * TAU;
            const spd = 0.6 + Math.random() * 1.0;
            p.vx = cos(ang) * spd;
            p.vy = 1.3 + Math.random() * 1.0;
            p.vz = sin(ang) * spd;
            p.size = 0.055 + Math.random() * 0.045;
            p.gravity = -2.6;
            p.color = [255, 210 + Math.floor(Math.random()*40), 90];
            break;
          }
          case 'heart':
            p.maxLife = 1.1 + Math.random() * 0.5;
            p.vx = (Math.random()-0.5) * 0.35;
            p.vy = 0.75 + Math.random() * 0.35;
            p.vz = (Math.random()-0.5) * 0.35;
            p.size = 0.13 + Math.random() * 0.06;
            p.wobble = Math.random() * TAU;
            p.color = [235, 60 + Math.floor(Math.random()*30), 95];
            break;
        }
        this.particles.push(p);
      }
    }

    update(dt) {
      const arr = this.particles;
      for (let i = arr.length - 1; i >= 0; i--) {
        const p = arr[i];
        p.life += dt;
        if (p.life >= p.maxLife) { arr[i] = arr[arr.length-1]; arr.pop(); continue; }
        if (p.gravity) p.vy += p.gravity * dt;
        if (p.type === 'smoke') {
          // Khói chậm dần và tỏa rộng nhẹ theo thời gian
          p.vx *= (1 - Math.min(1, dt * 0.6));
          p.vz *= (1 - Math.min(1, dt * 0.6));
          p.size += p.growRate * dt;
        }
        if (p.type === 'heart') {
          p.wobble += dt * 3;
          p.x += sin(p.wobble) * 0.25 * dt;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
      }
    }

    // Trả về danh sách item để renderer.js vẽ, kèm alpha giảm dần cuối vòng đời
    getRenderItems() {
      const items = [];
      for (const p of this.particles) {
        const lifeRatio = p.life / p.maxLife;
        let alpha = 1;
        if (lifeRatio > 0.7) alpha = 1 - (lifeRatio - 0.7) / 0.3; // fade out
        else if (lifeRatio < 0.15) alpha = lifeRatio / 0.15; // fade in
        items.push({
          kind: p.type === 'heart' ? 'heart' : 'particle',
          pos: new Vec3(p.x, p.y, p.z),
          size: p.size,
          color: p.color,
          alpha: clamp(alpha, 0, 1),
        });
      }
      return items;
    }

    clear() { this.particles.length = 0; }
  }

  // ===== RAY (for interaction) =====
  class Ray {
    constructor(origin, dir) {
      this.origin = origin.clone();
      this.dir = dir.clone().normalize();
    }
    at(t) { return this.origin.clone().add(this.dir.clone().scale(t)); }
  }

  // Intersect ray with AABB
  function rayAABB(ray, minB, maxB) {
    let tmin = -Infinity, tmax = Infinity;
    for(let i=0;i<3;i++){
      const o = i===0?ray.origin.x:i===1?ray.origin.y:ray.origin.z;
      const d = i===0?ray.dir.x:i===1?ray.dir.y:ray.dir.z;
      const mn = i===0?minB.x:i===1?minB.y:minB.z;
      const mx = i===0?maxB.x:i===1?maxB.y:maxB.z;
      if(abs(d) < 0.0001){
        if(o < mn || o > mx) return null;
      } else {
        const t1 = (mn - o) / d, t2 = (mx - o) / d;
        const tnear = min(t1,t2), tfar = max(t1,t2);
        tmin = max(tmin, tnear);
        tmax = min(tmax, tfar);
        if(tmin > tmax) return null;
      }
    }
    return tmin >= 0 ? tmin : (tmax >= 0 ? tmax : null);
  }

  // ===== EXPORT =====
  return {
    Vec3, Mat4, Camera, Mesh, Scene, Ray, MeshBuilder,
    rayAABB, clamp, lerp, lerpAngle, deg2rad, PI, TAU,
    ParticleSystem, HEART_POINTS
  };
})();

// Đảm bảo Engine luôn truy cập được kể cả khi thứ tự nạp script có vấn đề
window.Engine = Engine;
