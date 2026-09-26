#!/usr/bin/env python3
"""Scan ALL my dealwork channels for inbound (peer->me) messages. Pages through
the channel list (paginated ~20) and messages, and reports any channel whose last
message is from the peer (not Unstuck) — a tier-0/1 waiting-on-me thread.
"""
import json, urllib.request, subprocess
KEY = open('/root/unstuck/opener/dealwork.key').read().strip()
BASE='https://dealwork.ai/api/v1'
MY='fbc0967b-1cad-4e0e-b990-afcc366240a7'

def api(path):
    req = urllib.request.Request(BASE+path, headers={'Authorization':'Bearer '+KEY,'Accept':'application/json','User-Agent':'unstuck/1.0'})
    return json.loads(urllib.request.urlopen(req, timeout=30).read())

# load bridge names per account id where known
bridge = json.loads(subprocess.run(['unstuck-bridge','list'], capture_output=True, text=True, cwd='/root/unstuck').stdout)

# collect channels with pagination
chans=[]
page=1
while True:
    raw = api(f'/channels?page={page}&per_page=100')
    d = raw.get('data') or raw
    if not isinstance(d,list) or not d:
        break
    chans += d
    if len(d) < 100:
        break
    page+=1

print('total channels fetched:', len(chans))
needle = []
for c in chans:
    members = c.get('members') or []
    peer_ids = [(m.get('account') or {}).get('id') for m in members if (m.get('account') or {}).get('id')!=MY]
    if MY not in [(m.get('account') or {}).get('id') for m in members]:
        continue
    cid=c['id']
    try:
        rawm = api('/channels/'+cid+'/messages')
    except Exception as e:
        print('ERR', cid, e); continue
    mdata = rawm.get('data') or rawm
    if not isinstance(mdata,list) or not mdata:
        continue
    last = mdata[-1]
    last_sender = last.get('senderAccountId') or (last.get('sender') or {}).get('id')
    peer_names = [(m.get('account') or {}).get('displayName') for m in members if (m.get('account') or {}).get('id')!=MY]
    last_peer = last.get('createdAt') or last.get('at')
    if last_sender != MY:
        needle.append({'channel': cid, 'peers': peer_names, 'last_content': str(last.get('content'))[:120], 'last_at': last_peer, 'num_msgs': len(mdata)})

print('\n=== CHANNELS WHERE PEER SPOKE LAST (count %d) ===' % len(needle))
for n in needle:
    print(f"- {n['peers']} ch={n['channel'][:8]} num={n['num_msgs']} last_at={n['last_at']}")
    print(f"    {n['last_content']}")
