import type { Browser, BrowserContext, Page } from 'playwright'

export interface BrowserSnapshot {
  url: string
  title: string
  content: string
  imageBase64: string
}

export interface BrowserControllerOptions {
  viewport?: { width: number; height: number }
  preferredChannel?: 'chrome' | 'msedge'
  launcher?: () => Promise<Browser>
}

export interface BrowserCommandResult {
  ok: boolean
  content: string
  snapshot?: BrowserSnapshot
  error?: string
}

export interface BrowserControl {
  open(url: string): Promise<BrowserCommandResult>
  content(): Promise<BrowserCommandResult>
  click(x: number, y: number): Promise<BrowserCommandResult>
  type(text: string): Promise<BrowserCommandResult>
  press(keys: string[]): Promise<BrowserCommandResult>
  screenshot(): Promise<BrowserCommandResult>
  close(): Promise<BrowserCommandResult>
}

function encodeBase64(value: Buffer | Uint8Array): string {
  return Buffer.from(value).toString('base64')
}

function bodyText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const text = document.body?.innerText || document.body?.textContent || ''
    return text.replace(/\s+/g, ' ').trim()
  })
}

async function launchBrowser(preferredChannel?: 'chrome' | 'msedge'): Promise<Browser> {
  const { chromium } = await import('playwright')
  const launchOptions: { headless: boolean; channel?: 'chrome' | 'msedge' } = {
    headless: false
  }
  if (preferredChannel) {
    launchOptions.channel = preferredChannel
  }

  try {
    return await chromium.launch(launchOptions)
  } catch {
    return await chromium.launch({ headless: false })
  }
}

export class PlaywrightBrowserController implements BrowserControl {
  private readonly options: BrowserControllerOptions
  private browser: Browser | undefined
  private context: BrowserContext | undefined
  private page: Page | undefined

  constructor(options: BrowserControllerOptions = {}) {
    this.options = options
  }

  private async ensurePage(): Promise<Page> {
    if (this.page && !this.page.isClosed()) {
      return this.page
    }

    this.browser ||= this.options.launcher
      ? await this.options.launcher()
      : await launchBrowser(this.options.preferredChannel)
    this.context ||= await this.browser.newContext({
      viewport: this.options.viewport || { width: 1280, height: 720 }
    })
    this.page = await this.context.newPage()
    return this.page
  }

  private async snapshot(page: Page): Promise<BrowserSnapshot> {
    const [title, content, screenshot] = await Promise.all([
      page.title().catch(() => ''),
      bodyText(page).catch(() => ''),
      page.screenshot({ type: 'png' }).catch(() => Buffer.from(''))
    ])

    return {
      url: page.url(),
      title,
      content,
      imageBase64: encodeBase64(screenshot)
    }
  }

  async open(url: string): Promise<BrowserCommandResult> {
    try {
      const page = await this.ensurePage()
      await page.goto(url, { waitUntil: 'domcontentloaded' })
      const snapshot = await this.snapshot(page)
      return {
        ok: true,
        content: snapshot.content || `Opened ${snapshot.url}`,
        snapshot
      }
    } catch (error) {
      return {
        ok: false,
        content: '',
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async content(): Promise<BrowserCommandResult> {
    try {
      const page = await this.ensurePage()
      const snapshot = await this.snapshot(page)
      return {
        ok: true,
        content: snapshot.content,
        snapshot
      }
    } catch (error) {
      return {
        ok: false,
        content: '',
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async click(x: number, y: number): Promise<BrowserCommandResult> {
    try {
      const page = await this.ensurePage()
      await page.mouse.click(x, y)
      const snapshot = await this.snapshot(page)
      return {
        ok: true,
        content: `Clicked ${x},${y}`,
        snapshot
      }
    } catch (error) {
      return {
        ok: false,
        content: '',
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async type(text: string): Promise<BrowserCommandResult> {
    try {
      const page = await this.ensurePage()
      await page.keyboard.type(text)
      const snapshot = await this.snapshot(page)
      return {
        ok: true,
        content: `Typed ${text.length} characters`,
        snapshot
      }
    } catch (error) {
      return {
        ok: false,
        content: '',
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async press(keys: string[]): Promise<BrowserCommandResult> {
    try {
      const page = await this.ensurePage()
      for (const key of keys) {
        await page.keyboard.press(key)
      }
      const snapshot = await this.snapshot(page)
      return {
        ok: true,
        content: `Pressed ${keys.join('+')}`,
        snapshot
      }
    } catch (error) {
      return {
        ok: false,
        content: '',
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async screenshot(): Promise<BrowserCommandResult> {
    try {
      const page = await this.ensurePage()
      const snapshot = await this.snapshot(page)
      return {
        ok: true,
        content: `Captured browser page ${snapshot.url}`,
        snapshot
      }
    } catch (error) {
      return {
        ok: false,
        content: '',
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async close(): Promise<BrowserCommandResult> {
    try {
      await this.page?.close()
      await this.context?.close()
      await this.browser?.close()
      this.page = undefined
      this.context = undefined
      this.browser = undefined
      return {
        ok: true,
        content: 'Browser closed'
      }
    } catch (error) {
      return {
        ok: false,
        content: '',
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }
}
