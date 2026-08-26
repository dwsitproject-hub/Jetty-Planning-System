import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('http://localhost:5173/login');
await page.locator('#login-username').fill('admin');
await page.locator('#login-password').fill('admin123');
await page.locator('form').getByRole('button', { name: /sign in/i }).click();
await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 20000 });
if (page.url().includes('/select-port')) {
  const val = await page.locator('#select-port-id option[value]:not([value=""])').first().getAttribute('value');
  await page.locator('#select-port-id').selectOption(val);
  await page.getByRole('button', { name: /continue/i }).click();
  await page.waitForURL((u) => !u.pathname.includes('/select-port'), { timeout: 20000 });
}
const cookies = await page.context().cookies();
console.log('URL', page.url());
console.log('COOKIES', JSON.stringify(cookies, null, 2));
const meProxy = await page.request.get('http://localhost:5173/api/v1/users/me');
console.log('ME_PROXY', meProxy.status(), await meProxy.text());
const meDirect = await page.request.get('http://localhost:3000/api/v1/users/me');
console.log('ME_DIRECT', meDirect.status(), await meDirect.text());
await browser.close();
