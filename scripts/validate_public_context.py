#!/usr/bin/env python3
import json
from pathlib import Path
p=Path(__file__).resolve().parents[1]/'data'/'public-context.json'
try:
    x=json.loads(p.read_text('utf-8'))
except Exception as e:
    raise SystemExit(f'INVALID JSON: {e}')
errors=[]
if x.get('schema_version')!=2: errors.append('schema_version != 2')
for key in ('works','works_history','weather','source_health','agenda','agenda_history','cvelo','bike_counts'):
    if key in x and not isinstance(x.get(key),list): errors.append(f'{key} missing/invalid')
if not isinstance(x.get('clermont_api',{}).get('health'),dict): errors.append('clermont_api.health missing')
if 't2c' in x and not isinstance(x.get('t2c'),dict): errors.append('t2c invalid')
for w in x.get('works',[]):
    if not isinstance(w,dict) or not w.get('sector') or not w.get('text'): errors.append('invalid works row'); break
for e in x.get('agenda',[]):
    if not isinstance(e,dict) or not e.get('title'): errors.append('invalid agenda row'); break
if errors: raise SystemExit('INVALID CONTEXT: '+'; '.join(errors))
print(f"OK schema=2 status={x.get('status')} works={len(x.get('works',[]))} agenda={len(x.get('agenda',[]))} cvelo={len(x.get('cvelo',[]))} bike={len(x.get('bike_counts',[]))} t2c_ok={bool(x.get('t2c',{}).get('ok'))} parking={len(x.get('parking',[]))} sources={len(x.get('source_health',[]))}")
