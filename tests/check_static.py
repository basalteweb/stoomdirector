from pathlib import Path
from html.parser import HTMLParser
import re, subprocess, json
ROOT=Path(__file__).resolve().parents[1]
class Check(HTMLParser):
    def __init__(self): super().__init__(); self.ids=[];self.refs=[]
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if 'id' in a:self.ids.append(a['id'])
        if tag in ('script','link'):
            ref=a.get('src') or a.get('href')
            if ref:self.refs.append(ref)
p=Check();p.feed((ROOT/'index.html').read_text())
assert len(p.ids)==len(set(p.ids)), 'Duplicate HTML ids'
for ref in p.refs:
    assert (ROOT/ref.split('?')[0]).is_file(), f'Missing asset {ref}'
for ref in re.findall(r"'\./([^']+)'",(ROOT/'sw.js').read_text()):
    assert (ROOT/ref).exists(), f'Missing cached asset {ref}'
for f in [*sorted((ROOT/'js').glob('*.js')),ROOT/'sw.js']:
    subprocess.run(['node','--check',str(f)],check=True,capture_output=True)
for f in [ROOT/'manifest.webmanifest',ROOT/'config/store.json']:
    json.loads(f.read_text())
assert '6.0.0 DIRECTOR' in (ROOT/'js/constants.js').read_text()
assert all('6.0.0' in r for r in p.refs if r.startswith(('js/','css/')))
for f in (ROOT/'css').glob('*.css'):
    text=f.read_text(); assert text.count('{')==text.count('}'),f'Unbalanced CSS {f}'
print(f'PASS static assets: {len(p.refs)} references, unique HTML ids, manifest/config, 17 script syntax checks and CSS braces.')
