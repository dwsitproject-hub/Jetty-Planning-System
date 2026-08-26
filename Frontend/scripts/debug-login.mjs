import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('response', async (r) => {
  if (r.url().includes('/auth') || r.url().includes('/login')) {
    const headers = r.headers();
    console.log('RESP', r.status(), r.url(), 'set-cookie:', headers['set-cookie'] || '(none)');
  }
});
page.on('console', (m) => console.log('CONSOLE', m.type(), m.text()));

await page.goto('http://localhost:5173/login');
await page.locator('#login-username').fill('admin');
await page.locator('#login-password').fill('admin123');
await page.locator('form').getByRole('button', { name: /sign in/i }).click();
await page.waitForTimeout(5000);
console.log('FINAL URL', page.url());
console.log('ERROR VISIBLE', await page.locator('.guest-branded__error, .form-error, [role="alert"]').textContent().catch(() => '(none)'));
console.log('COOKIES', await page.context().cookies());
await browser.close();
