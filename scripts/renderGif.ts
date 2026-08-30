import puppeteer from 'puppeteer';
import GifEncoder from 'gif-encoder-2';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../src/config';

// ============================================================
// PATIENT ZERO — Headless GIF Renderer
// Captures 30 seconds of the live Three.js visualization
// and encodes it as a seamless animated GIF.
// ============================================================

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const OUTPUT_DIR   = path.join(process.cwd(), 'output');
const OUTPUT_FILE  = path.join(OUTPUT_DIR, 'patient-zero-bioluminescence.gif');

const WIDTH    = 1200;
const HEIGHT   = 675;
const FPS      = 20;
const DURATION = 30; // seconds
const TOTAL_FRAMES = FPS * DURATION;
const FRAME_DELAY  = Math.round(1000 / FPS); // ms

async function captureFrames(
  page: puppeteer.Page
): Promise<Buffer[]> {
  const frames: Buffer[] = [];

  for (let i = 0; i < TOTAL_FRAMES; i++) {
    const frame = await page.screenshot({ type: 'png' }) as Buffer;
    frames.push(frame);

    if (i % 60 === 0) {
      logger.info(`Capturing frame ${i + 1}/${TOTAL_FRAMES}…`);
    }

    // Wait for next frame interval
    await new Promise((r) => setTimeout(r, FRAME_DELAY));
  }

  return frames;
}

async function encodeGif(frames: Buffer[]): Promise<void> {
  logger.info(`Encoding ${frames.length} frames → ${OUTPUT_FILE}`);

  const encoder = new GifEncoder(WIDTH, HEIGHT);
  const stream  = fs.createWriteStream(OUTPUT_FILE);
  encoder.createReadStream().pipe(stream);

  encoder.start();
  encoder.setRepeat(0);       // 0 = loop forever
  encoder.setDelay(FRAME_DELAY);
  encoder.setQuality(10);     // 1 = best, 20 = fastest

  for (const frameBuffer of frames) {
    // GIF encoder expects raw RGBA pixel data
    // We need to convert PNG buffer to pixel array
    // Since we're in Node, use a basic approach via canvas pixel extraction
    const { createCanvas, loadImage } = await import('canvas').catch(() => {
      throw new Error(
        'Install canvas package: npm install canvas\n' +
        'Or use a different frame capture method.'
      );
    });

    const img    = await loadImage(frameBuffer);
    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx    = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, WIDTH, HEIGHT);
    const imageData = ctx.getImageData(0, 0, WIDTH, HEIGHT);
    encoder.addFrame(imageData.data as unknown as Uint8ClampedArray);
  }

  encoder.finish();

  await new Promise<void>((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

async function main(): Promise<void> {
  logger.info('PATIENT ZERO — GIF Renderer starting');
  logger.info(`Frontend URL: ${FRONTEND_URL}`);
  logger.info(`Output: ${OUTPUT_FILE}`);
  logger.info(`Resolution: ${WIDTH}×${HEIGHT} @ ${FPS}fps for ${DURATION}s`);

  // Ensure output directory exists
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

    // Wait for WebSocket to connect (loading screen to disappear)
    logger.info('Waiting for WebSocket connection…');
    await page.waitForFunction(
      () => {
        const loading = document.getElementById('loading');
        return loading && loading.classList.contains('hidden');
      },
      { timeout: 30_000 }
    ).catch(() => {
      logger.warn('Loading screen did not hide — proceeding anyway');
    });

    // Wait an additional 5 seconds for first data to appear
    logger.info('Waiting for live data…');
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

main().catch((err) => {
  logger.error('GIF render failed', err);
  if ((err as Error).message?.includes('ECONNREFUSED')) {
    console.error('\n⚠️  Frontend not running. Start it first with: npm run frontend\n');
  }
  process.exit(1);
});
