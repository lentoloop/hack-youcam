// @vitest-environment node
import { it, expect } from 'vitest';
import { deriveRegions } from '../../shared/regions';
import { png } from './png';
export const realRegions = () => deriveRegions({ acne: png(new URL('./fixtures/URL_4.png', import.meta.url)), redness: png(new URL('./fixtures/URL_3.png', import.meta.url)), tZone: png(new URL('./fixtures/URL_6.png', import.meta.url)), uZone: png(new URL('./fixtures/URL_7.png', import.meta.url)) });
it('counts real run2 mask components with T-zone precedence', () => { const r = realRegions(); expect(r.zones.map(z => z.acneSpots)).toEqual([7, 21, 2]); expect(r.zones[1]!.acneSpots).toBeGreaterThan(r.zones[0]!.acneSpots); expect(r.zones[0]!.acneSpots).toBeGreaterThan(0); const total = r.zones.reduce((n, z) => n + z.acneSpots, 0); expect(total).toBeGreaterThanOrEqual(25); expect(total).toBeLessThanOrEqual(35); expect(r.zones.every(z => z.rednessPixels > 0 && z.rednessMeanAlpha > 0)).toBe(true); });
it('handles missing masks and diagonal connectivity', () => { expect(deriveRegions({}).zones.every(z => z.acneSpots === 0 && z.rednessPixels === 0)).toBe(true); const data = new Uint8Array(600 * 800 * 4); data[3] = 255; data[(601) * 4 + 3] = 1; expect(deriveRegions({ acne: { width: 600, height: 800, data } }).zones[2]!.acneSpots).toBe(1); expect(() => deriveRegions({ acne: { width: 1, height: 1, data } })).toThrow(); });
