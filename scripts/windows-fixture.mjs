import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

export function fixtureLibrary(count = 96) {
  return { version: 1, roots: [], onlineEnabled: false, scan: { running: false },
    genres: Array.from({ length: 8 }, (_, i) => ({ id: `g${i}`, name: `测试分类 ${i + 1}` })),
    albums: Array.from({ length: count }, (_, i) => ({ id: `fixture-${i}`, title: `测试专辑 ${String(i + 1).padStart(3, '0')}`,
      artist: `测试歌手 ${Math.floor(i / 12) + 1}`, year: 2026, genreId: `g${Math.floor(i / 12) % 8}`,
      coverUrl: `/demo-covers/${['square', 'portrait', 'landscape'][i % 3]}.png`, rawGenres: [], producers: [],
      folder: 'Generated test fixture', offline: false,
      tracks: [{ id: `track-${i}`, title: `合成静音 ${i + 1}`, artist: '测试音频', track: 1, disc: 1,
        duration: 2, format: 'WAV', codec: 'PCM', sampleRate: 16000, bitsPerSample: 16, channels: 1,
        relativePath: 'generated.wav', audioUrl: '/fixture.wav', browserPlayable: true }]
    })) };
}
export function silentWav(duration = 2) {
  const bytes = Math.round(32000 * duration), buffer = Buffer.alloc(44 + bytes);
  buffer.write('RIFF'); buffer.writeUInt32LE(bytes + 36, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(16000, 24); buffer.writeUInt32LE(32000, 28); buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(bytes, 40);
  return buffer;
}
export async function startFixture(dist, count = 96) {
  const root = path.resolve(dist), library = fixtureLibrary(count);
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml' };
  const server = http.createServer(async (request, response) => {
    try {
      const route = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      response.setHeader('Cache-Control', 'no-store');
      if (route.startsWith('/api/')) {
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify(route === '/api/library' ? library : route === '/api/audio/capabilities'
          ? { decoderAvailable: false, nativeAvailable: false, devices: [] } : {})); return;
      }
      if (route === '/fixture.wav') { response.setHeader('Content-Type', 'audio/wav'); response.end(silentWav()); return; }
      const file = path.resolve(root, `.${route === '/' ? '/index.html' : route}`);
      const relative = path.relative(root, file);
      if (relative.startsWith('..') || path.isAbsolute(relative)) { response.writeHead(403).end(); return; }
      response.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
      response.end(await fs.readFile(file));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}/`, server,
    close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }) };
}
