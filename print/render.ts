// Renders print/leave-behind.html to print/leave-behind.pdf (A5) and a 2x PNG preview.
// Uses the pre-installed Playwright: run with NODE_PATH=$(npm root -g). Never runs `playwright install`.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const dir = join(dirname(fileURLToPath(import.meta.url)));
const src = pathToFileURL(join(dir, 'leave-behind.html')).href;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 559, height: 794 }, deviceScaleFactor: 2 });
  await page.goto(src, { waitUntil: 'load' });
  await page.emulateMedia({ media: 'print' });
  await page.pdf({ path: join(dir, 'leave-behind.pdf'), format: 'A5', printBackground: true, preferCSSPageSize: true });

  // PNG preview: the screen view has no @page margin, so pad the sheet to the same 10 mm.
  await page.emulateMedia({ media: 'screen' });
  await page.addStyleTag({ content: 'body{width:148mm;height:210mm;box-sizing:border-box;padding:10mm;overflow:hidden}' });
  await page.screenshot({ path: join(dir, 'leave-behind.png'), fullPage: false });
  console.log('wrote print/leave-behind.pdf and print/leave-behind.png');
} finally {
  await browser.close();
}
