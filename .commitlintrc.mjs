// PR #415 was squash-merged with an uppercase acronym in its subject.
// Grandfather only that legacy commit so develop-to-main PRs can pass commitlint.
const LEGACY_PWA_SQUASH_SUBJECT =
  'feat: PWA T2.5 fan-out/dedup implementation (#415)';

const config = {
  extends: ['@commitlint/config-conventional'],
  ignores: [(message) => message.split('\n')[0] === LEGACY_PWA_SQUASH_SUBJECT],
};

export default config;
