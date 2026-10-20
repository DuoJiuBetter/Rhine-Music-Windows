import './music-visualizer-color.css';

function hsvHex(h: number, s: number, v: number) {
  const chroma = v * s, x = chroma * (1 - Math.abs((h / 60) % 2 - 1)), m = v - chroma;
  const rgb = h < 60 ? [chroma,x,0] : h < 120 ? [x,chroma,0] : h < 180 ? [0,chroma,x]
    : h < 240 ? [0,x,chroma] : h < 300 ? [x,0,chroma] : [chroma,0,x];
  return '#' + rgb.map(value => Math.round((value + m) * 255).toString(16).padStart(2,'0')).join('');
}
function hexHsv(hex: string) {
  const [r,g,b] = [1,3,5].map(i => parseInt(hex.slice(i,i+2),16) / 255);
  const max = Math.max(r,g,b), delta = max - Math.min(r,g,b);
  const hue = !delta ? 0 : max === r ? ((g-b)/delta) % 6 : max === g ? (b-r)/delta+2 : (r-g)/delta+4;
  return {h: (hue * 60 + 360) % 360, s: max ? delta/max : 0, v: max};
}

/** Local, bounded pointer work; no canvas readback, network or color library. */
export function mountVisualizerColorPicker(root: HTMLElement, read: () => string | undefined,
  save: (color: string | undefined) => void): () => void {
  const picker = root.querySelector<HTMLDetailsElement>('[data-visualizer-color-picker]');
  if (!picker) return () => {};
  const events = new AbortController(), signal = events.signal;
  const wheel = picker.querySelector<HTMLElement>('[data-color-wheel]')!;
  const value = picker.querySelector<HTMLElement>('[data-color-value]')!;
  const wheelHandle = picker.querySelector<HTMLElement>('[data-color-wheel-handle]')!;
  const valueHandle = picker.querySelector<HTMLElement>('[data-color-value-handle]')!;
  const input = picker.querySelector<HTMLInputElement>('[data-color-hex]')!;
  const themeColor = () => root.closest<HTMLElement>('.music-app')?.dataset.theme === 'night' ? '#bee3ff' : '#af7024';
  let state = hexHsv(read() || themeColor()), drag: {element: HTMLElement; id: number} | undefined;
  const paint = () => {
    const color = hsvHex(state.h,state.s,state.v), angle = state.h * Math.PI/180;
    picker.style.setProperty('--picker-color',color);
    picker.style.setProperty('--picker-hue',hsvHex(state.h,state.s,1));
    picker.querySelector<HTMLElement>('[data-color-swatch]')!.style.background = color;
    picker.querySelector('[data-color-label]')!.textContent = read() ? color.toUpperCase() : '跟随主题';
    input.value = color.toUpperCase(); input.setCustomValidity('');
    wheelHandle.style.left = `${50 + Math.sin(angle)*state.s*50}%`;
    wheelHandle.style.top = `${50 - Math.cos(angle)*state.s*50}%`;
    wheelHandle.style.background = hsvHex(state.h,state.s,1);
    valueHandle.style.top = `${(1-state.v)*100}%`;
    wheel.setAttribute('aria-valuenow',String(Math.round(state.h)));
    wheel.setAttribute('aria-valuetext',`色相 ${Math.round(state.h)}°，饱和度 ${Math.round(state.s*100)}%`);
    value.setAttribute('aria-valuenow',String(Math.round(state.v*100)));
  };
  const commit = () => { save(hsvHex(state.h,state.s,state.v)); paint(); };
  const move = (event: PointerEvent, element: HTMLElement) => {
    const box = element.getBoundingClientRect();
    if (!box.width || !box.height) return;
    if (element === wheel) {
      const x = (event.clientX-box.left)/box.width*2-1, y = (event.clientY-box.top)/box.height*2-1;
      state.h = (Math.atan2(x,-y)*180/Math.PI+360)%360;
      state.s = Math.min(1,Math.hypot(x,y));
    } else state.v = Math.max(0,Math.min(1,1-(event.clientY-box.top)/box.height));
    commit();
  };
  for (const element of [wheel,value]) {
    element.addEventListener('pointerdown',event => {
      if (event.button !== 0 || drag) return;
      event.preventDefault(); element.setPointerCapture(event.pointerId);
      drag = {element,id:event.pointerId}; move(event,element);
    },{signal});
    element.addEventListener('pointermove',event => {
      if (drag?.element === element && drag.id === event.pointerId) move(event,element);
    },{signal});
    const release = (event: PointerEvent) => {
      if (drag?.id !== event.pointerId || drag.element !== element) return;
      drag = undefined;
      if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
    };
    element.addEventListener('pointerup',release,{signal});
    element.addEventListener('pointercancel',release,{signal});
    element.addEventListener('lostpointercapture',() => { drag=undefined; },{signal});
    element.addEventListener('keydown',event => {
      if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
      event.preventDefault();event.stopPropagation();
      const step = event.key === 'ArrowUp' || event.key === 'ArrowRight' ? 1 : -1;
      if (element === value) state.v = Math.max(0,Math.min(1,state.v+step*.02));
      else if (event.shiftKey) state.s = Math.max(0,Math.min(1,state.s+step*.02));
      else state.h = (state.h+step*2+360)%360;
      commit();
    },{signal});
  }
  input.addEventListener('input',() => {
    const color = input.value.startsWith('#') ? input.value : '#'+input.value;
    if (/^#[\da-f]{6}$/i.test(color)) { state=hexHsv(color);commit(); }
  },{signal});
  input.addEventListener('change',() => { paint(); },{signal});
  picker.querySelector('[data-color-reset]')!.addEventListener('click',() => {
    save(undefined);state=hexHsv(themeColor());paint();
  },{signal});
  paint();
  return () => {
    events.abort();
    if (drag?.element.hasPointerCapture(drag.id)) drag.element.releasePointerCapture(drag.id);
    drag=undefined;
  };
}
