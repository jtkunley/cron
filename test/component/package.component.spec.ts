import { realpathSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { consumerRequire, packageDir } from './installed';

describe('the installed package', () => {
    it.each([
        ['', 'src/cron.js'],
        ['/package.json', 'package.json'],
    ])('resolves @jtkunley/cron%s', (subpath, file) => {
        expect(realpathSync(consumerRequire.resolve(`@jtkunley/cron${subpath}`))).toBe(
            realpathSync(join(packageDir, file)),
        );
    });

    it.each(['/src', '/src/cron', '/src/cron.js'])(
        'does not expose @jtkunley/cron%s',
        (subpath) => {
            expect(() => consumerRequire.resolve(`@jtkunley/cron${subpath}`)).toThrow(
                expect.objectContaining({ code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' }) as Error,
            );
        },
    );

    it('ships its type declarations beside the code', () => {
        expect(() => realpathSync(join(packageDir, 'src', 'cron.d.ts'))).not.toThrow();
    });
});
