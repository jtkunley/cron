import * as root from '../index';
import { createCron } from '../lib/createCron';

describe('the package root', () => {
    // Everything else is a building block of createCron, wired in one place on purpose.
    it('exports createCron and nothing else at runtime', () => {
        expect(Object.keys(root)).toEqual(['createCron']);
        expect(root.createCron).toBe(createCron);
    });
});
