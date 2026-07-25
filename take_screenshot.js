import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  
  await page.setViewport({ width: 375, height: 812, isMobile: true, deviceScaleFactor: 2 });
  
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });
  
  await page.screenshot({ path: 'public/mobile-screenshot.png' });
  
  await browser.close();
  console.log('Screenshot saved to public/mobile-screenshot.png');
})();
