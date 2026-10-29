import js from '@eslint/js';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import prettierConfig from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
import prettierPlugin from 'eslint-plugin-prettier';
import promisePlugin from 'eslint-plugin-promise';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import securityPlugin from 'eslint-plugin-security';
import sonarjsPlugin from 'eslint-plugin-sonarjs';
import unicornPlugin from 'eslint-plugin-unicorn';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

const eslintConfig = defineConfig([
  // Base configs
  js.configs.recommended,
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
  ...nextVitals,
  ...nextTs,

  // Plugin configs
  sonarjsPlugin.configs.recommended,
  promisePlugin.configs['flat/recommended'],
  securityPlugin.configs.recommended,

  // Global ignores
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'dist/**',
    'node_modules/**',
    '.engram/**',
    '.agent-teams/**',
    '.guardian/**',
    '.ai-tools/**',
    '.kilocode/**',
    '.aider*',
    'next-env.d.ts',
    'public/**',
    'coverage/**',
    'scripts/**',
  ]),

  // Test files — relaxed rules
  {
    files: ['tests/**', '**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/*.spec.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  // Main Configuration
  {
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
      // 'jsx-a11y': jsxA11yPlugin, // Included in nextVitals
      unicorn: unicornPlugin,
      import: importPlugin,
      prettier: prettierPlugin,
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      // Prettier Integration
      'prettier/prettier': 'off',
      ...prettierConfig.rules,

      // TypeScript - Strictness
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off', // Too verbose for React components
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: 'interface',
          format: ['PascalCase'],
        },
        {
          selector: 'typeLike',
          format: ['PascalCase'],
        },
      ],

      // React / Next.js
      'react/react-in-jsx-scope': 'off', // Not needed in Next.js
      'react/prop-types': 'off', // TS handles this
      'react/jsx-no-target-blank': 'error',
      'react/self-closing-comp': 'error',
      'react/no-unknown-property': ['error', { ignore: ['class', 'for'] }], // Material Design web compatibility might need more specific ignores here if using strictly custom elements
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // Accessibility
      'jsx-a11y/alt-text': 'error',
      'jsx-a11y/aria-props': 'error',
      'jsx-a11y/aria-proptypes': 'error',
      'jsx-a11y/aria-unsupported-elements': 'error',
      'jsx-a11y/role-has-required-aria-props': 'error',
      'jsx-a11y/role-supports-aria-props': 'error',

      // Clean Code & Best Practices (Unicorn)
      'unicorn/filename-case': [
        'error',
        {
          cases: {
            camelCase: true,
            pascalCase: true,
          },
          ignore: [
            'next-env.d.ts',
            'not-found.tsx',
            'loading.tsx',
            'error.tsx',
            'layout.tsx',
            'page.tsx',
            'route.ts',
            'middleware.ts',
            'instrumentation-client.ts',
          ],
        },
      ],
      'unicorn/prevent-abbreviations': 'off', // Too annoying usually
      'unicorn/no-null': 'off', // React uses null frequently
      'unicorn/prefer-module': 'error',
      'unicorn/prefer-node-protocol': 'error',

      // Code Complexity (Strict)
      complexity: 'warn',
      'max-depth': 'warn',
      'max-params': 'warn',
      'max-lines': 'off',
      'max-lines-per-function': 'off',

      // Imports
      'import/no-duplicates': 'error',
      'import/no-unresolved': 'off', // Handled by TS
      'import/order': 'off', // Handled by Prettier plugin

      // General
      // Production hygiene: no console.log/debug/info in committed code.
      // console.warn / console.error are allowed.
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-debugger': 'error',
      eqeqeq: ['error', 'always'],
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/consistent-indexed-object-style': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/refs': 'off',
      'promise/catch-or-return': 'warn',
      'promise/always-return': 'warn',
      'sonarjs/cognitive-complexity': 'warn',
      'sonarjs/no-nested-functions': 'warn',
      'sonarjs/no-ignored-exceptions': 'warn',
      'sonarjs/no-commented-code': 'warn',
      'sonarjs/no-nested-conditional': 'warn',
      'sonarjs/no-all-duplicated-branches': 'warn',
      'sonarjs/no-unused-vars': 'off',
      'sonarjs/no-dead-store': 'off',
      'sonarjs/slow-regex': 'off',
      'sonarjs/pseudo-random': 'off',
    },
  },

  // Specific overrides for Material Web components if needed
  {
    files: ['**/*.tsx'],
    rules: {
      // Allow custom elements for Material Web
      'react/no-unknown-property': [
        'error',
        {
          ignore: [
            'on',
            'class',
            'for',
            'md-elevated-button',
            'md-filled-button',
            'md-outlined-button',
            'md-text-button',
            'md-fab',
            'md-icon-button',
            'md-icon',
            'md-list',
            'md-list-item',
            'md-divider',
            'md-filled-text-field',
            'md-outlined-text-field',
            'md-checkbox',
            'md-radio',
            'md-switch',
            'md-slider',
            'md-tabs',
            'md-primary-tab',
            'md-secondary-tab',
            'md-dialog',
            'md-circular-progress',
            'md-linear-progress',
            'md-chip-set',
            'md-filter-chip',
            'md-assist-chip',
            'md-suggestion-chip',
            'md-input-chip',
            'md-menu',
            'md-menu-item',
            'md-select',
            'md-select-option',
          ],
        },
      ],
    },
  },

  // Developer tooling: CLI scripts where console output IS the interface.
  {
    files: ['migrations/**/*.ts', 'sendTestEmail.ts'],
    rules: {
      'no-console': 'off',
    },
  },

  // Next.js OpenGraph image generators run inside ImageResponse, where
  // next/image cannot be used and a plain <img> is the only option.
  {
    files: ['**/opengraph-image.tsx'],
    rules: {
      '@next/next/no-img-element': 'off',
    },
  },
]);

export default eslintConfig;
