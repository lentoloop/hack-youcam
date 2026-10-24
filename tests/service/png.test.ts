import {it,expect} from '../../service/node_modules/vitest';
import {readFileSync} from 'node:fs';
import {validMaskHeader} from '../../shared/png';
it('requires complete PNG chunks, valid CRCs, IDAT and final IEND',()=>{
 const valid=new Uint8Array(readFileSync(new URL('../shared/fixtures/URL_3.png',import.meta.url)));
 expect(validMaskHeader(valid)).toBe(true);
 expect(validMaskHeader(valid.slice(0,33))).toBe(false);
 const bad=valid.slice(); bad[29]^=1; expect(validMaskHeader(bad)).toBe(false);
 expect(validMaskHeader(valid.slice(0,-12))).toBe(false);
 const trailing=new Uint8Array(valid.length+1); trailing.set(valid); expect(validMaskHeader(trailing)).toBe(false);
 const oversized=valid.slice(); oversized.fill(255,33,37); expect(validMaskHeader(oversized)).toBe(false);
});
