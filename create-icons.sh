#!/bin/bash

# Create a simple SVG icon
cat > public/icons/icon.svg << 'SVGEOF'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="20" fill="url(#gradient)"/>
  <defs>
    <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#667eea;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#764ba2;stop-opacity:1" />
    </linearGradient>
  </defs>
  <text x="64" y="90" font-family="Arial, sans-serif" font-size="72" font-weight="bold" fill="white" text-anchor="middle">C</text>
</svg>
SVGEOF

# Install ImageMagick if not present, or use sips (macOS) to convert SVG to PNG
if command -v convert &> /dev/null; then
  # Using ImageMagick
  convert public/icons/icon.svg -resize 16x16 public/icons/icon16.png
  convert public/icons/icon.svg -resize 32x32 public/icons/icon32.png
  convert public/icons/icon.svg -resize 48x48 public/icons/icon48.png
  convert public/icons/icon.svg -resize 128x128 public/icons/icon128.png
elif command -v sips &> /dev/null; then
  # Using macOS sips to create simple PNGs
  echo "Creating placeholder icons..."
  # Create simple colored PNGs using Python or a fallback
  python3 << 'PYEOF'
from PIL import Image, ImageDraw, ImageFont
import os

# Create icon directory
os.makedirs('public/icons', exist_ok=True)

# Create each size
for size in [16, 32, 48, 128]:
    img = Image.new('RGB', (size, size), color='#667eea')
    img.save(f'public/icons/icon{size}.png')
    print(f'Created icon{size}.png')

PYEOF
else
  echo "Neither ImageMagick nor Python PIL available. Creating simple icons..."
  # Fallback: create minimal PNGs
  cat > create_simple_icon.py << 'PYEOF'
try:
    from PIL import Image
    os.makedirs('public/icons', exist_ok=True)
    for size in [16, 32, 48, 128]:
        img = Image.new('RGB', (size, size), color='#667eea')
        img.save(f'public/icons/icon{size}.png')
except ImportError:
    print("PIL not available, creating placeholder files")
    os.makedirs('public/icons', exist_ok=True)
    for size in [16, 32, 48, 128]:
        open(f'public/icons/icon{size}.png', 'a').close()
PYEOF
  python3 create_simple_icon.py
fi

echo "Icons created in public/icons/"
