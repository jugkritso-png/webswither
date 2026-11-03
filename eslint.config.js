// ESLint สำหรับทั้ง repo — รัน: npm run lint
// เน้นจับบั๊กจริง (ตัวแปรที่ไม่ได้ประกาศ, ตัวแปรค้าง, โค้ดที่ไม่มีทางทำงาน) ไม่บังคับรูปแบบการเขียน
const js = require('@eslint/js');
const globals = require('globals');

const bugRules = {
  'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true, varsIgnorePattern: '^_' }],
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-prototype-builtins': 'off',
  'no-useless-escape': 'off',
  'no-control-regex': 'off',
  'no-cond-assign': ['error', 'except-parens'],
  eqeqeq: ['error', 'smart'],
  'no-var': 'error',
  'prefer-const': ['error', { destructuring: 'all' }]
};

module.exports = [
  {
    ignores: [
      '**/node_modules/**', 'assets/vendor/**', 'desktop/dist/**', 'desktop/target/**', 'desktop/src-tauri/gen/**',
      'desktop/android/ffmpeg-out/**', 'tests/.work/**'
    ]
  },
  js.configs.recommended,
  // หน้าเว็บ (สตูดิโอ, CG Studio, หน้าเปิดตัว) — สคริปต์แบบคลาสสิก แชร์โค้ดผ่าน window.WebMix
  {
    files: ['assets/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: { ...globals.browser, Peer: 'readonly', QRCode: 'readonly', WebmSeek: 'readonly', Hls: 'readonly', pdfjsLib: 'readonly', lottie: 'readonly', mpegts: 'readonly' }
    },
    rules: bugRules
  },
  // AudioWorklet — ทำงานในเธรดเสียง ไม่มี window
  {
    files: ['assets/js/*-worklet.js'],
    languageOptions: { globals: { ...globals.audioWorklet } }
  },
  // Stream Gateway, ชุดทดสอบ, สคริปต์ build — Node.js
  {
    files: ['server/**/*.js', 'tests/**/*.js', 'desktop/scripts/**/*.js', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: { ...globals.node } },
    rules: bugRules
  },
  {
    files: ['desktop/scripts/**/*.mjs'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node } },
    rules: bugRules
  },
  // ชุดทดสอบส่งฟังก์ชันไปรันในหน้าเว็บ (page.evaluate) — ใช้ตัวแปรของเบราว์เซอร์และของหน้า WebMix ได้
  {
    files: ['tests/**/*.js'],
    languageOptions: { globals: { ...globals.browser, WebMixCG: 'readonly' } }
  }
];
