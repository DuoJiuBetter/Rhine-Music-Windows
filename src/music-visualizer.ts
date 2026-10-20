import type { MusicPlayerState } from './music-player.ts';
import { FlowingWave, FLOWING_FFT_SIZE, flowingLevelAt } from './music-flowing-wave.ts';

export type VisualizerPosition = 'progress' | 'bottom';
export type VisualizerStyle = 'bars' | 'dots' | 'mini' | 'outline';
export interface VisualizerOptions { enabled: boolean; position: VisualizerPosition; style: VisualizerStyle; color?: string }
export const normalizeVisualizer = (value: Partial<VisualizerOptions>): VisualizerOptions => ({
  enabled: value.enabled !== false,
  position: value.position === 'bottom' ? 'bottom' : 'progress',
  style: value.style === 'dots' || value.style === 'mini' || value.style === 'outline' ? value.style : 'bars',
  ...(typeof value.color === 'string' && /^#[\da-f]{6}$/i.test(value.color) ? {color: value.color.toLowerCase()} : {}),
});
export function visualizerMarkup(options: VisualizerOptions) {
  return `<section class="panel-section" data-settings-group="appearance"><h3>音浪</h3>
    <label class="settings-row"><span>启用音浪</span><input id="visualizer-enabled" type="checkbox" ${options.enabled ? 'checked' : ''}></label>
    <label class="settings-row"><span>位置</span><select id="visualizer-position" aria-label="音浪位置"><option value="progress" ${options.position === 'progress' ? 'selected' : ''}>进度条上方</option><option value="bottom" ${options.position === 'bottom' ? 'selected' : ''}>窗口底边</option></select></label>
    <label class="settings-row"><span>样式</span><select id="visualizer-style" aria-label="音浪样式">${([['bars','细柱频谱'],['dots','点阵频谱'],['mini','极简五柱'],['outline','流动波形']] as const).map(([id,label])=>`<option value="${id}" ${options.style===id?'selected':''}>${label}</option>`).join('')}</select></label>
    <div class="settings-row visualizer-color-row"><span>音浪颜色</span><details data-visualizer-color-picker><summary title="调节音浪颜色"><i data-color-swatch></i><span data-color-label>跟随主题</span></summary><div class="visualizer-color-editor"><div class="visualizer-color-palette"><div class="visualizer-color-wheel" data-color-wheel role="slider" tabindex="0" aria-label="色相与饱和度" aria-valuemin="0" aria-valuemax="360"><i data-color-wheel-handle></i></div><div class="visualizer-color-value" data-color-value role="slider" tabindex="0" aria-label="颜色明暗" aria-valuemin="0" aria-valuemax="100"><i data-color-value-handle></i></div></div><div class="visualizer-color-footer"><label>HEX<input data-color-hex aria-label="音浪颜色 HEX" maxlength="7" spellcheck="false"></label><button type="button" class="text-button" data-color-reset>跟随主题</button></div><p>圆盘选择颜色，右侧调节明暗。</p></div></details></div></section>`;
}

/** Logarithmic bands from real FFT samples. No synthetic beat / random motion. */
export function spectrumBands(input: Uint8Array, output: Float32Array, sampleRate = 48000) {
  if (input.length < 2 || !Number.isFinite(sampleRate) || sampleRate <= 0) { output.fill(0); return; }
  // Focus the visible width on musical content, rather than near-silent bins
  // above 12 kHz. A gentle display curve lifts weak real detail, never silence.
  const binHz = sampleRate / (input.length * 2);
  const first = Math.min(input.length - 1, Math.max(1, Math.floor(60 / binHz)));
  const last = Math.min(input.length, Math.max(first + 1, Math.ceil(12000 / binHz)));
  const span = last / first;
  for (let i=0;i<output.length;i++) {
    const start=Math.max(first,Math.floor(first*Math.pow(span,i/output.length)));
    const end=Math.min(last,Math.max(start+1,Math.ceil(first*Math.pow(span,(i+1)/output.length))));
    let energy=0;
    for(let bin=start;bin<end;bin++) energy+=input[bin]*input[bin];
    const amplitude=end>start ? Math.sqrt(energy/(end-start))/255 : 0;
    output[i]=Math.min(1,Math.pow(amplitude,.8)*(1+.5*i/Math.max(1,output.length-1)));
  }
}

export class MusicVisualizer {
  private readonly canvas = document.createElement('canvas');
  private readonly context = this.canvas.getContext('2d', { alpha: true });
  private readonly samples = new Uint8Array(FLOWING_FFT_SIZE/2);
  private readonly wave = new FlowingWave();
  private levels = new Float32Array(128);
  private options: VisualizerOptions = normalizeVisualizer({});
  private frame = 0;
  private last = 0;
  private width = 0;
  private height = 0;
  private hidden = false;
  private disposed = false;
  private waveCrest = 'rgba(175,112,36,.9)';
  private waveTop = 'rgba(230,181,100,.58)';
  private waveMiddle = 'rgba(204,154,92,.28)';
  private waveBase = 'rgba(193,151,105,.06)';
  private waveFill?: CanvasGradient;
  private theme?: string;
  private track?: string;
  private observer: ResizeObserver;
  private mutations: MutationObserver;
  private readonly stage: HTMLElement;
  private readonly read: (target: Uint8Array<ArrayBuffer>)=>boolean;
  private readonly view: ()=>{state:MusicPlayerState;detail:boolean;blocked:boolean;reduced:boolean;sampleRate?:number};
  constructor(stage: HTMLElement, read: (target: Uint8Array<ArrayBuffer>)=>boolean,
    view: ()=>{state:MusicPlayerState;detail:boolean;blocked:boolean;reduced:boolean;sampleRate?:number}) {
    this.stage=stage;this.read=read;this.view=view;
    this.canvas.className='music-visualizer'; this.canvas.setAttribute('aria-hidden','true');
    this.observer=new ResizeObserver(entries=>{
      const box=entries[0]?.contentRect;
      if(box){this.width=box.width;this.height=box.height;this.resize();}
    });
    this.observer.observe(this.canvas);
    this.mutations=new MutationObserver(entries=>{
      if(entries.some(entry=>{
        if(entry.target===this.canvas)return false;
        const node=entry.target instanceof Element?entry.target:entry.target.parentElement;
        return node===stage || !!node?.closest('#song-view,#mini-playback-below,#album-detail-content,#music-detail,#music-panel-root');
      }))this.refresh();
    });
    this.mutations.observe(stage,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','data-song','data-lyrics-active','data-theme']});
  }
  configure(options:VisualizerOptions) {
    this.options=options;
    this.stage.classList.toggle('has-bottom-visualizer',options.enabled && options.position==='bottom');
    this.fitBands();
    this.refresh();
  }
  private fitBands() {
    if(this.options.style==='outline'){
      this.levels=this.wave.levels;
      return;
    }
    const size=this.options.style==='mini'?5:this.options.position==='bottom'
      ?Math.max(128,Math.min(this.options.style==='dots'?768:512,Math.round(this.width/(this.options.style==='dots'?3:5)))):128;
    if(this.levels.length!==size || this.levels===this.wave.levels)this.levels=new Float32Array(size);
  }
  setHidden(hidden:boolean){this.hidden=hidden;this.refresh();}
  refresh() {
    if(this.disposed)return;
    const {state,detail,blocked}=this.view();
    const active=!!state?.currentTrack && !['idle','error'].includes(state.transport);
    let parent:HTMLElement|undefined, before:HTMLElement|undefined;
    if(this.options.position==='bottom')parent=this.stage;
    else {
      const input=this.stage.querySelector<HTMLInputElement>(detail?'#song-view .playback-seek':'#mini-playback-below .playback-seek');
      if(input && !input.closest('[hidden]') && input.closest<HTMLElement>('[data-song]')?.dataset.song===state?.currentTrack?.id){parent=input.parentElement!;before=input;}
    }
    const visible=this.options.enabled && active && !!parent && !this.hidden && !document.hidden && !blocked;
    if(this.canvas.hidden===visible)this.canvas.hidden=!visible;
    this.canvas.classList.toggle('music-visualizer-bottom',this.options.position==='bottom');
    this.canvas.classList.toggle('music-visualizer-mini',this.options.position==='progress' && !detail);
    this.canvas.classList.toggle('music-visualizer-wave',this.options.style==='outline');
    if(parent && (this.canvas.parentElement!==parent || (before && this.canvas.nextElementSibling!==before)))parent.insertBefore(this.canvas,before??null);
    const paletteKey=`${this.stage.dataset.theme}:${this.options.color || 'theme'}`;
    if(this.theme!==paletteKey){
      this.theme=paletteKey;
      const styles=getComputedStyle(this.stage);
      this.waveCrest=styles.getPropertyValue('--wave-crest').trim() || 'rgba(175,112,36,.9)';
      this.waveTop=styles.getPropertyValue('--wave-top').trim() || 'rgba(230,181,100,.58)';
      this.waveMiddle=styles.getPropertyValue('--wave-middle').trim() || 'rgba(204,154,92,.28)';
      this.waveBase=styles.getPropertyValue('--wave-base').trim() || 'rgba(193,151,105,.06)';
      if(this.options.color){
        const rgb=[1,3,5].map(i=>parseInt(this.options.color!.slice(i,i+2),16)).join(',');
        this.waveCrest=`rgba(${rgb},.95)`;this.waveTop=`rgba(${rgb},.56)`;
        this.waveMiddle=`rgba(${rgb},.28)`;this.waveBase=`rgba(${rgb},.06)`;
      }
      this.waveFill=undefined;
    }
    if(this.track!==state?.currentTrack?.id){this.track=state?.currentTrack?.id;this.wave.reset();this.levels.fill(0);this.samples.fill(0);}
    if(!visible){cancelAnimationFrame(this.frame);this.frame=0;this.last=0;return;}
    if(!this.frame && (state.playing || this.wave.levels.some(v=>v>.001))){this.last=0;this.frame=requestAnimationFrame(this.draw);}
    else if(!state.playing && !this.frame)this.paint();
  }
  private resize() {
    this.fitBands();
    const ratio=Math.min(1.5,window.devicePixelRatio||1);
    this.canvas.width=Math.max(1,Math.round(this.width*ratio));
    this.canvas.height=Math.max(1,Math.round(this.height*ratio));
    this.waveFill=undefined;
    this.context?.setTransform(ratio,0,0,ratio,0,0);this.paint();
  }
  private draw=(now:number)=>{
    this.frame=0;
    if(this.disposed||this.canvas.hidden)return;
    const {state,reduced,sampleRate}=this.view();
    if(document.hidden||this.hidden){this.refresh();return;}
    const interval=reduced?125:1000/60;
    if(this.last && now-this.last<interval-.5){this.frame=requestAnimationFrame(this.draw);return;}
    const dt=this.last?Math.min(.15,(now-this.last)/1000):1/30;this.last=now;
    const real=state.playing&&!state.loading&&this.read(this.samples);
    this.wave.update(real?this.samples:undefined,sampleRate??48000,dt);
    this.paint();
    if(state.playing||this.wave.levels.some(v=>v>.001))this.frame=requestAnimationFrame(this.draw);
  };
  private paint(){
    const c=this.context;if(!c)return;
    c.clearRect(0,0,this.width,this.height);
    if(!this.wave.levels.some(v=>v>0)){this.levels.fill(0);return;}
    if(this.levels!==this.wave.levels){
      for(let i=0;i<this.levels.length;i++){
        if(this.options.style==='mini'){
          // Five broad frequency groups retain narrow musical accents.
          let peak=0;
          for(let j=Math.floor(i*32/5);j<Math.ceil((i+1)*32/5);j++)peak=Math.max(peak,this.wave.levels[j]);
          this.levels[i]=peak;
        }else this.levels[i]=flowingLevelAt(this.wave.levels,(i+.5)/this.levels.length);
      }
    }
    if(!this.waveFill){
      this.waveFill=c.createLinearGradient(0,0,0,this.height);
      this.waveFill.addColorStop(0,this.waveTop);
      this.waveFill.addColorStop(.55,this.waveMiddle);
      this.waveFill.addColorStop(1,this.waveBase);
    }
    c.fillStyle=this.waveFill;
    c.strokeStyle=this.waveCrest;c.lineWidth=1.35;c.lineJoin='round';c.lineCap='round';
    if(this.options.style==='outline'){
      // Smooth each interval while passing through every real peak. Midpoint
      // curve fitting used to lower sharp peaks and smear nearby frequencies.
      const n=this.levels.length,step=this.width/(n+1),base=this.height;
      // Keep the entire 1.35px crest stroke inside the canvas at low energy.
      // This is only a visible baseline, never synthetic frequency movement.
      const y=(i:number)=>base-Math.max(1.5,(i<0||i>=n?0:this.levels[i])*Math.max(0,base-6));
      const area=new Path2D(),edge=new Path2D();
      // Symmetric baseline endpoints keep the first low-frequency peak from
      // being cut vertically at the left canvas edge.
      area.moveTo(0,base);area.lineTo(0,y(-1));edge.moveTo(0,y(-1));
      for(let i=-1;i<n;i++){
        const segments=Math.max(2,Math.ceil(step/4)),start=y(i),delta=y(i+1)-start;
        for(let j=1;j<=segments;j++){
          const u=j/segments,x=(i+1+u)*step,height=start+delta*u*u*(3-2*u);
          area.lineTo(x,height);
          edge.lineTo(x,height);
        }
      }
      area.lineTo(this.width,base);area.closePath();c.fill(area);
      c.stroke(edge);return;
    }
    const mini=this.options.style==='mini', n=this.levels.length;
    const width=mini?Math.min(80,this.width):this.width, left=(this.width-width)/2, step=width/n;
    const bar=Math.max(1,Math.min(mini?5:6,step*.72));
    const dots=this.options.style==='dots',bottom=this.options.position==='bottom';
    const dot=Math.min(bottom?2:4,bar),dotPitch=bottom?3:5;
    const area=new Path2D(),crest=new Path2D();
    for(let i=0;i<n;i++){
      const height=Math.max(2,this.levels[i]*(this.height-6)),x=left+i*step+(step-bar)/2;
      if(dots){
        let top=this.height-2;
        for(let y=this.height-2;y>=this.height-height;y-=dotPitch){area.rect(x,y,dot,2);top=y;}
        crest.rect(x,top,dot,2);
      } else {area.rect(x,this.height-height,bar,height);crest.moveTo(x,this.height-height);crest.lineTo(x+bar,this.height-height);}
    }
    c.fill(area);
    if(dots){c.fillStyle=this.waveCrest;c.fill(crest);}else c.stroke(crest);
  }
  dispose(){this.disposed=true;cancelAnimationFrame(this.frame);this.observer.disconnect();this.mutations.disconnect();this.canvas.remove();this.stage.classList.remove('has-bottom-visualizer');}
}
