import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
    export interface ProvidedContext {
        consumerDir: string;
    }
}

const REPO = resolve(__dirname, '../..');
const RUNTIME_DEPS = ['node-cron'];

/**
 * Builds the package the way it is published and installs it beside its runtime dependency,
 * so the tests load it through the exports map, as a consumer would.
 */
export default function setup({ provide }: TestProject): () => void {
    const root = mkdtempSync(join(tmpdir(), 'cron-component-'));
    const packageDir = join(root, 'node_modules', '@jtkunley', 'cron');
    const run = (...args: string[]) => execFileSync(process.execPath, args, { cwd: REPO });

    run(
        require.resolve('typescript/bin/tsc'),
        '-p',
        'tsconfig.build.json',
        '--outDir',
        join(packageDir, 'src'),
    );
    run('scripts/prepare-dist.mjs', packageDir);
    for (const dep of RUNTIME_DEPS) {
        symlinkSync(join(REPO, 'node_modules', dep), join(root, 'node_modules', dep), 'dir');
    }
    const consumerDir = join(root, 'app');
    mkdirSync(consumerDir);

    provide('consumerDir', consumerDir);
    return () => rmSync(root, { recursive: true, force: true });
}
