import { createRequire } from 'module';
import { join } from 'path';
import { inject } from 'vitest';

/** Resolves modules the way a service that installed the package would. */
export const consumerRequire = createRequire(join(inject('consumerDir'), 'consumer.js'));

export const packageDir = join(inject('consumerDir'), 'node_modules', '@jtkunley', 'cron');
