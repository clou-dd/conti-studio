class ContiAudioCapture extends AudioWorkletProcessor {
  constructor() {
    super(); this.chunk = new Float32Array(4096); this.offset = 0;
    this.port.onmessage = ({ data }) => {
      if (data !== 'flush') return;
      if (this.offset) this.port.postMessage(this.chunk.slice(0, this.offset));
      this.offset = 0; this.port.postMessage({ flushed: true });
    };
  }
  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let value = 0;
      for (const channel of channels) value += channel[i] || 0;
      this.chunk[this.offset++] = value / channels.length;
      if (this.offset === this.chunk.length) {
        this.port.postMessage(this.chunk, [this.chunk.buffer]);
        this.chunk = new Float32Array(4096); this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor('conti-audio-capture', ContiAudioCapture);
