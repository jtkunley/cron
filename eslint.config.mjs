import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
    { ignores: ['dist/', 'coverage/'] },
    js.configs.recommended,
    tseslint.configs.recommendedTypeChecked,
    {
        languageOptions: {
            globals: globals.node,
            parserOptions: {
                projectService: {
                    allowDefaultProject: ['*.mjs', 'scripts/*.mjs'],
                },
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
            ],
        },
    },
    {
        files: ['src/**/__tests__/**', 'src/**/*.spec.ts', 'src/**/*.test.ts', 'test/**'],
        rules: {
            // `expect(mock.method)` and untyped `mock.calls` trip these on every assertion.
            '@typescript-eslint/unbound-method': 'off',
            '@typescript-eslint/no-unsafe-argument': 'off',
            '@typescript-eslint/no-unsafe-assignment': 'off',
            '@typescript-eslint/no-unsafe-member-access': 'off',
            // Tests throw and reject with non-Error values on purpose, to check they are reported as-is.
            '@typescript-eslint/only-throw-error': 'off',
            '@typescript-eslint/prefer-promise-reject-errors': 'off',
        },
    },
    {
        files: ['**/*.mjs'],
        extends: [tseslint.configs.disableTypeChecked],
    },
);
