import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const directory = await mkdtemp(join(tmpdir(), 'jpeg-strip-'));
try {
  const compiled = await build({ entryPoints: [fileURLToPath(new URL('../image.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', write: false });
  const modulePath = join(directory, 'image.mjs');
  await writeFile(modulePath, compiled.outputFiles[0].contents);
  const { stripJpegMetadataInPlace } = await import(pathToFileURL(modulePath).href);
  for (const pattern of [[42], [255, 0], [255, 0, 42, 255, 0, 43], [255, 255, 0], [255, 0, 255, 255, 0]]) {
    const source = new Uint8Array(5 * 1024 * 1024);
    const header = [255, 216, 255, 225, 0, 5, 71, 80, 83, 255, 218, 0, 2];
    source.set(header);
    for (let p = header.length; p < source.length - 2; p++) source[p] = pattern[(p - header.length) % pattern.length];
    if (source[source.length - 3] === 255) source[source.length - 3] = 42;
    source.set([255, 217], source.length - 2);
    const expected = Buffer.concat([Buffer.from([255, 216]), Buffer.from(source.subarray(9))]);
    const invalidFill = pattern.some((byte, index) => byte === 255 && pattern[index + 1] === 255);
    const times = [];
    const input = source.slice();
    for (let run = 0; run < 20; run++) {
      input.set(source);
      const start = process.threadCpuUsage();
      let output;
      if (invalidFill) {
        assert.throws(() => stripJpegMetadataInPlace(input), error => error.code === 'invalid_image');
      } else {
        output = stripJpegMetadataInPlace(input);
      }
      const cpu = process.threadCpuUsage(start);
      if (output) assert.equal(Buffer.compare(Buffer.from(output.buffer, output.byteOffset, output.byteLength), expected), 0);
      if (run >= 10) times.push((cpu.user + cpu.system) / 1000);
    }
    times.sort((a, b) => a - b);
    console.log(JSON.stringify({ pattern, outcome: invalidFill ? 'invalid_image' : 'preserved scan', bytes: source.length, runs: times.length, cpuMs: { min: times[0], median: times[5], max: times.at(-1) }, scope: 'strip only; excludes fixture copy, SHA-256 and upload; local Node thread CPU, not Workers CPU' }));
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
