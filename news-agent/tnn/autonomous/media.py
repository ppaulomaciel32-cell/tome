"""Capas: foto enviada pelo editor ou arte do jornal. Nada aqui busca imagem na internet."""
import hashlib
import io
import os
import re
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont,ImageOps
from ..core import AgentError,LOCALS

Image.MAX_IMAGE_PIXELS=60_000_000
BASE='https://bot.tomezap.com.br/imagens'
PUBLIC=re.compile(r'https://bot\.tomezap\.com\.br/imagens/[a-f0-9]{32}-1600\.jpg')
FONT=os.getenv('FONT_BOLD','/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf')
ACCENT={'sao-goncalo':'#f2b134','pecem':'#35a7ff','taiba':'#2ec4b6','croata':'#ff8c42','paracuru':'#7bd389','regiao':'#b7d4f1'}

def font(size):
    try: return ImageFont.truetype(FONT,size)
    except OSError: return ImageFont.load_default(size)

class Covers:
    def __init__(self,directory=None,base=None):
        self.directory=Path(directory if directory is not None else os.getenv('MEDIA_DIR',''))
        self.base=base if base is not None else os.getenv('MEDIA_PUBLIC_URL','')
        # Só o endereço público revisado; qualquer outro valor desliga as capas próprias.
        self.enabled=self.base==BASE and str(self.directory) not in ('','.') and self.directory.is_dir() and os.access(self.directory,os.W_OK)
    def store(self,image,name,suffix,**options):
        target=self.directory/(name+suffix);partial=self.directory/('.'+name+suffix+'.tmp')
        image.save(partial,format='WEBP' if suffix.endswith('.webp') else 'JPEG',**options)
        os.chmod(partial,0o644);os.replace(partial,target)
    def site(self,image,name):
        # Versões do site em 16:9, leves; regravar a imagem também descarta EXIF e GPS.
        wide=ImageOps.fit(image,(1600,900),method=Image.Resampling.LANCZOS,centering=(.5,.4))
        self.store(wide,name,'-1600.jpg',quality=84,optimize=True,progressive=True)
        self.store(wide.resize((800,450),Image.Resampling.LANCZOS),name,'-800.webp',quality=78,method=4)
        return f'{self.base}/{name}-1600.jpg'
    def photo(self,raw):
        if not self.enabled: raise AgentError('Armazenamento de capas não configurado.')
        if not isinstance(raw,(bytes,bytearray)) or not 1000<=len(raw)<=25*1024*1024: raise AgentError('Foto fora do tamanho aceito.')
        try:
            with Image.open(io.BytesIO(raw)) as original:
                if original.format not in ('JPEG','PNG','WEBP'): raise AgentError('Formato de foto não aceito.')
                image=ImageOps.exif_transpose(original).convert('RGB')
        except AgentError: raise
        except Exception: raise AgentError('A foto não pôde ser lida.') from None
        if min(image.size)<400: raise AgentError('Foto pequena demais para a capa.')
        name=hashlib.sha256(raw).hexdigest()[:32]
        # Original guardado em até 4K, sem recorte; não é usado nas páginas.
        archive=image.copy();archive.thumbnail((3840,3840),Image.Resampling.LANCZOS)
        self.store(archive,name,'-4k.jpg',quality=90,optimize=True,progressive=True)
        return self.site(image,name)
    def source_photo(self,sources,public):
        """Primeira foto oficial utilizável entre as fontes; logotipo e ícone ficam de fora."""
        from .collection import official_photo
        for source in sources[:3]:
            try:
                found=official_photo(source,public)
                if not found:continue
                raw,credit=found
                with Image.open(io.BytesIO(raw)) as probe:width,height=probe.size
                # Foto panorâmica serve (o site recorta o centro em 16:9); logotipo quadrado ou miniatura, não.
                if width<800 or height<450 or not 1.2<=width/height<=4.0:continue
                return self.photo(raw),credit
            except Exception:continue
        return None
    def art(self,title,locality):
        if not self.enabled: raise AgentError('Armazenamento de capas não configurado.')
        title=' '.join(str(title).split())[:300];accent=ACCENT.get(locality,ACCENT['regiao'])
        image=Image.new('RGB',(1600,900),'#0b1f36');draw=ImageDraw.Draw(image)
        draw.rectangle((0,0,28,900),fill=accent)
        draw.rounded_rectangle((110,90,230,210),radius=28,fill='#ffffff')
        draw.text((170,150),'tn',anchor='mm',font=font(72),fill='#0b1f36')
        draw.text((262,150),'TOME NOTA NEWS',anchor='lm',font=font(44),fill='#ffffff')
        draw.text((110,290),LOCALS.get(locality,'Região').upper(),anchor='lm',font=font(34),fill=accent)
        lines=[]
        for size in (88,78,68,60,52,46):
            face=font(size);lines=[];line=''
            for word in title.split(' '):
                trial=(line+' '+word).strip()
                if draw.textlength(trial,font=face)<=1380: line=trial
                else:
                    if line: lines.append(line)
                    line=word
            if line: lines.append(line)
            # O título termina antes do rodapé (y=790): nunca invade o endereço do site.
            if len(lines)<=5 and len(lines)*int(size*1.2)<=430: break
        while len(lines)*int(size*1.2)>430: lines=lines[:-1]
        if lines and ' '.join(lines)!=title: lines[-1]=lines[-1].rstrip(' ,;:.')+'…'
        y=360
        for row in lines:
            draw.text((110,y),row,anchor='la',font=face,fill='#ffffff');y+=int(size*1.2)
        draw.text((110,830),'tomezap.com.br',anchor='lm',font=font(30),fill='#8baac8')
        return self.site(image,hashlib.sha256(('arte|'+locality+'|'+title).encode()).hexdigest()[:32])
