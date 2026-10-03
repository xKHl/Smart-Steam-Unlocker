const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('Relock State Mismatch Renderer UI Projection Update', (t) => {
  // Read the source of the Achievements page
  const achievementsSource = fs.readFileSync(
    path.join(__dirname, '../src/pages/Achievements.jsx'),
    'utf-8'
  );

  // Assert that handleConfirmRelock explicitly checks for the ACHIEVEMENT_ALREADY_LOCKED code
  assert.match(
    achievementsSource,
    /if\s*\(\s*result\.errorCode\s*===\s*['"]ACHIEVEMENT_ALREADY_LOCKED['"]\s*\)/,
    'handleConfirmRelock must check for ACHIEVEMENT_ALREADY_LOCKED explicitly'
  );

  // Assert that it updates the achievements array with unlocked: false
  assert.match(
    achievementsSource,
    /unlocked:\s*false/,
    'The explicit fallback must set the achievement to locked'
  );

  // Assert that it updates relockStates to 'verified' to remove the loader and mark as resolved
  assert.match(
    achievementsSource,
    /setRelockStates\(\(previous\)\s*=>\s*\(\{\s*\.\.\.previous,\s*\[achievement\.id\]:\s*['"]verified['"]\s*\}\)\)/,
    'The explicit fallback must update relockStates to verified'
  );

  // Ensure it sets a warning tone for the synchronization
  assert.match(
    achievementsSource,
    /setRelockMessage\(\{\s*tone:\s*['"]warning['"]/,
    'The explicit fallback should issue a warning message'
  );
});
