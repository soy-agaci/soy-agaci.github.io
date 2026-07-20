import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('production runtime network paths', () => {
    it('has no legacy Google editor path, alternate auth API, or browser service key', () => {
        const runtimeFiles = ['index.html', 'src/main.ts', 'src/ui/editor/index.ts', 'src/ui/editor/submission.ts'];
        const runtime = runtimeFiles.map(file => readFileSync(file, 'utf8')).join('\n');
        expect(runtime).not.toMatch(/google(?!apis)|apps-script|docs\.google/i);
        expect(runtime).not.toMatch(/from ['"]\.\/actions/);
        const production = runtime + readFileSync('src/ui/admin.ts', 'utf8') + readFileSync('src/services/supabase/client.ts', 'utf8');
        expect(production).not.toMatch(/signInWithPassword|signInWithOtp|magic.?link|service.role/i);
        expect(production.match(/provider:\s*['"]google['"]/g)).toHaveLength(1);
    });
});
