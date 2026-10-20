import * as THREE from 'three';
import {copyCoverPixels} from '../src/selected-cover-cache.ts';

// One 4x3 draw and 48-byte readback. A fidelity check, never a timing benchmark.
window.runCoverPixelCheck = () => {
  const canvas=document.createElement('canvas');canvas.width=2;canvas.height=3;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  const input=new Uint8ClampedArray([255,0,0,255,0,255,0,128,0,0,255,255,255,255,0,64,128,128,128,255,0,0,0,0]);
  ctx.putImageData(new ImageData(input,2,3),0,0);
  const original=new THREE.CanvasTexture(canvas);original.colorSpace=THREE.SRGBColorSpace;
  const bytes=new Uint8Array(24);copyCoverPixels(canvas,bytes);
  const rgba=new THREE.DataTexture(bytes,2,3);rgba.colorSpace=THREE.SRGBColorSpace;rgba.flipY=false;
  rgba.magFilter=THREE.LinearFilter;rgba.minFilter=THREE.LinearMipmapLinearFilter;rgba.generateMipmaps=true;rgba.needsUpdate=true;
  const renderer=new THREE.WebGLRenderer({antialias:false,alpha:true,premultipliedAlpha:false});
  renderer.setPixelRatio(1);renderer.setSize(4,3,false);renderer.outputColorSpace=THREE.SRGBColorSpace;
  const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-2,2,1.5,-1.5,.1,10);camera.position.z=5;
  const geometry=new THREE.PlaneGeometry(2,3),materials=[];
  for(const [i,map]of [original,rgba].entries()){
    const material=new THREE.MeshBasicMaterial({map,transparent:true,blending:THREE.NoBlending});materials.push(material);
    const mesh=new THREE.Mesh(geometry,material);mesh.position.x=i?1:-1;scene.add(mesh);
  }
  try {
    renderer.render(scene,camera);
    const gl=renderer.getContext(),pixels=new Uint8Array(48);gl.readPixels(0,0,4,3,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    if(gl.getError()!==gl.NO_ERROR)throw Error('Pixel fidelity GL error');
    let maxDifference=0;
    for(let row=0;row<3;row++)for(let col=0;col<2;col++)for(let component=0;component<4;component++)
      maxDifference=Math.max(maxDifference,Math.abs(pixels[(row*4+col)*4+component]-pixels[(row*4+col+2)*4+component]));
    const topLeft=[...pixels.slice(32,36)],bottomLeft=[...pixels.slice(0,4)];
    if(maxDifference>1||topLeft[0]<250||topLeft[1]>2||Math.abs(bottomLeft[0]-128)>2)
      throw Error('Canvas and RGBA differ: '+JSON.stringify({maxDifference,topLeft,bottomLeft}));
    return {passed:true,width:4,height:3,draws:2,maxDifference,topLeft,bottomLeft,
      note:'One tiny readback compares orientation, sRGB, alpha and filtering at texel centres. Not a performance measurement.'};
  } finally {materials.forEach(m=>m.dispose());geometry.dispose();original.dispose();rgba.dispose();renderer.dispose();}
};
