import { expect, it } from 'vitest';
import { normalizeImage, sha256, stripJpegMetadataInPlace } from '../../service/image';
import { jpeg } from './helpers';

const segment = (marker: number, payload: number[]) => [0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 255, ...payload];
const file = (bytes: Uint8Array) => new File([bytes], 'capture.jpg', { type: 'image/jpeg' });

it('strips private metadata before hashing while preserving color segments and scan bytes', async () => {
  const header = [...jpeg().slice(0, -2)];
  const scan = [0xff, 0xda, 0, 2, 12, 0xff, 0, 44, 0xff, 0xd0, 55, 0xff, 0xff, 0xd1, 66];
  const app0 = segment(0xe0, [1, 2, 3]);
  const metadata = Array.from({ length: 15 }, (_, index) => segment(0xe1 + index, [71, 80, 83])).flat();
  const color = [...segment(0xe2, [...new TextEncoder().encode('ICC_PROFILE\0'), 1, 1, 42]), ...segment(0xee, [...new TextEncoder().encode('Adobe'), 0, 100])];
  const expected = new Uint8Array([...header, ...color, ...app0, ...scan, ...color, ...scan, 0xff, 0xd9]);
  const uploaded = new Uint8Array([...header, ...metadata, ...color, ...app0, ...scan, ...segment(0xfe, [99, 111, 109]), ...metadata, ...color, ...scan, 0xff, 0xd9, ...metadata]);
  const result = await normalizeImage(file(uploaded));
  expect(Buffer.compare(Buffer.from(result.bytes), Buffer.from(expected))).toBe(0);
  expect(result.sha256).toBe(await sha256(expected));
  expect(result).toMatchObject({ width: 480, height: 640 });
});

it.each([
  [...jpeg().slice(0, -2), 0xff, 0xe1, 0, 9, 1],
  [...jpeg().slice(0, -2), 0xff, 0xfe, 0, 1],
  [...jpeg().slice(0, -2), 0xff, 0xda, 0, 2, 1, 0xff],
])('rejects malformed JPEG metadata or scan boundaries', async bytes => {
  await expect(normalizeImage(file(new Uint8Array(bytes)))).rejects.toThrow('valid JPEG');
});

it('keeps a real JPEG decodable with identical pixels after removing EXIF', async () => {
  const { encode, decode } = await import('../../service/node_modules/jpeg-js');
  const rgba = new Uint8Array(480 * 480 * 4).fill(127);
  const original = new Uint8Array(encode({ width: 480, height: 480, data: rgba }, 50).data);
  const withExif = new Uint8Array([...original.subarray(0, 2), ...segment(0xe1, [...new TextEncoder().encode('Exif\0\0GPS location')]), ...original.subarray(2)]);
  const normalized = await normalizeImage(file(withExif));
  expect(normalized.bytes).toEqual(original);
  expect(decode(normalized.bytes).data).toEqual(decode(original).data);
});

it.each(['plain', 'stuffed', 'mixed'])('strips metadata from a maximum-size %s upload while preserving its full scan', async kind => {
  const { IMAGE_LIMITS } = await import('../../contracts');
  const metadata = segment(0xe1, [71, 80, 83]);
  const header = [...jpeg().slice(0, -2), ...metadata, 0xff, 0xda, 0, 2];
  const uploaded = new Uint8Array(IMAGE_LIMITS.maxBytes).fill(42);
  uploaded.set(header);
  if (kind !== 'plain') {
    const pattern = kind === 'stuffed' ? [255, 0] : [255, 0, 42, 255, 0, 43];
    for (let p = header.length; p < uploaded.length - 2; p++) uploaded[p] = pattern[(p - header.length) % pattern.length]!;
    if (uploaded[uploaded.length - 3] === 255) uploaded[uploaded.length - 3] = 42;
  }
  uploaded.set([0xff, 0xd9], uploaded.length - 2);
  const expected = new Uint8Array(uploaded.length - metadata.length);
  expected.set(jpeg().slice(0, -2));
  expected.set(uploaded.subarray(header.length - 4), jpeg().length - 2);
  const result = await normalizeImage(file(uploaded));
  expect(Buffer.compare(Buffer.from(result.bytes), Buffer.from(expected))).toBe(0);
  expect(result.sha256).toBe(await sha256(expected));
});

it.each([
  [0xe2, 'GPS'],
  [0xe2, 'FPXR'],
  [0xe2, 'MPF\0'],
  [0xe2, 'ICC_PROFILE'],
  [0xee, 'GPS'],
  [0xee, 'Adob'],
])('drops private or incomplete color metadata in marker %i with payload %s', async (marker, payload) => {
  const original = jpeg();
  const uploaded = new Uint8Array([...original.slice(0, -2), ...segment(marker, [...new TextEncoder().encode(payload)]), 0xff, 0xd9]);
  const result = await normalizeImage(file(uploaded));
  expect(result.bytes).toEqual(original);
  expect(result.sha256).toBe(await sha256(original));
});

it.each([[[255, 255, 0]], [[255, 0, 255, 255, 0]]])('rejects a 5 MiB scan with invalid FF fill bytes in bounded time (%j)', pattern => {
  const uploaded = new Uint8Array(5 * 1024 * 1024);
  const header = [...jpeg().slice(0, -2), 255, 218, 0, 2];
  uploaded.set(header);
  for (let p = header.length; p < uploaded.length - 2; p++) uploaded[p] = pattern[(p - header.length) % pattern.length]!;
  uploaded.set([255, 217], uploaded.length - 2);
  const started = performance.now();
  expect(() => stripJpegMetadataInPlace(uploaded)).toThrow(expect.objectContaining({ code: 'invalid_image' }));
  expect(performance.now() - started).toBeLessThan(100);
});
