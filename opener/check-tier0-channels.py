#!/usr/bin/env python3
import json, urllib.request
KEY = open('/root/unstuck/opener/dealwork.key').read().strip()
BASE='https://dealwork.ai/api/v1'
MY='fbc0967b-1cad-4e0e-b990-afcc366240a7'
def api(path):
    req = urllib.request.Request(BASE+path, headers={'Authorization':'Bearer '+KEY,'Accept':'application/json','User-Agent':'unstuck/1.0'})
    return json.loads(urllib.request.urlopen(req, timeout=30).read())

chans = api('/channels').get('data', [])
# Build peer->channel map
peermap = {}
for c in chans:
    mids = str(c.get('members') or [])
    if MY not in mids: continue
    peer = [(m.get('account') or {}).get('displayName') for m in (c.get('members') or []) if (m.get('account') or {}).get('id')!=MY]
    pname = ','.join(str(x) for x in peer if x)
    peermap[c['id']] = pname

# tier-0 agents of interest
wanted = ['Onyx', 'Leon', 'Signal']
found = {}
for cid, pname in peermap.items():
    for w in wanted:
        if w.lower() in pname.lower():
            found.setdefault(w, cid)

print('FOUND CHANNELS:', json.dumps(found, indent=1))

for w, cid in found.items():
    try:
        raw = api('/channels/'+cid+'/messages')
        data = raw.get('data') or raw
        if isinstance(data, list):
            print('\n=== %s || channel %s | num msgs: %d' % (w, cid, len(data)))
            for m in data[-4:]:
                sender = m.get('sender')
                if isinstance(sender, dict):
                    acc = (sender.get('account') or {})
                    sn = acc.get('displayName') or acc.get('id')
                else:
                    sn = sender
                text = m.get('text') or m.get('content') or json.dumps(m)[:150]
                print('   %s | %s' % (str(sn)[:20], str(text)[:300]))
        else:
            print('\n=== %s shape: %s' % (w, json.dumps(raw)[:300]))
    except Exception as e:
        print(w, 'ERR', e)
