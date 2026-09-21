import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const dist = path.resolve('dist');
const serviceWorkerPath = path.join(dist, 'sw.js');

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else files.push(absolute);
  }
  return files;
}

const requiredFonts = /^(?:Ionicons|Inter_(?:400Regular|500Medium|600SemiBold|700Bold)|Literata_(?:400Regular|400Regular_Italic|700Bold)|Lora_(?:400Regular|400Regular_Italic|700Bold)|Merriweather_(?:400Regular|700Bold)|AtkinsonHyperlegible_(?:400Regular|700Bold)|Fraunces_(?:600SemiBold|600SemiBold_Italic|700Bold))\./;

const files = await walk(dist);
const offlineAssets = files
  .map((file) => path.relative(dist, file).replaceAll('\\', '/'))
  .filter((relative) =>
    relative.startsWith('_expo/static/js/web/')
    || (relative.endsWith('.ttf') && requiredFonts.test(path.basename(relative)))
  )
  .sort();

let serviceWorker = await readFile(serviceWorkerPath, 'utf8');
const injected = offlineAssets.map((relative) => `  \`${'${BASE}'}${relative}\`,`).join('\n');
serviceWorker = serviceWorker.replace('  /*__OFFLINE_ASSETS__*/', injected);
await writeFile(serviceWorkerPath, serviceWorker);

console.log(`Modo offline preparado con ${offlineAssets.length} recursos de la aplicación.`);
