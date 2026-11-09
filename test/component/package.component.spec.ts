import { execFileSync } from 'child_process';
import { existsSync, realpathSync } from 'fs';
import { createRequire } from 'module';
import { join } from 'path';
import { describe, expect, inject, it } from 'vitest';

const consumerDir = inject('consumerDir');
const packageDir = join(consumerDir, '..', 'node_modules', '@jtkunley', 'cron');
const consumerRequire = createRequire(join(consumerDir, 'consumer.js'));

describe('the installed package', () => {
    it('depends on node-cron and nothing else', () => {
        const manifest = consumerRequire('@jtkunley/cron/package.json') as {
            dependencies?: Record<string, string>;
            devDependencies?: unknown;
            scripts?: unknown;
        };

        expect(Object.keys(manifest.dependencies ?? {})).toEqual(['node-cron']);
        expect(manifest.devDependencies).toBeUndefined();
        expect(manifest.scripts).toBeUndefined();
    });

    it.each([
        ['', 'src/index.js'],
        ['/package.json', 'package.json'],
    ])('resolves @jtkunley/cron%s', (subpath, file) => {
        expect(realpathSync(consumerRequire.resolve(`@jtkunley/cron${subpath}`))).toBe(
            realpathSync(join(packageDir, file)),
        );
    });

    it('ships type declarations, the README, changelog and license', () => {
        for (const file of ['src/index.d.ts', 'README.md', 'CHANGELOG.md', 'LICENSE']) {
            expect(existsSync(join(packageDir, file))).toBe(true);
        }
    });

    it('does not ship its tests', () => {
        expect(existsSync(join(packageDir, 'src', 'lib', '__tests__'))).toBe(false);
        expect(existsSync(join(packageDir, 'src', '__tests__'))).toBe(false);
    });

    it('exports createCron and nothing else at runtime', () => {
        const root = consumerRequire('@jtkunley/cron') as Record<string, unknown>;

        expect(Object.keys(root)).toEqual(['createCron']);
        expect(typeof root['createCron']).toBe('function');
    });

    it('can be imported from an ES module', () => {
        const output = execFileSync(
            process.execPath,
            [
                '--input-type=module',
                '-e',
                "import { createCron } from '@jtkunley/cron'; console.log(typeof createCron);",
            ],
            { cwd: consumerDir, encoding: 'utf8' },
        );

        expect(output.trim()).toBe('function');
    });

    it.each(['/src', '/src/index', '/src/index.js', '/src/lib/createCron.js'])(
        'does not expose @jtkunley/cron%s',
        (subpath) => {
            expect(() => consumerRequire.resolve(`@jtkunley/cron${subpath}`)).toThrow(
                expect.objectContaining({ code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' }) as Error,
            );
        },
    );
});
