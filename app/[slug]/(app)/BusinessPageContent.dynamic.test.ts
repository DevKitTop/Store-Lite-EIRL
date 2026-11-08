import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..', '..');
const sourcePath = join(__dirname, 'BusinessPageContent.tsx');

function walk(dir: string): string[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- walking repository sources in a test
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'node_modules' || entry.name.startsWith('.') ? [] : walk(full);
    }
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

function readSource(file: string): string {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- reading repository sources in a test
  return readFileSync(file, 'utf-8');
}

describe('BusinessPageContent staff tooling stays on demand', () => {
  let source: string;

  beforeAll(() => {
    source = readFileSync(sourcePath, 'utf-8');
  });

  it('does not statically import StaffManagementTools', () => {
    // A static import pulls StorefrontEditor and PatternBrowser into the
    // bundle every public visitor downloads, although the tools only render
    // for staff.
    expect(source).not.toMatch(/import\s*\{\s*StaffManagementTools\s*\}\s*from/);
  });

  it('loads StaffManagementTools through next/dynamic without server rendering', () => {
    expect(source).toMatch(/from 'next\/dynamic'/);
    expect(source).toMatch(
      /dynamic\(\s*\(\s*\)\s*=>\s*import\('\.\/components\/StaffManagementTools'\)/,
    );
    expect(source).toMatch(/ssr:\s*false/);
  });

  it('keeps the staff tools gated by isStaff', () => {
    expect(source).toMatch(/\{isStaff\s*&&\s*\(\s*<StaffManagementTools/);
  });

  it('has no other static StaffManagementTools import in app/ or src/', () => {
    const files = [...walk(join(repoRoot, 'app')), ...walk(join(repoRoot, 'src'))].filter(
      (file) =>
        !file.endsWith('BusinessPageContent.tsx') &&
        !file.endsWith('StaffManagementTools.tsx') &&
        !/\.test\.(ts|tsx)$/.test(file),
    );
    const offenders = files.filter((file) =>
      /import\s*\{[^}]*StaffManagementTools[^}]*\}\s*from/.test(readSource(file)),
    );

    expect(offenders.map((file) => relative(repoRoot, file))).toEqual([]);
  });

  it('derives isStaff on the server page and passes it down', () => {
    const page = readFileSync(join(__dirname, '(home)', 'page.tsx'), 'utf-8');

    expect(page).toMatch(/const\s+isStaff\s*=\s*isOwner\s*\|\|\s*permissions\.length\s*>\s*0/);
    expect(page).toMatch(/isStaff=\{isStaff\}/);
  });
});
