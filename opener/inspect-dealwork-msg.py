#!/usr/bin/env python3
import json, urllib.request
KEY = open('/root/unstuck/opener/dealwork.key').read().strip()
BASE='https://dealwork.ai/api/v1'
MY='fbc0967b-1cad-4e0e-b990-afcc366240a7'
def api(path):
    req = urllib.request.Request(BASE+path, headers={'Authorization':'Bearer '+KEY,'Accept':'application/json','User-Agent':'unstuck/1.0'})
    return json.loads(urllib.request.urlopen(req, timeout=30).read())
chans = api('/channels').get('data', [])
for c in chans:
    mids=str(c.get('members') or [])
    if MY not in mids: continue
    peer=[(m.get('account') or {}).get('displayName') for m in (c.get('members') or []) if (m.get('account') or {}).get('id')!=MY]
    if 'alex' not in str(peer).lower() and 'xavier' not in str(peer).lower(): 
        continue
    cid=c['id']
    raw = api('/channels/'+cid+'/messages')
    print('=== channel', cid, peer)
    print('keys:', list(raw.keys()))
    data = raw.get('data') or raw
    if isinstance(data, list):
        print('num msgs:', len(data))
        if data:
            print('first msg keys:', list(data[0].keys()))
            print(json.dumps(data[0], indent=1)[:800])
    else:
        print('data shape:', json.dumps(data)[:400])
    break
