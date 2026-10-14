// Renders SYNTHETIC evaluation images (Japanese product scenes with known ground truth) using local
// headless Chrome. Synthetic images test pipeline compatibility and basic Japanese reading; they do
// not measure real-photo recognition quality.
//
//   node scripts/render-test-images.mjs            → evaluation/images/synthetic/*.jpg
//   CHROME_PATH=/path/to/chrome node scripts/...   (default: macOS Google Chrome)
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'evaluation/images/synthetic');
const chromePath = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const manifest = JSON.parse(readFileSync(join(root, 'evaluation/manifest.json'), 'utf8'));

const WIDTH = 1200;
const HEIGHT = 900;

// Shared look: soft light, subtle grain and vignette so scenes resemble a phone photo.
const BASE_CSS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; }
  body { position: relative; font-family: "Hiragino Sans", "Hiragino Kaku Gothic ProN", sans-serif; }
  .grain::after { content: ""; position: absolute; inset: 0; pointer-events: none; opacity: .18; mix-blend-mode: multiply;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>"); }
  .vignette::before { content: ""; position: absolute; inset: 0; pointer-events: none; z-index: 5;
    background: radial-gradient(ellipse at 50% 45%, transparent 55%, rgba(0,0,0,.35) 100%); }
  .wood { background:
      repeating-linear-gradient(92deg, rgba(90,55,25,.10) 0 3px, transparent 3px 19px),
      repeating-linear-gradient(88deg, rgba(60,35,15,.08) 0 1px, transparent 1px 7px),
      linear-gradient(180deg, #c89a6a, #a8794c); }
  .card { position: absolute; background: #fffdf8; border-radius: 4px; box-shadow: 0 8px 18px rgba(0,0,0,.28); padding: 22px 26px; color: #222; }
  .price { color: #c8161d; font-weight: 800; letter-spacing: .01em; }
`;

const SCENES = {
  's1-hojicha-pouch': `
    <body class="wood grain vignette">
      <div style="position:absolute;left:170px;top:120px;width:380px;height:560px;transform:rotate(-3deg);
        border-radius:18px 18px 10px 10px;background:linear-gradient(100deg,#9c7650,#c79f74 40%,#b08760 70%,#8c6640);
        box-shadow:18px 26px 40px rgba(0,0,0,.45)">
        <div style="position:absolute;top:0;left:0;right:0;height:48px;border-radius:18px 18px 0 0;
          background:repeating-linear-gradient(90deg,#7d5a37 0 6px,#8f6a44 6px 12px)"></div>
        <div style="position:absolute;left:46px;right:46px;top:150px;height:280px;background:#f6f1e6;border-radius:6px;
          display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;color:#3a2a1a">
          <div style="font-family:'Hiragino Mincho ProN',serif;font-size:76px;font-weight:600;letter-spacing:.08em">ほうじ茶</div>
          <div style="font-size:24px">京都・宇治</div>
          <div style="font-size:20px;border-top:1px solid #8a7660;padding-top:10px">内容量 100g</div>
        </div>
      </div>
      <div class="card" style="left:650px;top:430px;width:380px;transform:rotate(2deg)">
        <div style="font-size:34px;font-weight:700">ほうじ茶 100g</div>
        <div class="price" style="font-size:88px;line-height:1.1">864<span style="font-size:44px">円</span></div>
        <div style="font-size:26px;color:#444">（税込）</div>
      </div>
    </body>`,

  's2-bowl-no-price': `
    <body class="grain vignette" style="background:
        repeating-linear-gradient(0deg,rgba(0,0,0,.035) 0 2px,transparent 2px 5px),
        repeating-linear-gradient(90deg,rgba(0,0,0,.03) 0 2px,transparent 2px 6px),#e7e1d6">
      <div style="position:absolute;left:280px;top:500px;width:640px;height:120px;border-radius:50%;
        background:radial-gradient(ellipse,rgba(0,0,0,.35),transparent 70%);filter:blur(8px)"></div>
      <div style="position:absolute;left:300px;top:250px;width:600px;height:330px;
        border-radius:0 0 300px 300px / 0 0 300px 300px;
        background:radial-gradient(ellipse at 35% 30%,#ffffff,#ece8df 45%,#cfc8bb 80%,#b8afa0)"></div>
      <div style="position:absolute;left:300px;top:200px;width:600px;height:110px;border-radius:50%;
        background:radial-gradient(ellipse at 50% 55%,#d9d2c4,#f4f1ea 65%,#fbfaf6 80%,#ddd6c8)"></div>
      <div style="position:absolute;left:520px;top:600px;width:120px;height:40px;
        border-radius:0 0 20px 20px;background:linear-gradient(#bdb3a2,#9b917f)"></div>
      <div class="card" style="left:760px;top:640px;width:300px;padding:16px 20px;transform:rotate(-4deg);background:#f3ead8">
        <div style="font-family:'Hiragino Mincho ProN',serif;font-size:40px;font-weight:600">粉引の飯碗</div>
        <div style="font-size:20px;color:#555;margin-top:6px">作家：山田窯</div>
      </div>
    </body>`,

  's3-spoon-tax-excluded': `
    <body class="grain vignette" style="background:linear-gradient(160deg,#3c4146,#2a2e33 60%,#23262a)">
      <div style="position:absolute;left:140px;top:330px;width:620px;height:46px;transform:rotate(-14deg);
        border-radius:23px;background:linear-gradient(180deg,#f3d58a,#c9a24a 45%,#8f6b22);
        box-shadow:10px 18px 24px rgba(0,0,0,.55)"></div>
      <div style="position:absolute;left:640px;top:200px;width:200px;height:150px;transform:rotate(-14deg);
        border-radius:50%;background:radial-gradient(ellipse at 40% 35%,#fbe7a8,#d6ae55 55%,#8f6b22);
        box-shadow:10px 18px 24px rgba(0,0,0,.55)"></div>
      <div class="card" style="left:260px;top:560px;width:640px;transform:rotate(1deg)">
        <div style="font-size:40px;font-weight:700">真鍮のティースプーン</div>
        <div style="display:flex;align-items:baseline;gap:16px">
          <span class="price" style="font-size:80px">¥1,800</span>
          <span style="font-size:30px;color:#444">（税抜）</span>
        </div>
      </div>
    </body>`,

  's4-shelf-three-jars': `
    <body class="wood grain vignette">
      <div style="position:absolute;left:0;right:0;top:0;height:560px;background:linear-gradient(#efe9df,#ddd3c4)"></div>
      <div style="position:absolute;left:0;right:0;top:560px;height:40px;background:linear-gradient(#8a5f38,#6e4a2a);box-shadow:0 10px 20px rgba(0,0,0,.4)"></div>
      ${[
        { x: 110, color: '#e9a21a', label: '柚子ジャム', price: '650' },
        { x: 470, color: '#8c1d3b', label: '梅ジャム', price: '650' },
        { x: 830, color: '#c3192b', label: 'いちごジャム', price: '700' },
      ]
        .map(
          (jar) => `
        <div style="position:absolute;left:${jar.x}px;top:200px;width:260px;height:360px">
          <div style="position:absolute;left:30px;right:30px;top:0;height:60px;border-radius:8px;background:linear-gradient(90deg,#b8b8b8,#eeeeee,#9a9a9a)"></div>
          <div style="position:absolute;left:0;right:0;top:56px;bottom:0;border-radius:24px;
            background:linear-gradient(90deg,rgba(255,255,255,.35),transparent 30%,transparent 70%,rgba(255,255,255,.2)),${jar.color};
            box-shadow:8px 14px 22px rgba(0,0,0,.35)"></div>
          <div style="position:absolute;left:30px;right:30px;top:150px;height:120px;background:#fbf7ee;border-radius:6px;
            display:flex;align-items:center;justify-content:center;font-size:32px;font-weight:700;color:#333">${jar.label}</div>
        </div>
        <div style="position:absolute;left:${jar.x + 20}px;top:610px;width:220px;height:110px;background:#fffef5;
          border-top:6px solid #f2c200;box-shadow:0 4px 8px rgba(0,0,0,.3);padding:8px 14px">
          <div style="font-size:22px;color:#333">${jar.label}</div>
          <div class="price" style="font-size:46px;line-height:1.1">${jar.price}<span style="font-size:24px">円</span></div>
        </div>`,
        )
        .join('')}
      <div style="position:absolute;left:0;right:0;top:760px;text-align:center;font-size:22px;color:#fff;text-shadow:0 1px 3px #000">表示価格はすべて税込です</div>
    </body>`,

  's5-pop-card-linen': `
    <body class="grain vignette" style="background:linear-gradient(135deg,#f4efe6,#e3dccf)">
      <div style="position:absolute;left:120px;top:300px;width:520px;height:380px;transform:rotate(-6deg);
        background:repeating-linear-gradient(0deg,rgba(120,100,70,.18) 0 2px,transparent 2px 6px),
                   repeating-linear-gradient(90deg,rgba(120,100,70,.14) 0 2px,transparent 2px 6px),#d9cdb5;
        border-radius:6px;box-shadow:16px 24px 36px rgba(0,0,0,.35)"></div>
      <div style="position:absolute;left:150px;top:420px;width:520px;height:300px;transform:rotate(-2deg);
        background:repeating-linear-gradient(0deg,rgba(120,100,70,.18) 0 2px,transparent 2px 6px),
                   repeating-linear-gradient(90deg,rgba(120,100,70,.14) 0 2px,transparent 2px 6px),#e6dcc6;
        border-radius:6px;box-shadow:12px 18px 28px rgba(0,0,0,.3)"></div>
      <div class="card" style="left:690px;top:150px;width:400px;height:520px;transform:rotate(3deg);background:#fff9e8;
        font-family:'Hiragino Maru Gothic ProN','Hiragino Sans',sans-serif;border:3px dashed #e07a3f">
        <div style="font-size:34px;color:#e07a3f;font-weight:700">店長おすすめ！</div>
        <div style="font-size:46px;font-weight:700;margin-top:30px;line-height:1.3">手織りの<br>麻ふきん</div>
        <div style="font-size:24px;color:#555;margin-top:16px">使うほどやわらかく</div>
        <div class="price" style="font-size:78px;margin-top:40px">1,320<span style="font-size:36px">円</span></div>
        <div style="font-size:24px;color:#444">税込</div>
      </div>
    </body>`,
};

function html(body) {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>${BASE_CSS}</style></head>${body}</html>`;
}

async function withChrome(run) {
  const profile = mkdtempSync(join(tmpdir(), 's2k-chrome-'));
  const proc = spawn(chromePath, ['--headless=new', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  try {
    const wsUrl = await new Promise((resolve, reject) => {
      let buffer = '';
      proc.stderr.on('data', (chunk) => {
        buffer += chunk;
        const match = /DevTools listening on (ws:\/\/\S+)/.exec(buffer);
        if (match) resolve(match[1]);
      });
      proc.on('error', reject);
      setTimeout(() => reject(new Error(`Chrome did not start (${chromePath})`)), 15000);
    });
    const socket = new WebSocket(wsUrl);
    await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));
    let nextId = 0;
    const pending = new Map();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    });
    const send = (method, params = {}, sessionId) =>
      new Promise((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, (message) => (message.error ? reject(new Error(message.error.message)) : resolve(message.result)));
        socket.send(JSON.stringify({ id, method, params, sessionId }));
      });
    await run(send);
    socket.close();
  } finally {
    const exited = new Promise((resolve) => proc.once('exit', resolve));
    proc.kill();
    await exited;
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

mkdirSync(outDir, { recursive: true });
const syntheticIds = new Set(manifest.images.filter((image) => image.source === 'synthetic').map((image) => image.id));

await withChrome(async (send) => {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false }, sessionId);
  await send('Page.enable', {}, sessionId);
  const { frameTree } = await send('Page.getFrameTree', {}, sessionId);

  for (const [id, body] of Object.entries(SCENES)) {
    if (!syntheticIds.has(id)) throw new Error(`Scene ${id} is missing from evaluation/manifest.json`);
    await send('Page.setDocumentContent', { frameId: frameTree.frame.id, html: html(body) }, sessionId);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 88 }, sessionId);
    const file = join(outDir, `${id}.jpg`);
    writeFileSync(file, Buffer.from(data, 'base64'));
    console.log(`rendered ${file}`);
  }
});
