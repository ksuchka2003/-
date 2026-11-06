import { copyFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
export function prepareOcrAssets() {
  const target = join(process.cwd(), 'public', 'ocr');
  mkdirSync(target, { recursive: true });
  const copy = (source: string, name: string) => {
    const output = join(target, name);
    try {
      if (statSync(output).size === statSync(source).size) return;
    } catch {
      /* First build. */
    }
    copyFileSync(source, output);
  };
  const tesseract = dirname(require.resolve('tesseract.js/package.json'));
  copy(join(tesseract, 'dist', 'worker.min.js'), 'worker.min.js');
  copy(join(tesseract, 'LICENSE.md'), 'LICENSE-tesseract');
  const core = dirname(require.resolve('tesseract.js-core/package.json'));
  for (const name of readdirSync(core))
    if (/\.wasm(?:\.js)?$/.test(name)) copy(join(core, name), name);
  copy(join(core, 'LICENSE'), 'LICENSE-core');
  for (const lang of ['rus', 'eng']) {
    const root = dirname(require.resolve(`@tesseract.js-data/${lang}/package.json`));
    copy(join(root, '4.0.0_best_int', lang + '.traineddata.gz'), lang + '.traineddata.gz');
  }
}
