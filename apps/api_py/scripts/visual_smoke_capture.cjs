/**
 * Task-aware visual smoke capture: optional customer register/login, modal dismiss, screenshots.
 * Usage: node visual_smoke_capture.cjs <config.json>
 * Requires playwright in repo node_modules (npm install from repo root).
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const configPath = process.argv[2];
if (!configPath) {
  console.error('Usage: node visual_smoke_capture.cjs <config.json>');
  process.exit(2);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const baseUrl = String(config.baseUrl || '').replace(/\/+$/, '');
const viewport = config.viewport || { width: 1280, height: 900 };

function absUrl(pathOrUrl) {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const p = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
  return `${baseUrl}${p}`;
}

async function dismissOverlays(page) {
  const selectors = [
    '#btn-cookie-allow',
    'button.action-close',
    '.modal-popup .action-close',
    '[aria-label="Close"]',
    'button[title="Close"]',
    'button:has-text("No, thanks")',
    'button:has-text("Close")',
  ];
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 400 })) {
        await el.click({ timeout: 1500 });
        await page.waitForTimeout(250);
      }
    } catch {
      /* ignore */
    }
  }
}

async function fillFirst(page, selectors, value) {
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 1500 })) {
        await el.fill(value, { timeout: 3000 });
        return true;
      }
    } catch {
      /* try next */
    }
  }
  return false;
}

async function clickFirst(page, selectors) {
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 1500 })) {
        await el.click({ timeout: 3000 });
        return true;
      }
    } catch {
      /* try next */
    }
  }
  return false;
}

async function registerCustomer(page, creds) {
  await page.goto(absUrl('/customer/account/create/'), { waitUntil: 'domcontentloaded', timeout: 45000 });
  await dismissOverlays(page);

  await fillFirst(page, ['#firstname', 'input[name="firstname"]'], creds.firstname);
  await fillFirst(page, ['#lastname', 'input[name="lastname"]'], creds.lastname);
  await fillFirst(page, ['#email_address', 'input[name="email"]', 'input[type="email"]'], creds.email);
  await fillFirst(page, ['#password', 'input[name="password"]'], creds.password);
  await fillFirst(
    page,
    ['#password-confirmation', 'input[name="password_confirmation"]'],
    creds.password,
  );

  const clicked = await clickFirst(page, [
    'button.action.submit.primary',
    'button[type="submit"]:has-text("Create an Account")',
    'button[type="submit"]',
  ]);
  if (!clicked) {
    throw new Error('Register submit button not found');
  }

  await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
}

async function loginCustomer(page, creds) {
  await page.goto(absUrl('/customer/account/login/'), { waitUntil: 'domcontentloaded', timeout: 45000 });
  await dismissOverlays(page);

  await fillFirst(page, ['#email', 'input[name="login[username]"]', 'input[name="email"]'], creds.email);
  await fillFirst(page, ['#pass', 'input[name="login[password]"]', 'input[name="password"]'], creds.password);

  const clicked = await clickFirst(page, [
    '#send2',
    'button.action.login.primary',
    'button[type="submit"]:has-text("Sign In")',
    'button[type="submit"]',
  ]);
  if (!clicked) {
    throw new Error('Login submit button not found');
  }

  await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
}

async function ensureAuth(page, auth) {
  if (!auth || auth.mode === 'none') return;

  const creds = auth.credentials || {};
  if (auth.mode === 'register') {
    try {
      await registerCustomer(page, creds);
      return;
    } catch {
      await loginCustomer(page, creds);
      return;
    }
  }
  if (auth.mode === 'login') {
    await loginCustomer(page, creds);
  }
}

async function captureTarget(page, target) {
  const url = absUrl(target.path || target.url || '/');
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await dismissOverlays(page);
  await page.waitForTimeout(Number(config.waitMs || 1200));

  const outputPath = target.outputPath;
  if (!outputPath) {
    throw new Error(`Missing outputPath for target ${target.label}`);
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await page.screenshot({ path: outputPath, fullPage: true });

  let ok = true;
  let detail = 'screenshot saved';
  let storefrontError = null;

  try {
    const title = await page.title();
    const bodyText = await page.locator('body').innerText({ timeout: 5000 });
    const lower = `${title}\n${bodyText}`.toLowerCase();
    const errorMarkers = [
      'exception printing',
      'there has been an error processing your request',
      'error report record number',
      '1 exception(s):',
      'validationexception',
      'entityref:',
      'is not valid.',
      'exception #0',
      'magento\\framework\\config\\dom',
      'theme layout update file',
    ];
    if (errorMarkers.some((marker) => lower.includes(marker))) {
      ok = false;
      detail = 'Magento error page detected';
      storefrontError = {
        type: 'StorefrontError',
        message: bodyText.slice(0, 800),
      };
    }
  } catch {
    /* non-fatal */
  }

  return { label: target.label, url, ok, detail, outputPath, storefrontError };
}

(async () => {
  const results = [];
  let browser;

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();

    await ensureAuth(page, config.auth);

    for (const target of config.targets || []) {
      try {
        results.push(await captureTarget(page, target));
      } catch (err) {
        results.push({
          label: target.label,
          url: absUrl(target.path || target.url || '/'),
          ok: false,
          detail: String(err.message || err),
          outputPath: target.outputPath || null,
          storefrontError: null,
        });
      }
    }

    await browser.close();
    process.stdout.write(JSON.stringify({ ok: results.every((r) => r.ok), results }));
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    process.stderr.write(String(err.stack || err));
    process.exit(1);
  }
})();
