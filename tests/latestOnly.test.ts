import { describe, expect, it } from 'vitest';
import { LatestOnly } from '../src/services/data/latestOnly';

describe('LatestOnly', () => {
    it('prevents an older response from overwriting the newest selection', async () => {
        const latest = new LatestOnly();
        const applied: string[] = [];
        let resolveOld!: (value: string) => void;
        let resolveNew!: (value: string) => void;
        const old = latest.run(() => new Promise(done => { resolveOld = done; }), value => applied.push(value));
        const current = latest.run(() => new Promise(done => { resolveNew = done; }), value => applied.push(value));
        resolveNew('new');
        await current;
        resolveOld('old');
        expect(await old).toBe(false);
        expect(applied).toEqual(['new']);
    });
});
