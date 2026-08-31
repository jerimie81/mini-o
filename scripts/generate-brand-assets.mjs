import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const rootDir = process.cwd();
const brandDir = path.join(rootDir, 'docs', 'brand');
const frontendDir = path.join(rootDir, 'frontend');

fs.mkdirSync(brandDir, { recursive: true });
fs.mkdirSync(frontendDir, { recursive: true });

const markSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <!-- Hex "chip" outline: circuit-board vernacular for a systems/Android-tooling app -->
  <polygon points="256,86 400,171 400,341 256,426 112,341 112,171"
           fill="none" stroke="#5d83e6" stroke-width="26" stroke-linejoin="round"/>
  <!-- Pin-1 indicator notch, like an IC package -->
  <circle cx="256" cy="86" r="20" fill="#83a7ff"/>
  <!-- Center ring: the "O" in Mini-O, doubling as the workspace boundary -->
  <circle cx="256" cy="256" r="76" fill="none" stroke="#83a7ff" stroke-width="32"/>
</svg>`;

const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" fill="#111622" rx="64"/>
  <!-- Hex "chip" outline: circuit-board vernacular for a systems/Android-tooling app -->
  <polygon points="256,86 400,171 400,341 256,426 112,341 112,171"
           fill="none" stroke="#5d83e6" stroke-width="26" stroke-linejoin="round"/>
  <!-- Pin-1 indicator notch, like an IC package -->
  <circle cx="256" cy="86" r="20" fill="#83a7ff"/>
  <!-- Center ring: the "O" in Mini-O, doubling as the workspace boundary -->
  <circle cx="256" cy="256" r="76" fill="none" stroke="#83a7ff" stroke-width="32"/>
</svg>`;

const bannerSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 320" width="1280" height="320">
  <defs>
    <style>
      .title { font-family: "JetBrains Mono", "DejaVu Sans Mono", "Courier New", monospace; font-weight: 800; font-size: 82px; fill: #ffffff; letter-spacing: -1px; }
      .subtitle { font-family: "JetBrains Mono", "DejaVu Sans Mono", "Courier New", monospace; font-weight: 500; font-size: 27px; fill: #8a99b5; letter-spacing: 0.5px; }
    </style>
  </defs>
  <rect width="1280" height="320" fill="#111622"/>
  
  <!-- Circuit trace decorative lines in background -->
  <path d="M 0 90 L 150 90 L 170 65 L 1280 65" stroke="#1f283d" stroke-width="2" fill="none" opacity="0.8" />
  <path d="M 0 255 L 170 255 L 190 280 L 1280 280" stroke="#1f283d" stroke-width="2" fill="none" opacity="0.8" />

  <!-- Logo Mark at left -->
  <g transform="translate(64, 48) scale(0.4375)">
    <polygon points="256,86 400,171 400,341 256,426 112,341 112,171"
             fill="none" stroke="#5d83e6" stroke-width="26" stroke-linejoin="round"/>
    <circle cx="256" cy="86" r="20" fill="#83a7ff"/>
    <circle cx="256" cy="256" r="76" fill="none" stroke="#83a7ff" stroke-width="32"/>
  </g>

  <!-- Typography -->
  <text x="320" y="152" class="title">Mini-O</text>
  <text x="320" y="215" class="subtitle">local-first AI workspace &amp; agent orchestrator</text>
</svg>`;

async function run() {
  // Save SVG files
  fs.writeFileSync(path.join(rootDir, 'mark.svg'), markSvg, 'utf-8');
  fs.writeFileSync(path.join(brandDir, 'mark.svg'), markSvg, 'utf-8');
  fs.writeFileSync(path.join(frontendDir, 'mark.svg'), markSvg, 'utf-8');
  fs.writeFileSync(path.join(frontendDir, 'favicon.svg'), markSvg, 'utf-8');

  // Render PNGs
  const iconBuffer = Buffer.from(iconSvg);
  await sharp(iconBuffer).png().toFile(path.join(brandDir, 'playstore-icon-512.png'));
  await sharp(iconBuffer).png().toFile(path.join(frontendDir, 'playstore-icon-512.png'));

  const bannerBuffer = Buffer.from(bannerSvg);
  await sharp(bannerBuffer).png().toFile(path.join(brandDir, 'banner.png'));
  await sharp(bannerBuffer).png().toFile(path.join(frontendDir, 'banner.png'));

  console.log('Brand assets generated successfully:');
  console.log('- mark.svg (root, docs/brand/, frontend/)');
  console.log('- docs/brand/banner.png');
  console.log('- docs/brand/playstore-icon-512.png');
  console.log('- frontend/favicon.svg');
}

run().catch(err => {
  console.error('Error generating brand assets:', err);
  process.exit(1);
});
