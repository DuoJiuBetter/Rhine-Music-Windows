import { escapeHtml as esc } from './html';
import type { LyricLine } from './music-lyrics';
import { songViewTabsMarkup } from './music-song-view';
import { MusicLyricScroll } from './music-lyric-scroll';

type Preview = { title: string; artist: string; lines: readonly LyricLine[]; current: number; time: number; duration: number };
const example: LyricLine[] = ['让音乐在这一刻缓缓流动', '窗外的风经过安静街道', '把此刻的心情写进旋律', '这一句是当前歌词的大小', '下一段故事还在路上', '你可以继续调整显示区域', '每一行都留下一点呼吸', '让喜欢的旋律陪你更久'].map((text, i) => ({time:i*4,text}));

/** Read-only isolated DOM preview: no audio, routing, account calls or duplicate document IDs. */
export class LyricSettingsPreview {
  private stage: HTMLElement;
  private getData: () => Preview;
  private host?: HTMLElement;
  private shadow?: ShadowRoot;
  private scroll?: MusicLyricScroll;
  private lines?: readonly LyricLine[];
  private title = '';
  private current = -1;
  private controls?: AbortController;
  constructor(stage: HTMLElement, getData: () => Preview) { this.stage=stage; this.getData=getData; }
  bindControls(enabled: () => boolean) {
    this.controls?.abort();this.controls=new AbortController();
    const signal=this.controls.signal,doc=this.stage.ownerDocument,win=doc.defaultView;
    const target=(event:Event)=>event.target instanceof HTMLElement && event.target.id==='lyric-area-size';
    doc.addEventListener('pointerdown',event=>{if(enabled()&&target(event))this.start();},{signal,capture:true});
    for(const name of ['pointerup','pointercancel','lostpointercapture']) doc.addEventListener(name,()=>this.stop(),{signal,capture:true});
    doc.addEventListener('keydown',event=>{
      if(event.key==='Escape')this.stop();
      else if(enabled()&&target(event)&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(event.key))this.start();
    },{signal,capture:true});
    doc.addEventListener('keyup',event=>{if(target(event))this.stop();},{signal,capture:true});
    doc.addEventListener('visibilitychange',()=>{if(doc.hidden)this.stop();},{signal});
    win?.addEventListener('blur',()=>this.stop(),{signal});
  }
  get active() { return !!this.host; }
  start() {
    if (this.host) return;
    const host=this.host=document.createElement('div');host.className='lyric-settings-preview';host.inert=true;host.setAttribute('aria-hidden','true');
    this.shadow=host.attachShadow({mode:'open'});
    const style=document.createElement('style');
    style.textContent=Array.from(document.styleSheets).map(sheet=>{try{return Array.from(sheet.cssRules).map(rule=>rule.cssText).join('\n');}catch{return '';}}).join('\n')+
      '\n.music-app{position:absolute!important;inset:0;width:100%;height:100%;background:transparent!important}.music-detail,#album-detail-content{pointer-events:none!important}#song-lyrics{overflow:hidden!important}.lyric-line{transition:none!important}';
    this.shadow.append(style);
    const wrapper=document.createElement('div');wrapper.className='music-app';wrapper.dataset.mode='detail';wrapper.dataset.layout=this.stage.dataset.layout;wrapper.dataset.theme=this.stage.dataset.theme;
    wrapper.innerHTML='<section class="music-detail"><article id="album-detail-content"><div class="detail-overline">歌词布局预览</div><h1></h1><p class="detail-artist"></p><section id="song-view" data-lyrics-active="true">'+songViewTabsMarkup()+'<div class="song-view-heading"><button id="song-toggle-stop" tabindex="-1">播放</button></div><section id="song-lyric-view"><div class="lyric-window"><div id="song-lyrics"></div></div><div class="lyric-transport"><div class="lyric-order-row" style="height:32px"></div><input class="playback-seek" type="range" min="0" max="180" value="40" tabindex="-1"><div class="song-time"><span>0:40</span><span>3:00</span></div></div></section></section></article></section>';
    this.shadow.append(wrapper);this.stage.append(host);this.stage.classList.add('lyric-size-preview-active');this.lines=undefined;this.current=-1;this.refresh();
  }
  refresh() {
    if (!this.shadow) return;
    const data=this.getData(), lines=data.lines.length?data.lines:example, current=data.lines.length?Math.min(data.current,lines.length-1):3;
    this.shadow.querySelector('h1')!.textContent=data.title;
    this.shadow.querySelector('.detail-artist')!.textContent=data.artist || (data.lines.length?'':'示例歌词，仅用于预览');
    const node=this.shadow.querySelector<HTMLElement>('#song-lyrics')!;
    if(this.lines!==lines || this.title!==data.title){
      this.lines=lines;this.title=data.title;this.scroll?.dispose();
      node.innerHTML=lines.map((line,i)=>`<div class="lyric-line${i===current?' current':''}">${esc(line.text)}${line.translation?`<small>${esc(line.translation)}</small>`:''}</div>`).join('');
      this.scroll=new MusicLyricScroll(node,()=>true,()=>{});
    }else if(this.current!==current){node.children[this.current]?.classList.remove('current');node.children[current]?.classList.add('current');}
    this.current=current;
    const active=node.children[current] as HTMLElement | undefined;if(active)this.scroll?.follow(active,true);
    const range=this.shadow.querySelector<HTMLInputElement>('.playback-seek')!;
    const duration=data.lines.length?Math.max(1,data.duration):180,time=data.lines.length?data.time:40;
    range.max=String(duration);range.value=String(time);range.style.setProperty('--progress',`${Math.min(100,time/duration*100)}%`);
    const clock=(s:number)=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
    const times=this.shadow.querySelectorAll('.song-time span');times[0].textContent=clock(time);times[1].textContent=clock(duration);
  }
  stop() { this.scroll?.dispose();this.scroll=undefined;this.host?.remove();this.host=undefined;this.shadow=undefined;this.stage.classList.remove('lyric-size-preview-active'); }
  dispose() { this.controls?.abort();this.controls=undefined;this.stop(); }
}
