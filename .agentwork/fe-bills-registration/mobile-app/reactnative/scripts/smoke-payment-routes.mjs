import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

const requiredFiles = [
  'app/wallet/_layout.tsx',
  'app/wallet/add.tsx',
  'app/wallet/send.tsx',
  'app/wallet/withdraw.tsx',
  'app/services/transfer.tsx',
  'app/services/cards.tsx',
  'app/services/fx.tsx',
  'app/services/education.tsx',
  'src/components/PaymentActionScreen.tsx',
  'docs/envato-payment-template-migration-audit.md',
];

const requiredSnippets = [
  ['app/_layout.tsx', '<Stack.Screen name="wallet" />'],
  ['app/services/_layout.tsx', '<Stack.Screen name="transfer" />'],
  ['app/services/_layout.tsx', '<Stack.Screen name="cards" />'],
  ['app/services/_layout.tsx', '<Stack.Screen name="fx" />'],
  ['app/(tabs)/wallet.tsx', "router.push('/wallet/add' as never)"],
  ['app/(tabs)/wallet.tsx', "router.push('/wallet/send' as never)"],
  ['app/(tabs)/wallet.tsx', "router.push('/wallet/withdraw' as never)"],
  ['app/(tabs)/wallet.tsx', "router.push('/services/fx' as never)"],
  ['app/services/education.tsx', 'getEducationProviders'],
  ['app/services/education.tsx', 'getEducationProducts'],
  ['app/services/education.tsx', 'payEducation'],
  ['app/services/education.tsx', 'initiateEducationPaystack'],
  ['src/api/billing.api.ts', 'getEducationProviders'],
  ['src/api/billing.api.ts', 'payEducation'],
  ['src/types/billing.ts', 'interface EducationProvider'],
  ['src/types/billing.ts', 'interface EducationProduct'],
  ['tsconfig.json', '"exclude": ["banking", "node_modules"]'],
];

const sourceFilesToScan = [
  'app/wallet/add.tsx',
  'app/wallet/send.tsx',
  'app/wallet/withdraw.tsx',
  'app/services/transfer.tsx',
  'app/services/cards.tsx',
  'app/services/fx.tsx',
  'app/services/education.tsx',
  'src/components/PaymentActionScreen.tsx',
];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

const failures = [];

for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(root, file))) {
    failures.push(`Missing required file: ${file}`);
  }
}

for (const [file, snippet] of requiredSnippets) {
  if (!fs.existsSync(path.join(root, file))) {
    failures.push(`Cannot check missing file: ${file}`);
    continue;
  }
  if (!read(file).includes(snippet)) {
    failures.push(`Missing expected snippet in ${file}: ${snippet}`);
  }
}

for (const file of sourceFilesToScan) {
  if (!fs.existsSync(path.join(root, file))) continue;
  const contents = read(file);
  if (/banking\/app|src\/navigation|react-redux|@react-navigation\/native/.test(contents)) {
    failures.push(`Host payment route imports donor/root navigation code: ${file}`);
  }
}

if (failures.length > 0) {
  console.error('Payment route smoke check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Payment route smoke check passed.');
