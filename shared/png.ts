/** Validate the expected mask header before any image decoding/allocation. */
export function validMaskHeader(bytes: Uint8Array): boolean {
  if (bytes.length < 33 || ![137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82].every((v,i) => bytes[i] === v)) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(16) === 600 && view.getUint32(20) === 800 && bytes[24] === 8 && bytes[25] === 6 && bytes[26] === 0 && bytes[27] === 0 && bytes[28] === 0;
}
