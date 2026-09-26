import { expect, test, type Page } from '@playwright/test'

async function runSource(page: Page, source: string) {
  const editor = page.getByRole('textbox', { name: 'JavaScript source' })
  await expect(editor).toBeVisible()
  await editor.click()
  await editor.press('ControlOrMeta+a')
  await page.keyboard.insertText(source)
  await page.getByRole('button', { name: 'Run code', exact: true }).click()
}

async function interceptExternalRequests(page: Page) {
  const attempted: string[] = []
  const origin = new URL(page.url()).origin
  // These are hostile-code probes. Never let a failed protection send a request
  // to the canary destination, or to any other external service.
  await page.context().route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.origin === origin) return route.continue()
    attempted.push(url.href)
    return route.abort()
  })
  return attempted
}

test('custom source remains isolated from the editor and blocked browser capabilities', async ({ page }) => {
  const response = await page.goto('/?code=1')
  expect(response?.headers()['content-security-policy']).toContain("frame-src 'none'")
  const attempted = await interceptExternalRequests(page)
  const violations: string[] = []
  page.on('console', message => {
    if (message.type() === 'error') violations.push(message.text())
  })
  await runSource(page, `function setup() {
    createCanvas(160, 100);
    background(220);
    noLoop();
    const result = {};
    for (const [name, action] of Object.entries({
      parent: () => parent.document.body.dataset.sketchEscaped = 'yes',
      storage: () => localStorage.length,
      cookie: () => document.cookie,
      top: () => top.location.href = 'https://sketch-canary.invalid/top',
      popup: () => window.open('about:blank') === null,
    })) {
      try { result[name] = action(); }
      catch (error) { result[name] = error.name; }
    }
    document.body.dataset.isolation = JSON.stringify(result);
    fetch('https://sketch-canary.invalid/fetch').then(
      () => document.body.dataset.fetch = 'allowed',
      () => document.body.dataset.fetch = 'blocked',
    );
    const image = new Image();
    image.onload = () => document.body.dataset.image = 'allowed';
    image.onerror = () => document.body.dataset.image = 'blocked';
    image.src = 'https://sketch-canary.invalid/image';
  }`)
  const preview = page.frameLocator('iframe')
  await expect(preview.locator('canvas')).toBeVisible()
  await expect(preview.locator('body')).toHaveAttribute('data-fetch', 'blocked')
  await expect(preview.locator('body')).toHaveAttribute('data-image', 'blocked')
  expect(JSON.parse((await preview.locator('body').getAttribute('data-isolation'))!)).toEqual({
    parent: 'SecurityError', storage: 'SecurityError', cookie: 'SecurityError',
    top: 'SecurityError', popup: true,
  })
  expect(await page.locator('body').getAttribute('data-sketch-escaped')).toBeNull()
  expect(page.context().pages()).toHaveLength(1)
  expect(page.url()).toContain('/?code=1')
  expect(attempted).toEqual([])
  expect(violations.some(message => message.includes("connect-src 'none'"))).toBe(true)
  expect(violations.some(message => message.includes('img-src'))).toBe(true)
})

for (const method of ['location', 'link', 'refresh'] as const) {
  test(`parent policy blocks custom ${method} navigation before any external request`, async ({ page }) => {
    await page.goto('/?code=1')
    const attempted = await interceptExternalRequests(page)
    const violations: string[] = []
    page.on('console', message => {
      if (message.type() === 'error') violations.push(message.text())
    })
    await runSource(page, `function setup() {
      createCanvas(160, 100);
      background(220);
      noLoop();
      const destination = 'https://sketch-canary.invalid/${method}';
      const button = document.createElement('${method}' === 'link' ? 'a' : 'button');
      button.textContent = 'Try navigation';
      button.style.cssText = 'position:fixed;z-index:1;top:0;left:0';
      if ('${method}' === 'link') button.href = destination;
      button.onclick = () => {
        if ('${method}' === 'location') location.href = destination;
        else if ('${method}' === 'refresh') {
          const refresh = document.createElement('meta');
          refresh.httpEquiv = 'refresh';
          refresh.content = '0;url=' + destination;
          document.head.appendChild(refresh);
        }
      };
      document.body.appendChild(button);
    }`)
    await expect(page.frameLocator('iframe').locator('canvas')).toBeVisible()
    await page.frameLocator('iframe').getByRole(method === 'link' ? 'link' : 'button', { name: 'Try navigation' }).click()
    await expect.poll(() => violations.some(message => message.includes("frame-src 'none'") && message.includes('sketch-canary.invalid'))).toBe(true)
    expect(attempted).toEqual([])
    expect(page.url()).toContain('/?code=1')
    await page.getByRole('button', { name: 'Reset original code', exact: true }).click()
    await expect(page.getByRole('application', { name: 'Squiggle canvas' })).toBeVisible()
  })
}

test('closing script text in a sketch stays literal source inside the sandbox', async ({ page }) => {
  await page.goto('/?code=1')
  const attempted = await interceptExternalRequests(page)
  const literal = '</script><script>parent.document.body.dataset.sketchEscaped="yes"</script>'
  await runSource(page, `const literal = ${JSON.stringify(literal)};
function setup() {
  createCanvas(160, 100);
  background(220);
  noLoop();
  document.body.dataset.literal = literal;
}`)
  await expect(page.frameLocator('iframe').locator('canvas')).toBeVisible()
  await expect(page.frameLocator('iframe').locator('body')).toHaveAttribute('data-literal', literal)
  expect(await page.locator('body').getAttribute('data-sketch-escaped')).toBeNull()
  expect(attempted).toEqual([])
  await expect(page.locator('.code-panel__error')).toBeEmpty()
})

test('custom code cannot initiate its own download even after a user clicks its button', async ({ page }) => {
  await page.goto('/?code=1')
  const attempted = await interceptExternalRequests(page)
  const downloads: string[] = []
  page.on('download', download => downloads.push(download.suggestedFilename()))
  await runSource(page, `function setup() {
    createCanvas(160, 100);
    background(220);
    noLoop();
    const button = document.createElement('button');
    button.textContent = 'Try download';
    button.style.cssText = 'position:fixed;z-index:1;top:0;left:0';
    button.onclick = () => {
      const link = document.createElement('a');
      link.href = document.querySelector('canvas').toDataURL('image/png');
      link.download = 'sketch-controlled.png';
      link.textContent = 'Download';
      document.body.appendChild(link);
      link.click();
      document.body.dataset.downloadAttempt = 'complete';
    };
    document.body.appendChild(button);
  }`)
  await expect(page.frameLocator('iframe').locator('canvas')).toBeVisible()
  await page.frameLocator('iframe').getByRole('button', { name: 'Try download' }).click()
  await expect(page.frameLocator('iframe').locator('body')).toHaveAttribute('data-download-attempt', 'complete')
  // Chromium can reject sandbox downloads silently. Observe the actual browser
  // download channel after the click, with the listener already armed above.
  await page.waitForEvent('download', { timeout: 1000 }).catch(() => undefined)
  expect(downloads).toEqual([])
  expect(attempted).toEqual([])
  await expect(page.frameLocator('iframe').locator('canvas')).toBeVisible()
})
