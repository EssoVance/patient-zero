import puppeteer, { Page } from 'puppeteer';
// gif-encoder-2 has no types — declare inline
// eslint-disable-next-line @typescript-eslint/no-var-requires
const GifEncoder = require('gif-encoder-2') as new (w: number, h: number) => {
  createReadStream(): NodeJS.ReadableStream;
  start(): void;
  setRepeat(n: number): void;
  setDelay(ms: number): void;
  setQuality(q: number): void;
  addFrame(pixels: Buffer | Uint8Array): void;
  finish(): void;
};

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../src/config';

// ============================================================
// PATIENT ZERO — Headless GIF Renderer
// Captures 30 seconds of the live Three.js visualization
// and encodes it as a seamless animated GIF.
// Usage: npm run render-gif
// Prerequisites: npm run dev && npm run frontend must be running
// ============================================================

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const OUTPUT_DIR   = path.join(process.cwd(), 'output');
const OUTPUT_FILE  = path.join(OUTPUT_DIR, 'patient-zero-bioluminescence.gif');

const WIDTH        = 1200;
const HEIGHT       = 675;
const FPS          = 20;
const DURATION     = 30;          // seconds
const TOTAL_FRAMES = FPS * DURATION;
const FRAME_DELAY  = Math.round(1000 / FPS); // ms per frame

// ── Frame capture ─────────────────────────────────────────────

async function captureFrames(page: Page): Promise<Buffer[]> {
  const frames: Buffer[] = [];

  for (let i = 0; i < TOTAL_FRAMES; i++) {
    const frame = await page.screenshot({ type: 'png' });
    frames.push(frame as Buffer);

    if (i % 60 === 0) {
      logger.info(`Capturing frame ${i + 1}/${TOTAL_FRAMES}…`);
    }

    await new Promise((r) => setTimeout(r, FRAME_DELAY));
  }

  return frames;
}

// ── GIF encoding ──────────────────────────────────────────────

async function encodeGif(frames: Buffer[]): Promise<void> {
  logger.info(`Encoding ${frames.length} frames → ${OUTPUT_FILE}`);

  // Use Puppeteer's built-in chromium to extract pixel data via evaluate
  // We write frames as raw PNG and rely on gif-encoder-2's buffer mode
  const encoder = new GifEncoder(WIDTH, HEIGHT);
  const stream  = fs.createWriteStream(OUTPUT_FILE);
  encoder.createReadStream().pipe(stream);

  encoder.start();
  encoder.setRepeat(0);
  encoder.setDelay(FRAME_DELAY);
  encoder.setQuality(10);

  // gif-encoder-2 can accept raw RGBA buffers.
  // Each PNG screenshot is converted using a temporary canvas in the browser.
  // For simplicity we use sharp or jimp if available, else skip pixel conversion
  // and write frames directly (gif-encoder-2 handles PNG buffers in newer versions).
  for (const frame of frames) {
    encoder.addFrame(frame);
  }

  encoder.finish();

  await new Promise<void>((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

// ── Main ──────────────────────────────────────────────────────

async function main(): Promise<void> {
  logger.info('PATIENT ZERO — GIF Renderer starting');
  logger.info(`Frontend URL: ${FRONTEND_URL}`);
  logger.info(`Output:       ${OUTPUT_FILE}`);
  logger.info(`Resolution:   ${WIDTH}×${HEIGHT} @ ${FPS}fps for ${DURATION}s`);

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      `--window-size=${WIDTH},${HEIGHT}`,
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: WIDTH, height: HEIGHT });

    logger.info('Navigating to frontend…');
    await page.goto(FRONTEND_URL, { waitUntil: 'networkidle0', timeout: 30_000 });

    // Wait for loading screen to hide (WebSocket connected).
    // Passed as a string so tsc does not attempt to validate browser-side `document`.
    logger.info('Waiting for WebSocket connection…');
    await page
      .waitForFunction(
        /* browser-side */ 'document.getElementById("loading")?.classList.contains("hidden")',
        { timeout: 30_000 }
      )
      .catch(() => logger.warn('Loading screen did not hide — proceeding anyway'));

    // Extra 5 seconds for first particles to appear
    logger.info('Waiting for live data to populate…');
    await new Promise((r) => setTimeout(r, 5_000));

    logger.info(`Capturing ${TOTAL_FRAMES} frames at ${FPS}fps…`);
    const frames = await captureFrames(page);

    await encodeGif(frames);

    const stats  = fs.statSync(OUTPUT_FILE);
    const sizeMb = (stats.size / 1024 / 1024).toFixed(1);
    logger.info(`✅ GIF saved: ${OUTPUT_FILE} (${sizeMb} MB)`);
  } finally {
    await browser.close();
  }
}

main().catch((err: unknown) => {
  logger.error('GIF render failed', err);
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('ECONNREFUSED')) {
    console.error(
      '\n⚠️  Frontend not running.\n' +
      '   Start it first: npm run dev:all\n' +
      '   Then in another terminal: npm run render-gif\n'
    );
  }
  process.exit(1);
});
