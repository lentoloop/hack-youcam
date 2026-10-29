import { expect, it } from 'vitest';
import { normalizeImage, sha256 } from '../../service/image';
import { jpeg } from './helpers';

const segment = (marker: number, payload: number[]) => [0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 255, ...payload];
const file = (bytes: Uint8Array) => new File([bytes], 'capture.jpg', { type: 'image/jpeg' });

it('strips APP1–APP15 and COM before hashing while preserving scan bytes', async () => {
  const header = [...jpeg().slice(0, -2)];
  const scan = [0xff, 0xda, 0, 2, 12, 0xff, 0, 44, 0xff, 0xd0, 55];
  const app0 = segment(0xe0, [1, 2, 3]);
  const metadata = Array.from({ length: 15 }, (_, index) => segment(0xe1 + index, [71, 80, 83])).flat();
  const expected = new Uint8Array([...header, ...app0, ...scan, ...scan, 0xff, 0xd9]);
  const uploaded = new Uint8Array([...header, ...metadata, ...app0, ...scan, ...segment(0xfe, [99, 111, 109]), ...metadata, ...scan, 0xff, 0xd9, ...metadata]);
  const result = await normalizeImage(file(uploaded));
  expect(result.bytes).toEqual(expected);
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
