/** Validate the complete PNG container before forwarding or decoding a mask. */
export function validMaskHeader(bytes: Uint8Array): boolean {
  if (bytes.length < 33 || ![137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v)) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let idat = false, endedIdat = false;
  for (let p = 8; p < bytes.length;) {
    if (bytes.length - p < 12) return false;
    const n = view.getUint32(p);
    if (n > bytes.length - p - 12) return false;
    const type = String.fromCharCode(...bytes.subarray(p+4,p+8));
    if (!/^[A-Za-z]{4}$/.test(type)) return false;
    let crc = 0xffffffff;
    for (let i = p+4; i < p+8+n; i++) {
      crc ^= bytes[i]!;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    if (((crc ^ 0xffffffff) >>> 0) !== view.getUint32(p+8+n)) return false;
    if (p === 8) {
      if (type !== 'IHDR' || n !== 13 || view.getUint32(16) !== 600 || view.getUint32(20) !== 800 || bytes[24] !== 8 || bytes[25] !== 6 || bytes[26] !== 0 || bytes[27] !== 0 || bytes[28] !== 0) return false;
    } else if (type === 'IHDR') return false;
    if (type === 'IDAT') { if (endedIdat) return false; idat = true; }
    else if (idat) endedIdat = true;
    if (type === 'IEND') return n === 0 && idat && p+12 === bytes.length;
    p += n+12;
  }
  return false;
}
