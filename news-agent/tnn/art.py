import io
import os
import textwrap
from datetime import datetime
from zoneinfo import ZoneInfo
from PIL import Image, ImageDraw, ImageFont, ImageOps, ImageEnhance
from .core import AgentError, LOCALS

Image.MAX_IMAGE_PIXELS=24000000
FONT=os.getenv('FONT_BOLD','/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf')

def photo_from_bytes(data):
    try:
        with Image.open(io.BytesIO(data)) as im:
            if im.format not in ('JPEG','PNG','WEBP'): raise ValueError('format')
            im.load()
            return ImageOps.exif_transpose(im).convert('RGB')
    except Exception:
        raise AgentError('A foto não pôde ser lida. Envie JPG, PNG ou WebP.') from None

def default_photo():
    im=Image.new('RGB',(1600,900),'#0b1f36');d=ImageDraw.Draw(im)
    d.text((800,350),'tn',anchor='mm',font=ImageFont.truetype(FONT,300),fill='white')
    d.text((800,620),'TOME NOTA NEWS',anchor='mm',font=ImageFont.truetype(FONT,65),fill='#b7d4f1')
    d.text((800,730),'IMAGEM PADRÃO',anchor='mm',font=ImageFont.truetype(FONT,32),fill='#8baac8')
    return im

def jpeg_bytes(photo):
    photo=ImageOps.fit(photo,(1600,900),method=Image.Resampling.LANCZOS)
    out=io.BytesIO();photo.save(out,'JPEG',quality=88,optimize=True)
    return out.getvalue()

def headline_lines(text,draw,font,width=952):
    lines=[];line=''
    for word in text.split():
        while draw.textlength(word,font=font)>width:
            cut=max(1,len(word)//2)
            while draw.textlength(word[:cut],font=font)>width: cut-=1
            if line: lines.append(line);line=''
            lines.append(word[:cut]);word=word[cut:]
        candidate=(line+' '+word).strip()
        if draw.textlength(candidate,font=font)>width:
            lines.append(line);line=word
        else: line=candidate
    if line: lines.append(line)
    if len(lines)>4:
        lines=lines[:4]
        last=lines[-1]
        while draw.textlength(last+'…',font=font)>width: last=last[:-1]
        lines[-1]=last.rstrip(' ,;:-')+'…'
    return lines

def render_story(article,photo=None,when=None):
    when=when or datetime.now(ZoneInfo('America/Fortaleza'))
    canvas=Image.new('RGB',(1080,1920),'#0b1f36');draw=ImageDraw.Draw(canvas)
    font=lambda size:ImageFont.truetype(FONT,size)
    draw.rounded_rectangle((64,72,226,224),radius=28,fill='#1d5791')
    draw.text((90,83),'tn',font=font(102),fill='white')
    draw.text((264,116),'TOME NOTA',font=font(46),fill='white')
    draw.text((266,171),'NEWS · CEARÁ',font=font(27),fill='#b7d4f1')
    image=ImageOps.fit(photo or default_photo(),(1080,830),method=Image.Resampling.LANCZOS)
    canvas.paste(ImageEnhance.Brightness(image).enhance(.84),(0,294))
    draw=ImageDraw.Draw(canvas)
    title_font=font(72)
    lines=headline_lines(article['titulo'],draw,title_font)
    for i,line in enumerate(lines): draw.text((64,1190+i*91),line,font=title_font,fill='white')
    draw.rectangle((64,1624,168,1633),fill='#5eadeb')
    draw.text((64,1670),LOCALS[article['localidade']],font=font(34),fill='#b7d4f1')
    draw.text((64,1730),when.strftime('%d/%m/%Y'),font=font(31),fill='white')
    draw.rectangle((0,1810,1080,1920),fill='#154a7b')
    draw.text((64,1840),'TOME NOTA NEWS',font=font(42),fill='white')
    out=io.BytesIO();canvas.save(out,'PNG',optimize=True)
    for colors in (256,192,128,64):
        if len(out.getvalue())<1500000: break
        out=io.BytesIO();canvas.quantize(colors=colors).save(out,'PNG',optimize=True)
    if len(out.getvalue())>=1500000: raise AgentError('A arte excedeu o limite de tamanho.')
    return out.getvalue()
