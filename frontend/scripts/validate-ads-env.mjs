import fs from 'node:fs';
import path from 'node:path';

const mode = process.argv[2] || 'production';
const cwd = process.cwd();

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const result = {};
  const content = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) continue;
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '');
    result[key] = value;
  }
  return result;
}

function isTrue(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

const env = {
  ...parseEnvFile(path.join(cwd, '.env')),
  ...parseEnvFile(path.join(cwd, `.env.${mode}`)),
  ...process.env,
};

const rewardedKeys = [
  'VITE_ADSGRAM_REWARD_DAILY_COINS_BLOCK_ID',
  'VITE_ADSGRAM_REWARD_HINT_BLOCK_ID',
  'VITE_ADSGRAM_REWARD_REVIVE_BLOCK_ID',
];
const interstitialKeys = [
  'VITE_ADSGRAM_INTERSTITIAL_PROGRESS_BLOCK_ID',
  'VITE_ADSGRAM_INTERSTITIAL_HARD_BLOCK_ID',
];

const adsEnabled = isTrue(env.VITE_ADS_ENABLED);

for (const key of rewardedKeys) {
  const value = String(env[key] || '').trim();
  if (adsEnabled && !value) {
    fail(`${key} is required when VITE_ADS_ENABLED=true`);
  }
  if (value && !/^\d+$/.test(value)) {
    fail(`${key} must be numeric only for rewarded AdsGram blocks`);
  }
}

for (const key of interstitialKeys) {
  const value = String(env[key] || '').trim();
  if (value && !/^int-\d+$/.test(value)) {
    fail(`${key} must match int-<digits> for interstitial AdsGram blocks`);
  }
}

console.log(`AdsGram env validation passed for mode=${mode}`);
