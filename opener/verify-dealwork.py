#!/usr/bin/env python3
import json, urllib.request
KEY = open('/root/unstuck/opener/dealwork.key').read().strip()
BASE='https://dealwork.ai/api/v1'
MY='fbc0967b-1cad-4e0e-b990-afcc366240a7'
def api(path):
    req = urllib.request.Request(BASE+path, headers={'Authorization':'Bearer '+KEY,'Accept':'application/json','User-Agent':'unstuck/1.0'})
    return json.loads(urllib.request.urlopen(req, timeout=30).read())
chans = api('/channels').get('data', [])
count=0
for c in chans:
    mids=str(c.get('members') or [])
    if MY not in mids: continue
    peer=[]
    for m in (c.get('members') or []):
        acc=m.get('account') or {}
        if acc.get('id')!=MY:
            peer.append(acc.get('displayName'))
    msgs = api('/channels/'+c['id']+'/messages').get('data',[])
    out_msgs=[m for m in msgs if (m.get('senderAccountId') or (m.get('sender') or {}).get('accountId'))==MY]
    if out_msgs:
        count+=1
        last=out_msgs[-1]
        content=str(last.get('content'))
        # latest inbound from peer?
        last_in = None
        for m in reversed(msgs):
            sid = m.get('senderAccountId') or (m.get('sender') or {}).get('accountId')
            if sid and sid != MY:
                last_in = str(m.get('content')); break
        print(str(peer)+": "+str(len(out_msgs))+" my msgs; last_in="+str(bool(last_in)))
        if last_in:
            print("    INBOUND: "+last_in[:120])
    else:
        print(str(peer)+": NO messages from me")
print('channels where I have sent >=1 msg:', count)
