/* WebMix — คีย์ฉากเขียว/ฟ้าด้วย GPU (WebGL) สำหรับ KEY แบบเดิม */
(function (WM) {
  'use strict';

  const createKeyer = () => {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
      if (!gl) return null;
      const compile = (type, src) => {
        const sh = gl.createShader(type);
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
        return sh;
      };
      const prog = gl.createProgram();
      gl.attachShader(prog, compile(gl.VERTEX_SHADER,
        'attribute vec2 p;varying vec2 uv;void main(){uv=vec2((p.x+1.0)*0.5,(1.0-p.y)*0.5);gl_Position=vec4(p,0.0,1.0);}'));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, `precision mediump float;
        uniform sampler2D tex;uniform float hard;uniform float soft;uniform float blue;varying vec2 uv;
        void main(){
          vec4 c=texture2D(tex,uv);
          float k=mix(c.g,c.b,blue);
          float o=mix(max(c.r,c.b),max(c.r,c.g),blue);
          float d=k-o;
          float a=1.0;
          if(d>0.0){
            a=1.0-smoothstep(soft,hard,d);
            if(blue>0.5){c.b=o;}else{c.g=o;}
          }
          gl_FragColor=vec4(c.rgb,a);
        }`));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
      gl.useProgram(prog);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'p');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const u = name => gl.getUniformLocation(prog, name);
      const uHard = u('hard'), uSoft = u('soft'), uBlue = u('blue');
      return {
        canvas,
        run(src, opts) {
          if (canvas.width !== src.width || canvas.height !== src.height) {
            canvas.width = src.width; canvas.height = src.height;
            gl.viewport(0, 0, src.width, src.height);
          }
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
          gl.uniform1f(uHard, opts.tolerance / 255);
          gl.uniform1f(uSoft, opts.tolerance * 0.5 / 255);
          gl.uniform1f(uBlue, opts.color === 'blue' ? 1 : 0);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
          return !gl.isContextLost();
        }
      };
    } catch (e) {
      console.warn('WebGL keyer unavailable, using CPU keyer', e);
      return null;
    }
  };

  Object.assign(WM, { createKeyer });
})(window.WebMix);
