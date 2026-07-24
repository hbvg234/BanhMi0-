// ===== HUST BANHMI 3D RENDERER =====
// WebGL renderer tối ưu cho mobile - low-poly, flat shading
// Gồm 2 pipeline vẽ:
//   1) Opaque pipeline: mesh thế giới (nhà, cây, xe bánh mì...) - có Day/Night
//      (ambient + fog màu động theo thời gian trong game).
//   2) FX pipeline (alpha blend, depth-write off): particles, blob shadow,
//      glow đèn ban đêm - dựng lại mỗi frame từ danh sách "effect items".

const Renderer = (function(){
  'use strict';
  const { Mat4 } = Engine;

  let gl, canvas;

  // ---- Opaque pipeline ----
  let opaqueProgram;
  let aPos, aColor, uMVP, uAmbient, uFogColor, uFogNear, uFogFar;
  let vertexBuffer, colorBuffer, indexBuffer;

  // ---- FX pipeline (particles / shadows / glow) ----
  let fxProgram;
  let fxPos, fxColor, fxMVP;
  let fxVertexBuffer, fxColorBuffer, fxIndexBuffer;

  const VS = `
    attribute vec3 a_position;
    attribute vec3 a_color;
    uniform mat4 u_mvp;
    varying vec3 v_color;
    varying float v_depth;
    void main(){
      vec4 pos = u_mvp * vec4(a_position, 1.0);
      gl_Position = pos;
      v_depth = pos.z / pos.w;
      v_color = a_color;
    }
  `;

  // Fragment shader - flat shading + fog động theo Day/Night (uniform)
  const FS = `
    precision mediump float;
    varying vec3 v_color;
    varying float v_depth;
    uniform float u_ambient;
    uniform vec3 u_fogColor;
    uniform float u_fogNear;
    uniform float u_fogFar;
    void main(){
      vec3 color = v_color / 255.0;
      color *= u_ambient;
      float fog = clamp((v_depth - u_fogNear) / (u_fogFar - u_fogNear), 0.0, 0.75);
      color = mix(color, u_fogColor, fog);
      gl_FragColor = vec4(color, 1.0);
    }
  `;

  // FX shader: nhận thêm alpha (đóng gói trong a_color.w qua vec4)
  const FX_VS = `
    attribute vec3 a_position;
    attribute vec4 a_color;
    uniform mat4 u_mvp;
    varying vec4 v_color;
    void main(){
      gl_Position = u_mvp * vec4(a_position, 1.0);
      v_color = a_color;
    }
  `;
  const FX_FS = `
    precision mediump float;
    varying vec4 v_color;
    void main(){
      gl_FragColor = vec4(v_color.rgb / 255.0, v_color.a / 255.0);
    }
  `;

  function init(cvs) {
    canvas = cvs;
    gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' });
    if(!gl) gl = canvas.getContext('experimental-webgl', { antialias: false, alpha: false });
    if(!gl) return false;

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.clearColor(0.06, 0.04, 0.02, 1.0);

    // ---- Opaque program ----
    opaqueProgram = linkProgram(VS, FS);
    if(!opaqueProgram) return false;
    gl.useProgram(opaqueProgram);
    aPos = gl.getAttribLocation(opaqueProgram, 'a_position');
    aColor = gl.getAttribLocation(opaqueProgram, 'a_color');
    uMVP = gl.getUniformLocation(opaqueProgram, 'u_mvp');
    uAmbient = gl.getUniformLocation(opaqueProgram, 'u_ambient');
    uFogColor = gl.getUniformLocation(opaqueProgram, 'u_fogColor');
    uFogNear = gl.getUniformLocation(opaqueProgram, 'u_fogNear');
    uFogFar = gl.getUniformLocation(opaqueProgram, 'u_fogFar');

    vertexBuffer = gl.createBuffer();
    colorBuffer = gl.createBuffer();
    indexBuffer = gl.createBuffer();

    // ---- FX program ----
    fxProgram = linkProgram(FX_VS, FX_FS);
    if(!fxProgram) return false;
    gl.useProgram(fxProgram);
    fxPos = gl.getAttribLocation(fxProgram, 'a_position');
    fxColor = gl.getAttribLocation(fxProgram, 'a_color');
    fxMVP = gl.getUniformLocation(fxProgram, 'u_mvp');

    fxVertexBuffer = gl.createBuffer();
    fxColorBuffer = gl.createBuffer();
    fxIndexBuffer = gl.createBuffer();

    resize();
    return true;
  }

  function linkProgram(vsSrc, fsSrc) {
    const vs = compileShader(gl.VERTEX_SHADER, vsSrc);
    const fs = compileShader(gl.FRAGMENT_SHADER, fsSrc);
    if(!vs || !fs) return null;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if(!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('Shader link failed:', gl.getProgramInfoLog(prog));
      return null;
    }
    return prog;
  }

  function compileShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if(!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth * dpr;
    const h = canvas.clientHeight * dpr;
    if(canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
  }

  function buildViewMatrix(camera) {
    const view = new Mat4();
    view.identity();
    view.rotateX(camera.rotX);
    view.rotateY(camera.rotY);
    view.translate(-camera.pos.x, -camera.pos.y, -camera.pos.z);
    return view;
  }

  // Temporary arrays to avoid allocation
  const tempVerts = [];
  const tempColors = [];
  const tempIndices = [];

  // Môi trường mặc định (dùng nếu game.js chưa truyền env - vẫn chạy được)
  const DEFAULT_ENV = {
    ambient: 0.85,
    fogColor: [15, 10, 5],
    fogNear: 10, fogFar: 50,
    skyColor: [15, 10, 5],
  };

  let lastMVP = null; // cache MVP của opaque pass để renderEffects tái sử dụng

  function render(scene, camera, env) {
    env = env || DEFAULT_ENV;
    resize();

    const sky = env.skyColor || env.fogColor;
    gl.clearColor(sky[0]/255, sky[1]/255, sky[2]/255, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const aspect = canvas.width / canvas.height;
    camera.update(aspect);

    tempVerts.length = 0;
    tempColors.length = 0;
    tempIndices.length = 0;

    let vertOffset = 0;

    for(const mesh of scene.meshes) {
      if(!mesh.visible) continue;

      const px = mesh.position.x, py = mesh.position.y, pz = mesh.position.z;
      const ry = mesh.rotation.y;
      const c = Math.cos(ry), s = Math.sin(ry);

      const verts = mesh.verts;
      const tris = mesh.tris;
      const colors = mesh.colors;

      for(let i=0; i<verts.length; i+=3) {
        let vx = verts[i], vy = verts[i+1], vz = verts[i+2];
        const rx = vx*c - vz*s;
        const rz = vx*s + vz*c;
        vx = rx; vz = rz;
        tempVerts.push(vx+px, vy+py, vz+pz);
      }

      for(let i=0; i<tris.length; i+=3) {
        const ci = (i/3)*3;
        const r = colors[ci], g = colors[ci+1], b = colors[ci+2];
        tempColors.push(r,g,b, r,g,b, r,g,b);
        tempIndices.push(vertOffset+tris[i], vertOffset+tris[i+1], vertOffset+tris[i+2]);
      }

      vertOffset += verts.length / 3;
    }

    // Build MVP (proj * view); verts đã pre-transform theo world nên không cần model
    const mvp = new Mat4();
    mvp.m.set(camera.proj.m);
    mvp.multiply(buildViewMatrix(camera));
    lastMVP = mvp;

    if(tempVerts.length === 0) return;

    gl.useProgram(opaqueProgram);
    gl.disable(gl.BLEND);
    gl.depthMask(true);

    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(tempVerts), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(tempColors), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(aColor);
    gl.vertexAttribPointer(aColor, 3, gl.UNSIGNED_BYTE, true, 0, 0);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(tempIndices), gl.DYNAMIC_DRAW);

    gl.uniformMatrix4fv(uMVP, false, mvp.m);
    gl.uniform1f(uAmbient, env.ambient);
    gl.uniform3f(uFogColor, env.fogColor[0]/255, env.fogColor[1]/255, env.fogColor[2]/255);
    gl.uniform1f(uFogNear, env.fogNear);
    gl.uniform1f(uFogFar, env.fogFar);

    gl.drawElements(gl.TRIANGLES, tempIndices.length, gl.UNSIGNED_SHORT, 0);
  }

  // ===== FX / EFFECTS PASS =====
  // items: mảng { kind:'particle'|'heart'|'disc'|'glow', pos:Vec3, size, color:[r,g,b], alpha:0..1 }
  const fxVerts = [];
  const fxColors = [];
  const fxIndices = [];

  function pushQuadBillboard(pos, size, color, alpha, camera, vOff) {
    // Billboard theo yaw camera (đủ đẹp cho particle nhỏ, rẻ hơn full billboard)
    const ry = camera.rotY;
    const rightX = Math.cos(ry), rightZ = -Math.sin(ry);
    const upX = 0, upY = 1, upZ = 0;
    const hs = size * 0.5;
    const corners = [
      [pos.x - rightX*hs, pos.y - upY*hs, pos.z - rightZ*hs],
      [pos.x + rightX*hs, pos.y - upY*hs, pos.z + rightZ*hs],
      [pos.x + rightX*hs, pos.y + upY*hs, pos.z + rightZ*hs],
      [pos.x - rightX*hs, pos.y + upY*hs, pos.z - rightZ*hs],
    ];
    const a = Math.round(alpha*255);
    for(const c2 of corners) {
      fxVerts.push(c2[0], c2[1], c2[2]);
      fxColors.push(color[0], color[1], color[2], a);
    }
    fxIndices.push(vOff, vOff+1, vOff+2, vOff, vOff+2, vOff+3);
    return 4;
  }

  function pushHeartBillboard(pos, size, color, alpha, camera, vOff) {
    const ry = camera.rotY;
    const rightX = Math.cos(ry), rightZ = -Math.sin(ry);
    const pts = Engine.HEART_POINTS;
    const a = Math.round(alpha*255);
    // centroid trước (vertex quạt tâm)
    fxVerts.push(pos.x, pos.y, pos.z);
    fxColors.push(color[0], color[1], color[2], a);
    let n = 1;
    for(const p of pts) {
      const lx = p[0]*size, ly = p[1]*size;
      fxVerts.push(pos.x + rightX*lx, pos.y + ly, pos.z + rightZ*lx);
      fxColors.push(color[0], color[1], color[2], a);
      n++;
    }
    for(let i=1; i<n-1; i++){
      fxIndices.push(vOff, vOff+i, vOff+i+1);
    }
    fxIndices.push(vOff, vOff+n-1, vOff+1);
    return n;
  }

  function pushGroundDisc(pos, radius, color, alpha, vOff) {
    const segments = 10;
    const a = Math.round(alpha*255);
    fxVerts.push(pos.x, pos.y, pos.z);
    fxColors.push(color[0], color[1], color[2], a);
    let n = 1;
    for(let i=0;i<=segments;i++){
      const ang = (i/segments) * Math.PI * 2;
      fxVerts.push(pos.x + Math.cos(ang)*radius, pos.y, pos.z + Math.sin(ang)*radius);
      fxColors.push(color[0], color[1], color[2], a);
      n++;
    }
    for(let i=1;i<n-1;i++){
      fxIndices.push(vOff, vOff+i, vOff+i+1);
    }
    return n;
  }

  function renderEffects(items, camera) {
    if(!items || items.length === 0) return;
    fxVerts.length = 0; fxColors.length = 0; fxIndices.length = 0;

    let vOff = 0;
    for(const item of items) {
      let added = 0;
      if(item.kind === 'disc') {
        added = pushGroundDisc(item.pos, item.size, item.color, item.alpha, vOff);
      } else if(item.kind === 'heart') {
        added = pushHeartBillboard(item.pos, item.size, item.color, item.alpha, camera, vOff);
      } else {
        // 'particle' hoặc 'glow'
        added = pushQuadBillboard(item.pos, item.size, item.color, item.alpha, camera, vOff);
      }
      vOff += added;
    }

    if(fxVerts.length === 0) return;

    const mvp = lastMVP || (() => {
      const m = new Mat4(); m.m.set(camera.proj.m); m.multiply(buildViewMatrix(camera)); return m;
    })();

    gl.useProgram(fxProgram);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false); // không ghi depth để particle không che nhau kỳ lạ

    gl.bindBuffer(gl.ARRAY_BUFFER, fxVertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(fxVerts), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(fxPos);
    gl.vertexAttribPointer(fxPos, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, fxColorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(fxColors), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(fxColor);
    gl.vertexAttribPointer(fxColor, 4, gl.UNSIGNED_BYTE, false, 0, 0);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, fxIndexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(fxIndices), gl.DYNAMIC_DRAW);

    gl.uniformMatrix4fv(fxMVP, false, mvp.m);
    gl.drawElements(gl.TRIANGLES, fxIndices.length, gl.UNSIGNED_SHORT, 0);

    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  // Chiếu một điểm world-space (x,y,z) ra tọa độ pixel màn hình.
  function worldToScreen(worldPos, camera) {
    const mvp = new Mat4();
    mvp.m.set(camera.proj.m);
    mvp.multiply(buildViewMatrix(camera));

    const m = mvp.m;
    const x = worldPos.x, y = worldPos.y, z = worldPos.z;
    const clipX = m[0]*x + m[4]*y + m[8]*z + m[12];
    const clipY = m[1]*x + m[5]*y + m[9]*z + m[13];
    const clipW = m[3]*x + m[7]*y + m[11]*z + m[15];

    if(clipW <= 0.0001) return null;

    const ndcX = clipX / clipW;
    const ndcY = clipY / clipW;

    return {
      x: (ndcX * 0.5 + 0.5) * canvas.clientWidth,
      y: (1 - (ndcY * 0.5 + 0.5)) * canvas.clientHeight,
    };
  }

  return { init, render, renderEffects, resize, worldToScreen, gl: () => gl };
})();

window.Renderer = Renderer;
