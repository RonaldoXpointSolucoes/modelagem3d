import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeAppwrite } from './fake-appwrite.js';

let fake;
before(async () => {
  fake = await startFakeAppwrite();
  Object.assign(process.env, { APPWRITE_ENDPOINT: fake.url, APPWRITE_PROJECT_ID: 'p', APPWRITE_API_KEY: 'test-key' });
});
after(() => fake.server.close());

test('upload acima de 5 MB vai em partes e o arquivo chega inteiro', async () => {
  const { storage } = await import('../src/lib/appwrite.js');
  const big = Buffer.alloc(12 * 1024 * 1024 + 123, 7);
  big[0] = 1; big[big.length - 1] = 9;
  await storage.upload('grande', big, 'g.bin', 'application/octet-stream', []);
  const f = fake.files.get('grande');
  assert.equal(f.buf.length, big.length);
  assert.ok(f.buf.equals(big));
  assert.equal(fake.chunks.length, 3);
  assert.match(fake.chunks[2], /^bytes 10485760-12583034\/12583035$/);
});
