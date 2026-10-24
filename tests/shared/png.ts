import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
/** Minimal fixture-only decoder: non-interlaced 8-bit RGBA PNG, all five row filters. */
export function png(path: URL | Uint8Array) {
    const b = path instanceof URL ? readFileSync(path) : Buffer.from(path);
    let width = 0, height = 0;
    const chunks: Uint8Array[] = [];
    for (let p = 8; p < b.length;) {
        const n = b.readUInt32BE(p), type = b.toString('ascii', p + 4, p + 8), data = b.subarray(p + 8, p + 8 + n);
        if (type === 'IHDR') {
            width = data.readUInt32BE(0);
            height = data.readUInt32BE(4);
            if (data[8] !== 8 || data[9] !== 6 || data[12] !== 0)
                throw Error('Unsupported fixture PNG');
        }
        if (type === 'IDAT')
            chunks.push(data);
        p += n + 12;
    }
    const raw = inflateSync(Buffer.concat(chunks)), stride = width * 4, data = new Uint8Array(stride * height);
    let p = 0;
    for (let y = 0; y < height; y++) {
        const filter = raw[p++]!;
        for (let x = 0; x < stride; x++) {
            const i = y * stride + x, a = x >= 4 ? data[i - 4]! : 0, b = y ? data[i - stride]! : 0, c = y && x >= 4 ? data[i - stride - 4]! : 0;
            let pred = 0;
            if (filter === 1)
                pred = a;
            else if (filter === 2)
                pred = b;
            else if (filter === 3)
                pred = Math.floor((a + b) / 2);
            else if (filter === 4) {
                const v = a + b - c, pa = Math.abs(v - a), pb = Math.abs(v - b), pc = Math.abs(v - c);
                pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
            }
            else if (filter !== 0)
                throw Error('Invalid filter');
            data[i] = (raw[p++]! + pred) & 255;
        }
    }
    return { width, height, data };
}
