import { it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
it('runs the offline checkpoint with real run2 masks and scores', () => {
  const out = mkdtempSync(join(tmpdir(), 'breakout-checkpoint-'));
  try {
    const stdout = execFileSync(process.execPath, ['scripts/checkpoint-breakout.mjs'], { env: { ...process.env, MOCK: '0', IN: 'fixtures/run2-normalized.json', OUT_DIR: out }, encoding: 'utf8' });
    expect(stdout).not.toContain('FAIL');
    expect(stdout.match(/^PASS /gm)).toHaveLength(7);
    const log = JSON.parse(readFileSync(join(out, 'log-file.json'), 'utf8'));
    expect(log.entries[0].regions.zones.map((z: { acneSpots: number }) => z.acneSpots)).toEqual([7, 21, 2]);
    expect(log.entries[0].observations.map((o: { uiScore: number }) => o.uiScore)).toEqual([70, 60, 66]);
    expect(JSON.parse(readFileSync(join(out, 'log-view.json'), 'utf8')).baseline.source).toBe('live');
    expect(readFileSync(join(out, 'log-card.html'), 'utf8')).toContain('retinoid serum (example)');
  } finally { rmSync(out, { recursive: true, force: true }); }
});
it('runs the checkpoint with entirely synthetic mock results', () => {
  const out = mkdtempSync(join(tmpdir(), 'breakout-mock-checkpoint-'));
  try {
    const stdout = execFileSync(process.execPath, ['scripts/checkpoint-breakout.mjs'], { env: { ...process.env, MOCK: '1', OUT_DIR: out }, encoding: 'utf8' });
    expect(stdout.match(/^PASS /gm)).toHaveLength(7);
    expect(stdout).toContain('PASS mock acne/redness/texture observations');
    const log = JSON.parse(readFileSync(join(out, 'log-file.json'), 'utf8'));
    expect(log.entries[0].source).toBe('mock');
    expect(log.entries[0].observations.every((o: { source: string }) => o.source === 'mock')).toBe(true);
  } finally { rmSync(out, { recursive: true, force: true }); }
});
