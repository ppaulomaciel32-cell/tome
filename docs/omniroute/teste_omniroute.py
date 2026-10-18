"""Teste local: OmniRoute + system prompt do Tome Nota + travas reais do robô.
Os dados da fonte abaixo são FICTÍCIOS, só para conferir formato. Nada é publicado."""
import json, re, sys, time, urllib.request
from pathlib import Path

REPO = Path.home() / 'tomezap-servidor/tome'
sys.path[:0] = [str(REPO / 'news-agent'), str(REPO / 'radar-viral')]
from tnn.autonomous.writer import Writer
from tnn_viral.editor import Editor

SYSTEM = (REPO / 'docs/omniroute/SYSTEM-PROMPT-TOMENOTA.txt').read_text().strip()
import os
if os.environ.get('SO_COMBO'):  # simula o robô: o combo do OmniRoute põe o prompt do jornal
    SYSTEM = 'Responda em JSON.'
MODEL = sys.argv[1] if len(sys.argv) > 1 else 'tomenota-editorial'

def chat(payload, max_tokens):
    body = {'model': MODEL, 'stream': False, 'temperature': 0.3, 'max_tokens': max_tokens + 6000,
            'response_format': {'type': 'json_object'},
            'messages': [{'role': 'system', 'content': SYSTEM},
                         {'role': 'user', 'content': json.dumps(payload, ensure_ascii=False)}]}
    req = urllib.request.Request('http://127.0.0.1:20128/v1/chat/completions', json.dumps(body).encode(),
        {'Content-Type': 'application/json', **({} if os.environ.get('SO_COMBO') else {'x-omniroute-compression': 'off'})})
    t = time.time()
    with urllib.request.urlopen(req, timeout=240) as r:
        data = json.load(r); used = r.headers.get('X-OmniRoute-Compression')
    msg = data['choices'][0]['message']['content']
    text = msg if isinstance(msg, str) else ''.join(p.get('text', '') for p in msg)
    text = re.sub(r'^```(?:json)?\s*|\s*```$', '', text.strip())
    print(f'  modelo real: {data.get("model")} | {time.time()-t:.0f}s | compressão: {used} | fim: {data["choices"][0].get("finish_reason")}')
    return text

class Fake:  # entrega a resposta do OmniRoute para as travas do robô
    def __init__(self, raw): self.raw = raw
    def generate(self, prompt, data, schema): return self.raw

fonte = {'id': 'pmsga', 'name': 'Prefeitura de São Gonçalo do Amarante',
  'title': 'Prefeitura abre inscrições para 120 vagas em cursos gratuitos de qualificação no Pecém',
  'url': 'https://www.saogoncalodoamarante.ce.gov.br/informa/teste',
  'published_date': '2026-10-17T12:00:00+00:00',
  'content': ('A Prefeitura de São Gonçalo do Amarante, por meio da Secretaria do Trabalho e Desenvolvimento Econômico, '
    'abriu inscrições para 120 vagas em cursos gratuitos de qualificação profissional no distrito do Pecém. '
    'São quatro turmas: operador de empilhadeira, eletricista predial, auxiliar de logística e informática básica, com 30 vagas cada. '
    'As inscrições vão até 31 de outubro e devem ser feitas presencialmente na sede da secretaria, das 8h às 14h, '
    'com RG, CPF e comprovante de residência no município. '
    'Os cursos têm carga horária de 160 horas e começam em 10 de novembro, no Centro de Formação do Pecém. '
    'Podem participar moradores com idade a partir de 18 anos. '
    '"Queremos preparar nossa população para as oportunidades geradas pelo Complexo do Pecém", afirmou o secretário do Trabalho. '
    'Segundo a secretaria, os alunos que concluírem a formação receberão certificado e terão o currículo encaminhado ao banco de talentos do município.')}

def materia():
    print('\n[1] Redigir matéria (fonte_unica_oficial)')
    raw = chat({'modo': 'fonte_unica_oficial', 'pauta': 'Cursos gratuitos no Pecém', 'fontes': [fonte]}, 4096)
    art = Writer(Fake(raw)).produce({'pauta': 'Cursos gratuitos no Pecém'}, [fonte])
    print('  PASSOU nas travas do robô:', art['titulo'], '|', len(art['texto'].split()), 'palavras |',
          len(re.split(r'\n\s*\n', art['texto'])), 'parágrafos |', art['localidade'])
    return art

def correcao(art):
    print('\n[2] Corrigir matéria a pedido do editor')
    old = {**art}
    prev = {k: old[k] for k in ('titulo', 'resumo', 'texto', 'localidade')}
    req = {'pauta': old['titulo'], 'versao_anterior': prev, 'correcao_solicitada': 'deixe a manchete mais curta e destaque o prazo'}
    raw = chat({'modo': 'fonte_unica_oficial', **req, 'fontes': [fonte]}, 4096)
    novo = Writer(Fake(raw)).produce(req, [fonte])
    print('  PASSOU:', novo['titulo'])

def recusa():
    print('\n[3] Fonte fraca (deve recusar)')
    fraca = {**fonte, 'id': 'x', 'title': 'Nota', 'content': 'Em breve mais informações sobre a obra.'}
    raw = chat({'modo': 'fonte_unica_oficial', 'pauta': 'Obra na Taíba', 'fontes': [fraca]}, 1024)
    print('  resposta:', raw[:120])

def radar():
    print('\n[4] Radar Viral (ângulo de pauta)')
    src = {'titulo': fonte['title'], 'trecho': fonte['content'], 'url': fonte['url'],
           'data': '2026-10-17T09:00:00-03:00', 'cidade_detectada': 'pecem'}
    raw = chat({'fonte': src, 'cidade': 'Pecém', 'correcao': ''}, 1500)
    ok = Editor.validate(json.loads(raw), src)
    print('  PASSOU nas travas do Radar:' if ok else '  REPROVADO pelas travas do Radar:', json.dumps(ok or json.loads(raw), ensure_ascii=False)[:400])

print('Modelo pedido:', MODEL, '| prompt com', len(SYSTEM), 'caracteres')
for passo in (lambda: correcao(materia()), recusa, radar):
    try: passo()
    except Exception as e: print('  FALHOU:', type(e).__name__, e)
