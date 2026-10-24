import type { DeriveRegions, ZoneStats } from '../contracts/log';
/** Overlapping masks belong to T-zone. Centroids are rounded to the nearest pixel. */
export const deriveRegions: DeriveRegions = masks => {
    for (const image of Object.values(masks))
        if (image && (image.width !== 600 || image.height !== 800 || image.data.length !== 600 * 800 * 4))
            throw Error('Masks must be 600 × 800 RGBA.');
    const zones: ZoneStats[] = ['t_zone', 'u_zone', 'other'].map(zone => ({ zone: zone as ZoneStats['zone'], acneSpots: 0, rednessPixels: 0, rednessMeanAlpha: 0 }));
    const alpha = (img: typeof masks.acne, i: number) => img?.data[i * 4 + 3] ?? 0;
    const zone = (i: number) => alpha(masks.tZone, i) > 0 ? 0 : alpha(masks.uZone, i) > 0 ? 1 : 2;
    const visited = new Uint8Array(480000);
    for (let i = 0; i < 480000; i++) {
        const a = alpha(masks.redness, i);
        if (a > 0) {
            const z = zones[zone(i)]!;
            z.rednessPixels++;
            z.rednessMeanAlpha += a;
        }
        if (visited[i] || !alpha(masks.acne, i))
            continue;
        const queue = [i];
        visited[i] = 1;
        let sx = 0, sy = 0;
        for (let q = 0; q < queue.length; q++) {
            const p = queue[q]!, x = p % 600, y = Math.floor(p / 600);
            sx += x;
            sy += y;
            for (let dy = -1; dy <= 1; dy++)
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = x + dx, ny = y + dy, n = ny * 600 + nx;
                    if (nx >= 0 && nx < 600 && ny >= 0 && ny < 800 && !visited[n] && alpha(masks.acne, n) > 0) {
                        visited[n] = 1;
                        queue.push(n);
                    }
                }
        }
        zones[zone(Math.round(sy / queue.length) * 600 + Math.round(sx / queue.length))]!.acneSpots++;
    }
    zones.forEach(z => z.rednessMeanAlpha = z.rednessPixels ? z.rednessMeanAlpha / z.rednessPixels : 0);
    return { method: 'mask-heuristic.v1', imageSize: { w: 600, h: 800 }, zones };
};
