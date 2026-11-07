import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('app/[slug]/(app)/BusinessPageContent.tsx - staff tooling is on demand', () => {
  const sourcePath = join(__dirname, 'BusinessPageContent.tsx');
  let source: string;

  beforeAll(() => {
    source = readFileSync(sourcePath, 'utf-8');
  });

  it('does not statically import the staff tooling', () => {
    // StaffManagementTools pulls in StorefrontEditor and PatternBrowser: one
    // 243 KB chunk that every public visitor downloaded even though the tools
    // only render for staff.
    expect(source).not.toMatch(/import\s*\{\s*StaffManagementTools\s*\}\s*from/);
  });

  it('loads the staff tooling through next/dynamic', () => {
    expect(source).toMatch(/from 'next\/dynamic'/);
    expect(source).toMatch(/import\('\.\/components\/StaffManagementTools'\)/);
  });
});
