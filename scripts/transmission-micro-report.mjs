// Pure arithmetic; importing this module never starts a browser or GPU task.
export function countMicroOperation(capture, label) {
  return Object.entries(capture?.counters || {}).reduce((sum, [key, count]) => sum + (key.endsWith('/' + label) ? count : 0), 0);
}
export function splitMicroFrames(capture, phases) {
  if (capture.frames.length !== phases.length || capture.pendingFrames || capture.droppedFrames || capture.disjointEvents)
    throw new Error('Cannot split incomplete capture');
  return [...capture.frames].sort((a,b) => a.id-b.id).map((frame,index) => {
    const total = Object.values(frame.values).reduce((a,b) => a+b, 0);
    return {...phases[index], frames: [frame], gpu: {samples: 1, totalMs: total},
      pendingFrames: 0, droppedFrames: 0, disjointEvents: 0};
  });
}
export function summarizeTransmission(result) {
  const sum = (capture, predicate) => Object.entries(capture?.frames[0]?.values || {}).reduce((a, [key, value]) => a + (predicate(key) ? value : 0), 0);
  const summary = {};
  for (const row of result.rows) {
    const r = row.render, p = row.preparation;
    const values = {
      renderGpuMs: r.gpu.totalMs, preparationGpuMs: p?.gpu.totalMs || 0,
      combinedGpuMs: r.gpu.totalMs + (p?.gpu.totalMs || 0),
      renderSubmissionMs: r.submissionMs, preparationSubmissionMs: p?.submissionMs || 0,
      transmissionTotalMs: sum(r, key => key.startsWith('renderRest/transmissionRest')),
      transmissionOpaqueInclusiveMs: sum(r, key => key.startsWith('renderRest/transmissionRest/transmissionOpaque')),
      transmissionOpaqueExclusiveMs: sum(r, key => key === 'renderRest/transmissionRest/transmissionOpaque'),
      transmissionTextureUploadMs: sum(r, key => key.startsWith('renderRest/transmissionRest/transmissionOpaque/textureUploadRest')),
      textureUploadAllMs: sum(r, key => key.split('/').includes('textureUploadRest')) + sum(p, key => key.split('/').includes('textureUploadRest')),
      textureStorageMs: sum(r, key => key.endsWith('/textureStorage')) + sum(p, key => key.endsWith('/textureStorage')),
      texturePixelsMs: sum(r, key => key.endsWith('/texturePixels')) + sum(p, key => key.endsWith('/texturePixels')),
      coverMipmapsMs: sum(r, key => key.includes('/textureUploadRest/') && key.endsWith('/textureMipmaps')) + sum(p, key => key.includes('/textureUploadRest/') && key.endsWith('/textureMipmaps')),
      transmissionResolveMs: sum(r, key => key.includes('/transmissionResolve')),
      transmissionMipmapsMs: sum(r, key => key.includes('/transmissionMipmaps')),
      glassShadingMs: sum(r, key => key.startsWith('renderRest/glassShading')),
      mainOpaqueMs: sum(r, key => key.startsWith('renderRest/mainOpaque')),
    };
    row.metrics = values;
    (summary[row.name] ??= []).push(values);
  }
  return Object.fromEntries(Object.entries(summary).map(([name, rows]) => [name,
    Object.fromEntries(Object.keys(rows[0]).map(key => {
      const values = rows.map(row => row[key]).sort((a, b) => a - b);
      return [key, {samples: values.length, mean: values.reduce((a,b) => a+b, 0) / values.length,
        median: (values[Math.floor((values.length - 1) / 2)] + values[Math.floor(values.length / 2)]) / 2, max: values.at(-1)}];
    }))]));
}
