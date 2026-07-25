import { chromium } from 'playwright';
import path from 'path';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 2,
    isMobile: true
  });
  
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
  
  await page.screenshot({ path: path.join(process.cwd(), 'public/mobile-screenshot.png') });
  
  await browser.close();
  console.log('Screenshot saved to public/mobile-screenshot.png');
})();
