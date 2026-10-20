import assert from 'node:assert/strict';

// Exact-source, experiment-only instrumentation. No vendor or production edits.
export function instrumentTransmission(source) {
  let s = source.replaceAll('\r\n', '\n');
  const once = (marker, replacement) => {
    assert.equal(s.split(marker).length, 2, `Unique Three.js marker required: ${marker}`);
    s = s.replace(marker, replacement);
  };
  const wrap = (name, args, label) => {
    const raw = name + 'MicroRaw';
    once(`function ${name}( ${args} ) {`, `function ${name}( ${args} ) {
      const probe = globalThis.__rhineMicro;
      return probe ? probe.measure('${label}', () => ${raw}(...arguments)) : ${raw}(...arguments);
    }
    function ${raw}( ${args} ) {`);
  };
  wrap('renderTransmissionPass', 'opaqueObjects, transmissiveObjects, scene, camera', 'transmissionRest');
  once('renderObjects( opaqueObjects, scene, camera );\n\n\t\t\ttextures.updateMultisampleRenderTarget',
    "globalThis.__rhineMicro.measure('transmissionOpaque', () => renderObjects( opaqueObjects, scene, camera ));\n\n\t\t\ttextures.updateMultisampleRenderTarget");
  for (const [method, label] of [['updateMultisampleRenderTarget', 'transmissionResolve'], ['updateRenderTargetMipmap', 'transmissionMipmaps']]) {
    const marker = `textures.${method}( transmissionRenderTarget );`;
    assert.equal(s.split(marker).length, 3, 'Both original transmission resolve/mipmap sites required');
    s = s.replaceAll(marker, `globalThis.__rhineMicro.measure('${label}', () => ${marker.slice(0, -1)});`);
  }
  once('if ( opaqueObjects.length > 0 ) renderObjects( opaqueObjects, scene, camera );',
    "if ( opaqueObjects.length > 0 ) globalThis.__rhineMicro.measure('mainOpaque', () => renderObjects( opaqueObjects, scene, camera ));");
  once('if ( transmissiveObjects.length > 0 ) renderObjects( transmissiveObjects, scene, camera );',
    "if ( transmissiveObjects.length > 0 ) globalThis.__rhineMicro.measure('glassShading', () => renderObjects( transmissiveObjects, scene, camera ));");
  wrap('uploadTexture', 'textureProperties, texture, slot', 'textureUploadRest');
  wrap('generateMipmap', 'target', 'textureMipmaps');
  for (const [name, label] of [['texStorage2D', 'textureStorage'], ['texSubImage2D', 'texturePixels'], ['texImage2D', 'textureImage']]) {
    // Zero-argument WebGLState helpers forward their original arguments.
    const marker = `function ${name}() {`;
    const raw = name + 'MicroRaw';
    once(marker, `function ${name}() {
      const probe = globalThis.__rhineMicro;
      return probe ? probe.measure('${label}', () => ${raw}(...arguments)) : ${raw}(...arguments);
    }
    function ${raw}() {`);
  }
  return s;
}
