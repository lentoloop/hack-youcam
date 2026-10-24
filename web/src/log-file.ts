import type { BreakoutLog } from '../../contracts/log';
import { parseLogFile } from '../../shared/log';
export function serializeLog(log: BreakoutLog) {
    const checked = parseLogFile(log);
    if (!checked.ok)
        throw Error(checked.reason);
    return JSON.stringify(checked.log, null, 2);
}
export function downloadLog(log: BreakoutLog) {
    const url = URL.createObjectURL(new Blob([serializeLog(log)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'breakout-log.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
}
export async function importLog(file: File) {
    if (file.size > 200 * 1024)
        throw Error('Log exceeds 200 KB.');
    const result = parseLogFile(JSON.parse(await file.text()));
    if (!result.ok)
        throw Error(result.reason);
    return result.log;
}
