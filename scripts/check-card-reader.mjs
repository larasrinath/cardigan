// Checks that the card reader's five source files are byte-for-byte the same as SAM's copies, which SAM's
// describe_ux_page_cards tool uses (src/domains/ux-designer in an anaplan-sam checkout). Read-only and offline.
//
// Usage: node scripts/check-card-reader.mjs [path to an anaplan-sam checkout]   (default: ../anaplan-sam beside this repository)
// Exit 0: identical, or skipped because there is no checkout at that path. Exit 1: drift. Exit 2: the path is not an
// anaplan-sam checkout.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_SAM = path.resolve(ROOT, '..', 'anaplan-sam');
export const READER_FILES = ['card-details.ts', 'card-naming.ts', 'card-types.ts', 'definition-json.ts', 'definition-types.ts'];
const HERE = path.join('src', 'card-reader');
const IN_SAM = path.join('src', 'domains', 'ux-designer');

/** Compares the reader in `dir` with SAM's at `sam`. `differences` names each file that is not identical, and why. */
export function compareCardReader({ dir = ROOT, sam = DEFAULT_SAM } = {}) {
  if (!existsSync(sam)) return { status: 'skipped', differences: [] };
  if (!existsSync(path.join(sam, IN_SAM))) return { status: 'not-sam', differences: [] };
  const differences = READER_FILES.flatMap(file => {
    const [ours, theirs] = [path.join(dir, HERE, file), path.join(sam, IN_SAM, file)];
    if (!existsSync(ours)) return [{ file, reason: 'missing here' }];
    if (!existsSync(theirs)) return [{ file, reason: 'missing in SAM' }];
    return readFileSync(ours).equals(readFileSync(theirs)) ? [] : [{ file, reason: 'differs' }];
  });
  return { status: differences.length ? 'drift' : 'same', differences };
}

/** The report and exit code for one comparison. */
export function report({ status, differences }, sam) {
  switch (status) {
    case 'skipped':
      return { code: 0, text: `Card reader check skipped: there is no anaplan-sam checkout at ${sam}. Pass its path: npm run check:card-reader -- <path>.` };
    case 'not-sam':
      return { code: 2, text: `${sam} is not an anaplan-sam checkout: it has no ${IN_SAM.split(path.sep).join('/')}/.` };
    case 'same':
      return { code: 0, text: `Card reader matches SAM at ${sam}: ${READER_FILES.join(', ')} are identical.` };
    default:
      return { code: 1, text: [`Card reader drift against SAM at ${sam}:`, ...differences.map(({ file, reason }) => `  ${file}: ${reason}`),
        'Make the five files identical in both repositories (src/card-reader here, src/domains/ux-designer in SAM).'].join('\n') };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const sam = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_SAM;
  const { code, text } = report(compareCardReader({ sam }), sam);
  (code === 0 ? console.log : console.error)(text);
  process.exitCode = code;
}
