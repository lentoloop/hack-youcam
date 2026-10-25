import type { LogEntry } from '../../contracts/log';
export const SAMPLE_DESCRIPTION = 'Sample uses pre-analyzed run2 scores from an AI-generated synthetic face, not a real person. Created with Grok. No upload or API call.';
export const SAMPLE: LogEntry = {
    id: 'sample-run2', date: '2026-10-24T08:35:00.000Z', source: 'sample',
    observations: [{ concern: 'acne', rawScore: 45.7384, uiScore: 66, source: 'sample' }, { concern: 'redness', rawScore: 32.16484832763672, uiScore: 60, source: 'sample' }, { concern: 'texture', rawScore: 55.699509382247925, uiScore: 70, source: 'sample' }],
    zoneLabels: [{ region: 'whole', label: 'Combination & Sensitive', source: 'sample' }, { region: 't_zone', label: 'Oily', source: 'sample' }, { region: 'u_zone', label: 'Dry & Sensitive', source: 'sample' }],
    regions: {"method":"mask-heuristic.v1","imageSize":{"w":600,"h":800},"zones":[{"zone":"t_zone","acneSpots":7,"rednessPixels":31980,"rednessMeanAlpha":53.797967479674796},{"zone":"u_zone","acneSpots":21,"rednessPixels":24120,"rednessMeanAlpha":87.79941956882256},{"zone":"other","acneSpots":2,"rednessPixels":1838,"rednessMeanAlpha":46.171926006528835}]},
    framing: { guideShown: true, userConfirmedSameFraming: false, imageSize: { w: 600, h: 800 } }
};
