/* WebMix — Noise Gate (AudioWorklet): ปิดเสียงช่องเมื่อเบากว่า threshold เช่นเสียงแอร์/พัดลมตอนไม่ได้พูด
   เปิดเร็ว (~2 ms) ค้างไว้ 150 ms แล้วค่อยปิด (~120 ms) · ปิดที่ต่ำกว่า threshold 6 dB กันกระพือ · ลดลงสูงสุด 40 dB ให้ฟังเป็นธรรมชาติ */
class WebMixGate extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'threshold', defaultValue: -50, minValue: -100, maxValue: 0, automationRate: 'k-rate' }];
  }
  constructor() {
    super();
    this.env = 0; this.gain = 1; this.holdLeft = 0; this.open = true; this.reported = 0;
    const sr = sampleRate;
    this.envDecay = Math.exp(-1 / (0.01 * sr));
    this.attack = 1 - Math.exp(-1 / (0.002 * sr));
    this.release = 1 - Math.exp(-1 / (0.12 * sr));
    this.holdSamples = Math.round(0.15 * sr);
    this.floor = 0.01;
  }
  process(inputs, outputs, params) {
    const input = inputs[0], output = outputs[0];
    if (!input || !input.length) return true;
    const thr = Math.pow(10, params.threshold[0] / 20), close = thr * 0.5;
    const n = input[0].length, chs = input.length;
    for (let i = 0; i < n; i++) {
      let peak = 0;
      for (let c = 0; c < chs; c++) { const v = Math.abs(input[c][i]); if (v > peak) peak = v; }
      this.env = peak > this.env ? peak : this.env * this.envDecay;
      if (this.env >= thr) { this.open = true; this.holdLeft = this.holdSamples; }
      else if (this.env < close) { if (this.holdLeft > 0) this.holdLeft--; else this.open = false; }
      const target = this.open ? 1 : this.floor;
      this.gain += (target - this.gain) * (target > this.gain ? this.attack : this.release);
      for (let c = 0; c < chs; c++) if (output[c]) output[c][i] = input[c][i] * this.gain;
    }
    // แจ้งสถานะเปิด/ปิดให้หน้าเว็บ (ไฟ GATE บนมิกเซอร์) ราว 15 ครั้งต่อวินาที
    if (currentTime - this.reported > 0.066) { this.reported = currentTime; this.port.postMessage(this.open); }
    return true;
  }
}
registerProcessor('webmix-gate', WebMixGate);
