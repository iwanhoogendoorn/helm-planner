// Check every version source agrees with the release tag before anything is built.
// usage: node scripts/check-release.mjs <tag> [repo root]
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [, , tag, root = '.'] = process.argv;
if (!tag) { console.error('usage: node scripts/check-release.mjs <tag> [repo root]'); process.exit(1); }
const read = (f) => JSON.parse(readFileSync(join(resolve(root), f), 'utf8'));
const manifest = read('manifest.json'), pkg = read('package.json'), lock = read('package-lock.json'), versions = read('versions.json');
const problems = [];
if (manifest.version !== tag) problems.push(`manifest.json version ${manifest.version} != tag ${tag}`);
if (pkg.version !== tag) problems.push(`package.json version ${pkg.version} != tag ${tag}`);
if (lock.version !== tag || lock.packages?.['']?.version !== tag) problems.push(`package-lock.json version ${lock.version} != tag ${tag} (run npm install --package-lock-only)`);
if (versions[tag] === undefined) problems.push(`versions.json has no entry for ${tag}`);
else if (versions[tag] !== manifest.minAppVersion) problems.push(`versions.json[${tag}] ${versions[tag]} != manifest minAppVersion ${manifest.minAppVersion}`);
if (problems.length) { for (const p of problems) console.error(p); process.exit(1); }
console.log(`[helm] release ${tag}: manifest, package.json, lockfile and versions.json agree`);
