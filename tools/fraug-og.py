# The FRAUG page's preview image (Facebook/Open Graph, 1200x630): web/public/fraug/og.png, from web/public/logo.png.
# python tools/fraug-og.py (Pillow). Fonts: Windows' Segoe UI.
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

root = Path(__file__).resolve().parent.parent
W, H = 1200, 630
img = Image.new('RGB', (W, H), (8, 6, 14))
glow = Image.new('RGB', (W, H), (0, 0, 0))
ImageDraw.Draw(glow).ellipse((-200, 120, 700, 900), fill=(70, 20, 110))
img = Image.blend(img, glow.filter(ImageFilter.GaussianBlur(160)), 0.85)
logo = Image.open(root / 'web/public/logo.png').convert('RGBA')
logo.thumbnail((420, 420))
img.paste(logo, (60, (H - logo.height) // 2), logo)
d = ImageDraw.Draw(img)
fonts = Path('C:/Windows/Fonts')
bold = lambda s: ImageFont.truetype(str(fonts / 'segoeuib.ttf'), s)
reg = lambda s: ImageFont.truetype(str(fonts / 'segoeui.ttf'), s)
x = 540
d.text((x, 120), 'Ableton User Group', font=reg(40), fill=(200, 190, 220))
d.text((x, 165), 'Côte d’Azur', font=bold(64), fill=(255, 255, 255))
d.text((x, 270), 'Ableton Live 13', font=bold(44), fill=(190, 120, 255))
d.text((x, 325), '+ jam audiovisuel Reymenta', font=reg(38), fill=(230, 225, 240))
d.text((x, 430), 'Vendredi 18 décembre 2026 · 18h', font=bold(36), fill=(255, 255, 255))
d.text((x, 480), 'Cyberkiosc, Valbonne · entrée libre', font=reg(32), fill=(200, 190, 220))
img.save(root / 'web/public/fraug/og.png', optimize=True)
print('og.png', img.size)
