import { configureSpectrumAnalyser } from './music-flowing-wave.ts';

/** One lazy context for media playback. Analysis is a side branch, so disabling
 * the visualizer never disconnects the audible route or suspends music. */
export class MusicSpectrum {
  private context?: AudioContext;
  private analyser?: AnalyserNode;
  private source?: MediaElementAudioSourceNode;
  private element?: HTMLAudioElement;
  private enabled = false;
  private responsive = false;
  private failed = false;
  private disposed = false;

  get sampleRate(): number { return this.context?.sampleRate || 48000; }

  setEnabled(enabled: boolean, responsive = false) {
    this.responsive = responsive;
    if (this.analyser) configureSpectrumAnalyser(this.analyser, responsive);
    this.enabled = enabled;
    if (!enabled) this.disconnectAnalysis();
    else if (this.source) this.connectAnalysis();
  }
  unlock() {
    if (this.disposed || this.failed || !this.enabled) return;
    try {
      this.context ??= new AudioContext();
      void this.context.resume().catch(() => {});
    } catch { this.failed = true; }
  }
  attach(element: HTMLAudioElement) {
    if (!this.enabled || this.failed || this.disposed || this.element === element) return;
    // Never route opaque cross-origin media through Web Audio: it becomes mute.
    try { if (new URL(element.src, location.href).origin !== location.origin) return; }
    catch { return; }
    this.unlock();
    if (!this.context) return;
    this.release();
    try {
      const source = this.context.createMediaElementSource(element);
      source.connect(this.context.destination);
      this.source = source; this.element = element;
      this.connectAnalysis();
    } catch { /* Keep ordinary media playback if graph creation is unavailable. */ }
  }
  private connectAnalysis() {
    if (!this.context || !this.source || this.analyser) return;
    try {
      const analyser = this.context.createAnalyser();
      configureSpectrumAnalyser(analyser, this.responsive);
      this.source.connect(analyser); this.analyser = analyser;
    } catch { /* Analysis failure must not interrupt sound. */ }
  }
  private disconnectAnalysis() {
    if (!this.analyser) return;
    try { this.source?.disconnect(this.analyser); } catch {}
    this.analyser.disconnect(); this.analyser = undefined;
  }
  read(target: Uint8Array<ArrayBuffer>) {
    target.fill(0);
    if (!this.enabled || !this.analyser || this.context?.state !== 'running') return false;
    this.analyser.getByteFrequencyData(target); return true;
  }
  release() {
    this.disconnectAnalysis(); this.source?.disconnect();
    this.source = undefined; this.element = undefined;
  }
  dispose() {
    this.disposed = true; this.release();
    void this.context?.close().catch(() => {}); this.context = undefined;
  }
}
