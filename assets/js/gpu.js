/* WebMix — ระบบวาดภาพด้วยการ์ดจอ (WebGL): shader, texture และการวาดสี่เหลี่ยมพร้อมคีย์/ครอป/ความทึบ */
(function (WM) {
  'use strict';

  const createGpu = () => {
    const canvas = document.createElement('canvas');
    let gl = null;
    try { gl = canvas.getContext('webgl', { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' }); } catch (e) {}
    if (!gl) return null;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const rendererName = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    const compile = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
      return sh;
    };
    let prog;
    try {
      prog = gl.createProgram();
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, `
        attribute vec2 a;uniform vec4 rect;uniform vec4 uv;uniform vec2 res;varying vec2 v;
        void main(){vec2 p=rect.xy+a*rect.zw;vec2 c=p/res*2.0-1.0;gl_Position=vec4(c.x,-c.y,0.0,1.0);v=mix(uv.xy,uv.zw,a);}`));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, `precision mediump float;
        uniform sampler2D tex;uniform float alpha;uniform float key;uniform float hard;uniform float soft;uniform float solid;uniform vec4 color;uniform vec4 cc;varying vec2 v;
        void main(){
          if(solid>0.5){gl_FragColor=vec4(color.rgb,color.a*alpha);return;}
          vec4 c=texture2D(tex,v);
          if(key>0.5){
            float blue=key>1.5?1.0:0.0;
            float k=mix(c.g,c.b,blue);
            float o=mix(max(c.r,c.b),max(c.r,c.g),blue);
            float d=k-o;
            if(d>0.0){c.a*=1.0-smoothstep(soft,hard,d);if(blue>0.5){c.b=o;}else{c.g=o;}}
          }
          // ปรับสี: ความสว่าง (คูณ) · คอนทราสต์ (รอบ 0.5) · ความอิ่มสี · อุณหภูมิสี (อุ่น +, เย็น −) — เหมือน CSS filter
          c.rgb*=cc.x;
          c.rgb=(c.rgb-0.5)*cc.y+0.5;
          float l=dot(c.rgb,vec3(0.2126,0.7152,0.0722));
          c.rgb=mix(vec3(l),c.rgb,cc.z);
          c.rgb+=vec3(0.08,0.02,-0.08)*cc.w;
          gl_FragColor=vec4(clamp(c.rgb,0.0,1.0),c.a*alpha);
        }`));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    } catch (e) { console.warn('GPU compositor unavailable', e); return null; }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    const aLoc = gl.getAttribLocation(prog, 'a');
    gl.enableVertexAttribArray(aLoc);
    gl.vertexAttribPointer(aLoc, 2, gl.FLOAT, false, 0, 0);
    const U = {};
    for (const n of ['rect', 'uv', 'res', 'tex', 'alpha', 'key', 'hard', 'soft', 'solid', 'color', 'cc']) U[n] = gl.getUniformLocation(prog, n);
    gl.uniform1i(U.tex, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);

    const textures = new Map(); // key → { tex, w, h, stamp, frame }
    let lost = false;
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); lost = true; });
    let vpW = 1, vpH = 1;

    return {
      canvas, rendererName,
      software: /swiftshader|llvmpipe|softpipe|software|basic render/i.test(rendererName),
      get ok() { return !lost && !gl.isContextLost(); },
      ensureSize(w, h) { if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; } },
      // เริ่มวาดลงพื้นที่ w×h มุมซ้ายบนของ canvas
      begin(w, h) {
        vpW = w; vpH = h;
        gl.viewport(0, canvas.height - h, w, h);
        gl.uniform2f(U.res, w, h);
        gl.disable(gl.SCISSOR_TEST);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
      },
      entry(key) {
        let e = textures.get(key);
        if (!e) {
          const tex = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          e = { tex, w: 0, h: 0, stamp: null, frame: -1 };
          textures.set(key, e);
        }
        return e;
      },
      upload(e, src, w, h) {
        gl.bindTexture(gl.TEXTURE_2D, e.tex);
        try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src); } catch (err) { return false; }
        e.w = w; e.h = h;
        return true;
      },
      // วาด texture ลงสี่เหลี่ยม r โดยใช้ส่วน uv ของภาพ
      // cc = { b: ความสว่าง, c: คอนทราสต์, s: ความอิ่มสี, t: อุณหภูมิสี } (ไม่ส่ง = ไม่ปรับ)
      quad(e, r, uv, alpha = 1, key = null, cc = null) {
        if (r.w <= 0 || r.h <= 0 || alpha <= 0) return;
        gl.bindTexture(gl.TEXTURE_2D, e.tex);
        gl.uniform4f(U.cc, cc ? cc.b : 1, cc ? cc.c : 1, cc ? cc.s : 1, cc ? cc.t : 0);
        gl.uniform1f(U.solid, 0);
        gl.uniform4f(U.rect, r.x, r.y, r.w, r.h);
        gl.uniform4f(U.uv, uv[0], uv[1], uv[2], uv[3]);
        gl.uniform1f(U.alpha, alpha);
        gl.uniform1f(U.key, key ? (key.color === 'blue' ? 2 : 1) : 0);
        if (key) { gl.uniform1f(U.hard, key.tolerance / 255); gl.uniform1f(U.soft, key.tolerance * 0.5 / 255); }
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      },
      solid(r, rgba, alpha = 1) {
        if (r.w <= 0 || r.h <= 0 || alpha <= 0) return;
        gl.uniform1f(U.solid, 1);
        gl.uniform4f(U.rect, r.x, r.y, r.w, r.h);
        gl.uniform4f(U.color, rgba[0], rgba[1], rgba[2], rgba[3]);
        gl.uniform1f(U.alpha, alpha);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      },
      drop(id) {
        for (const [k, e] of textures) if (k.endsWith(':' + id)) { gl.deleteTexture(e.tex); textures.delete(k); }
      }
    };
  };

  Object.assign(WM, { createGpu });
})(window.WebMix);
