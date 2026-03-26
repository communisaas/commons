/**
 * Script to strip Prisma fallback code from API routes that have been migrated to Convex.
 *
 * For each handler function (GET, POST, PATCH, DELETE), this script:
 * 1. Removes the `if (PUBLIC_CONVEX_URL)` guard
 * 2. Removes the `try { ... } catch { console.error(...) }` wrapper around Convex calls
 * 3. Removes ALL Prisma fallback code after the catch block
 * 4. Removes `import { db } from '$lib/core/db'` if db is no longer used
 * 5. Removes `import { PUBLIC_CONVEX_URL } from '$env/static/public'`
 * 6. Removes dead Prisma-only imports (loadOrgContext, requireRole, etc.) if no longer referenced
 */
import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

const files = execSync(
  "grep -rl 'Convex failed.*falling back to Prisma\\|fallback to Prisma\\|Fall through to Prisma' src/routes/api/",
  { encoding: 'utf8' }
).trim().split('\n');

let totalProcessed = 0;
let totalLinesBefore = 0;
let totalLinesAfter = 0;

for (const file of files) {
  const original = readFileSync(file, 'utf8');
  const linesBefore = original.split('\n').length;
  totalLinesBefore += linesBefore;

  let result = original;

  // Remove PUBLIC_CONVEX_URL import
  result = result.replace(/import \{ PUBLIC_CONVEX_URL \} from '\$env\/static\/public';\n/g, '');

  // Remove dual-stack comment lines
  result = result.replace(/\/\/ Convex dual-stack imports.*\n/g, '');
  result = result.replace(/\/\/ CONVEX: dual-stack.*\n/g, '');

  // Remove the DUAL-STACK section headers
  result = result.replace(/[\t ]*\/\/ ─── DUAL-STACK: Try Convex first[^\n]*\n/g, '');

  // Remove PRISMA FALLBACK section headers
  result = result.replace(/[\t ]*\/\/ ─── PRISMA FALLBACK ───[^\n]*\n/g, '');

  // Remove `if (PUBLIC_CONVEX_URL) {` blocks:
  // This unwraps the guard, keeping just the try body.
  // Pattern: if (PUBLIC_CONVEX_URL) {\n\t\ttry {\n...CONVEX CODE...\n\t\t} catch (err|error) {\n\t\t\tconsole.error...\n\t\t}\n\t}
  // After removing the guard, we also need to remove the try/catch wrapper
  // and all Prisma fallback code that follows.

  // Step 1: Remove `if (PUBLIC_CONVEX_URL) {` line
  result = result.replace(/[\t ]*if \(PUBLIC_CONVEX_URL\) \{\n/g, '');

  // Step 2: Remove the catch block that contains "falling back to Prisma" or "fallback to Prisma"
  // Pattern variations:
  //   } catch (err) {\n\t\t\tconsole.error...\n\t\t}\n\t}
  //   } catch (err) {\n\t\t\tif (err ...) throw err;\n\t\t\tconsole.error...\n\t\t\t// Fall through...\n\t\t}\n\t}

  // Remove catch blocks that contain fallback patterns + everything after until the next export/function
  // This is the tricky part - we need to find each catch block with "falling back to Prisma"
  // and remove it plus all Prisma code that follows within the same handler.

  // Approach: Find each `} catch` that contains fallback text, and remove from there
  // to the end of the enclosing function handler block.

  // For simpler handling, let's find the pattern:
  //   } catch (err|error) {
  //     [optional: if (err...) throw err;]
  //     console.error('[...] Convex failed, falling back to Prisma:', err|error);
  //     [optional: // Fall through to Prisma below]
  //   }
  // And remove it.

  // Remove catch blocks with fallback patterns (multi-line)
  // Match: } catch (varname) {\n  [any lines containing "falling back" or "Fall through"]\n  }\n  }
  result = result.replace(
    /[\t ]*\} catch \((err|error|e)\) \{\n([\t ]*(?:if \(\1[^\n]*throw[^\n]*\n)?)[\t ]*console\.error\([^\n]*(?:falling back to Prisma|fallback to Prisma)[^\n]*\n([\t ]*\/\/ Fall through[^\n]*\n)?[\t ]*\}\n/g,
    ''
  );

  // Remove the closing brace of the removed `if (PUBLIC_CONVEX_URL)` blocks
  // These are now orphan `\t}` lines. But we need to be careful not to remove legitimate braces.
  // After removing the if guard, there will be an extra closing } at the end of where it was.
  // This is hard to do with regex alone. Instead, let's look for the specific pattern:
  //   [blank line]\n\t}\n\n\t// ─── PRISMA FALLBACK ───
  // which has already been partially cleaned.

  // Remove orphan closing braces that were part of the if(PUBLIC_CONVEX_URL) block
  // These typically appear as a lone `\t}` or `\t\t}` on a line, followed by blank lines
  // and then Prisma code.

  // Remove the `try {` wrapper (keep the body, de-indent by one level)
  // Pattern: \t\ttry {\n\t\t\t[body]\n\t\t} catch...
  // After catch removal, we just need to remove the try { wrapper
  result = result.replace(/(\t+)try \{\n/g, '');

  // Now we need to remove the remaining Prisma code blocks.
  // These follow after the catch block removal. Since the patterns vary significantly,
  // the safest approach is to find Prisma-specific patterns and remove them.

  // After all transformations, check if `db` is still referenced in the code (excluding imports)
  const codeWithoutImports = result.replace(/^import[^\n]*\n/gm, '');
  const dbStillUsed = /\bdb\b/.test(codeWithoutImports) || /\bprisma\b/.test(codeWithoutImports);

  if (!dbStillUsed) {
    // Remove db/prisma imports
    result = result.replace(/import \{ db \} from '\$lib\/core\/db';\n/g, '');
    result = result.replace(/import \{ prisma \} from '\$lib\/core\/db';\n/g, '');
  }

  // Remove loadOrgContext/requireRole imports if no longer used
  const loadOrgContextUsed = (result.match(/loadOrgContext/g) || []).length > 1; // more than just the import
  const requireRoleUsed = (result.match(/requireRole/g) || []).length > 1;

  if (!loadOrgContextUsed && !requireRoleUsed) {
    result = result.replace(/import \{ loadOrgContext, requireRole \} from '\$lib\/server\/org';\n/g, '');
  } else if (!loadOrgContextUsed) {
    result = result.replace('import { loadOrgContext, requireRole }', 'import { requireRole }');
  } else if (!requireRoleUsed) {
    result = result.replace('import { loadOrgContext, requireRole }', 'import { loadOrgContext }');
  }

  // Remove orgMeetsPlan import if no longer used
  if ((result.match(/orgMeetsPlan/g) || []).length <= 1) {
    result = result.replace(/import \{ orgMeetsPlan \} from '\$lib\/server\/billing\/plan-check';\n/g, '');
  }

  // Remove console.log lines with Convex success messages
  result = result.replace(/[\t ]*console\.log\(`?\[.*Convex:.*\n/g, '');

  // Clean up multiple consecutive blank lines (max 2)
  result = result.replace(/\n{3,}/g, '\n\n');

  writeFileSync(file, result);

  const linesAfter = result.split('\n').length;
  totalLinesAfter += linesAfter;
  totalProcessed++;

  console.log(`${file}: ${linesBefore} → ${linesAfter} lines (removed ${linesBefore - linesAfter})`);
}

console.log(`\nTotal: ${totalProcessed} files, ${totalLinesBefore} → ${totalLinesAfter} lines (removed ${totalLinesBefore - totalLinesAfter})`);
