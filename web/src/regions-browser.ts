import { validMaskHeader } from "../../shared/png";
import type { MaskSet } from '../../contracts/analysis';
import type { RgbaImage } from '../../contracts/log';
import { deriveRegions } from '../../shared/regions';
export async function decodeMask(data: string): Promise<RgbaImage> {
    if (!/^data:image\/png;base64,[a-z\d+/=]+$/i.test(data))
        throw Error('Invalid mask encoding.');
    const bytes = Uint8Array.from(atob(data.slice(data.indexOf(',') + 1)), c => c.charCodeAt(0));
    if (!validMaskHeader(bytes)) throw Error('Invalid mask dimensions or format.');
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    try {
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d');
        if (!ctx)
            throw Error('Mask decoding unavailable.');
        ctx.drawImage(bitmap, 0, 0);
        return ctx.getImageData(0, 0, canvas.width, canvas.height);
    }
    finally {
        bitmap.close();
    }
}
export async function regionsFromMasks(masks: MaskSet) {
    const [acne, redness, tZone, uZone] = await Promise.all([masks.acne, masks.redness, masks.t_zone, masks.u_zone].map(v => v ? decodeMask(v).catch(() => undefined) : undefined));
    if (!acne || !redness || !tZone || !uZone) return undefined;
    return deriveRegions({ acne, redness, tZone, uZone });
}
