// Minimal headless-Chrome driver over the DevTools protocol (no extra test dependencies).
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
];

export function chromePath(): string | null {
  return CANDIDATES.find((path): path is string => Boolean(path && existsSync(path))) ?? null;
}

type Send = (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>;

export interface Page {
  send: Send;
  evaluate<T = unknown>(expression: string): Promise<T>;
  waitFor(expression: string, timeoutMs?: number): Promise<void>;
  navigate(url: string): Promise<void>;
  fill(label: string, value: string, scope?: string): Promise<void>;
  click(text: string, scope?: string): Promise<void>;
  press(key: 'Tab' | 'Enter' | 'Escape', shift?: boolean): Promise<void>;
  type(text: string): Promise<void>;
  setFile(selector: string, path: string): Promise<void>;
  screenshot(path: string): Promise<{ overflow: boolean }>;
  close(): Promise<void>;
}

const KEYS = { Tab: { code: 'Tab', keyCode: 9 }, Enter: { code: 'Enter', keyCode: 13 }, Escape: { code: 'Escape', keyCode: 27 } } as const;

export async function openPage(options: { width?: number; height?: number } = {}): Promise<Page> {
  const executable = chromePath();
  if (!executable) throw new Error('Chrome not found; set CHROME_PATH');
  const profile = mkdtempSync(join(tmpdir(), 's2k-e2e-'));
  const proc: ChildProcess = spawn(executable, ['--headless=new', '--disable-gpu', '--no-sandbox', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const wsUrl = await new Promise<string>((resolve, reject) => {
    let buffer = '';
    proc.stderr?.on('data', (chunk) => {
      buffer += String(chunk);
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(buffer);
      if (match?.[1]) resolve(match[1]);
    });
    setTimeout(() => reject(new Error('Chrome did not start')), 20_000);
  });

  const socket = new WebSocket(wsUrl);
  await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));
  let nextId = 0;
  const pending = new Map<number, (message: { result?: Record<string, unknown>; error?: { message: string } }) => void>();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  });
  const raw = (method: string, params: Record<string, unknown> = {}, sessionId?: string) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, (message) => (message.error ? reject(new Error(`${method}: ${message.error.message}`)) : resolve(message.result ?? {})));
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });

  const { targetId } = await raw('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = (await raw('Target.attachToTarget', { targetId, flatten: true })) as { sessionId: string };
  const send: Send = (method, params) => raw(method, params, sessionId);
  await send('Emulation.setDeviceMetricsOverride', { width: options.width ?? 360, height: options.height ?? 760, deviceScaleFactor: 1, mobile: true });
  await send('Page.enable');

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const evaluate = async <T,>(expression: string): Promise<T> => {
    const result = (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })) as {
      result: { value: T };
      exceptionDetails?: { text: string };
    };
    if (result.exceptionDetails) throw new Error(`${result.exceptionDetails.text}: ${expression.slice(0, 100)}`);
    return result.result.value;
  };
  const scoped = (scope?: string) => (scope ? `document.querySelector(${JSON.stringify(scope)})` : 'document');

  const page: Page = {
    send,
    evaluate,
    async waitFor(expression, timeoutMs = 20_000) {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        if (await evaluate<boolean>(`Boolean(${expression})`).catch(() => false)) return;
        await sleep(200);
      }
      throw new Error(`Timed out waiting for: ${expression}`);
    },
    async navigate(url) {
      await send('Page.navigate', { url });
      await sleep(600);
    },
    async fill(label, value, scope) {
      await evaluate(`(() => {
        const root = ${scoped(scope)};
        const l = [...root.querySelectorAll('label')].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
        if (!l) throw new Error('label not found: ' + ${JSON.stringify(label)});
        const el = document.getElementById(l.htmlFor);
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
        el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
      })()`);
    },
    async click(text, scope) {
      await evaluate(`(() => {
        const root = ${scoped(scope)};
        const b = [...root.querySelectorAll('button, a')].find((x) => x.textContent.trim() === ${JSON.stringify(text)});
        if (!b) throw new Error('button not found: ' + ${JSON.stringify(text)});
        b.click();
      })()`);
    },
    async press(key, shift = false) {
      const info = KEYS[key];
      const base = { key, code: info.code, windowsVirtualKeyCode: info.keyCode, nativeVirtualKeyCode: info.keyCode, modifiers: shift ? 8 : 0 };
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
      if (key === 'Enter') await send('Input.dispatchKeyEvent', { type: 'char', text: '\r', ...base });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
      await sleep(80);
    },
    async type(text) {
      await send('Input.insertText', { text });
    },
    async setFile(selector, path) {
      const { root } = (await send('DOM.getDocument', { depth: -1 })) as { root: { nodeId: number } };
      const { nodeId } = (await send('DOM.querySelector', { nodeId: root.nodeId, selector })) as { nodeId: number };
      await send('DOM.setFileInputFiles', { nodeId, files: [path] });
    },
    async screenshot(path) {
      const { data } = (await send('Page.captureScreenshot', { format: 'png' })) as { data: string };
      writeFileSync(path, Buffer.from(data, 'base64'));
      const overflow = await evaluate<boolean>('document.documentElement.scrollWidth > window.innerWidth');
      return { overflow };
    },
    async close() {
      socket.close();
      proc.kill('SIGKILL');
      rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
    },
  };
  return page;
}
