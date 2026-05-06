#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const workflowsDir = path.join(__dirname, '..', 'workflows');
const files = fs.readdirSync(workflowsDir).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));

console.log('Validating workflow YAML files...\n');

let allValid = true;

for (const file of files) {
  const filePath = path.join(workflowsDir, file);
  try {
    const content = fs.readFileSync(filePath, 'utf8');

    // Basic YAML validation checks
    const lines = content.split('\n');
    let hasName = false;
    let hasOn = false;
    let hasJobs = false;

    for (const line of lines) {
      if (line.match(/^name:/)) hasName = true;
      if (line.match(/^on:/)) hasOn = true;
      if (line.match(/^jobs:/)) hasJobs = true;
    }

    if (!hasName || !hasOn || !hasJobs) {
      console.log(`✗ ${file}: Missing required fields`);
      if (!hasName) console.log('  - Missing "name"');
      if (!hasOn) console.log('  - Missing "on"');
      if (!hasJobs) console.log('  - Missing "jobs"');
      allValid = false;
    } else {
      console.log(`✓ ${file}: Valid structure`);
    }
  } catch (e) {
    console.log(`✗ ${file}: ${e.message}`);
    allValid = false;
  }
}

console.log(`\n${allValid ? '✓ All workflows are valid!' : '✗ Some workflows have issues'}`);
process.exit(allValid ? 0 : 1);
