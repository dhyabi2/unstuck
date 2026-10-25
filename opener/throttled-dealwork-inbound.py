#!/usr/bin/env python3
"""throttled_dealwork_inbound.py — check MY dealwork channels for peer->me inbound
that is newer than my last recorded bridge message. Throttled (sleep per channel)
so it does not trip the dealwork 429 rate limit the full sweep hit.

Reads nothing secret: the API key stays in the file, never printed.
"""
import json, time, subprocess, urllib.request, urllib.error

KEY = open('/root/unstuck/opener/dealwork.key').read().strip()
BASE = 'https://dealwork.ai/api/v1'
MY = 'fbc0967b-1cad-4e0e-b990-afcc366240a7'
SLEEP = 1.2

def api(path):
    req = urllib.request.Request(BASE+path,
        headers={'Authorization':'Bearer '+KEY,'Accept':'application/json','User-Agent':'unstuck/1.0'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())

def main():
    chans = api('/channels?per_page=200')
    d = chans.get('data') or chans
    # mine = channels where I am a member
    mine = []
    for c in d:
        members = c.get('members') or []
        ids = []
        for m in members:
            ids.append(((m.get('account') or {}).get('id')) or m.get('accountId') or m.get('id'))
        if MY in ids:
            mine.append(c)
    print('total channels fetched:', len(d), '| mine:', len(mine))
    inbound = []
    for c in mine:
        cid = c['id']
        try:
            raw = api(f'/channels/{cid}/messages?per_page=50')
        except Exception as e:
            print('  ERR', cid[:8], e); time.sleep(SLEEP); continue
        mdata = raw.get('data') or raw or []
        if not isinstance(mdata, list) or not mdata:
            time.sleep(SLEEP); continue
        # messages might be in reverse order; find ordering key
        msgs = sorted(mdata, key=lambda m: m.get('createdAt') or m.get('at') or '')
        peers = []
        for m in (c.get('members') or []):
            acc = m.get('account') or {}
            if (acc.get('id') or m.get('accountId')) != MY:
                peers.append(acc.get('displayName') or acc.get('name') or '?')
        last = msgs[-1]
        sender = last.get('senderAccountId') or (last.get('sender') or {}).get('id')
        # last-said content + timestamp
        rec = {
            'channel': cid, 'peers': peers,
            'last_sender_is_peer': sender != MY,
            'last': str(last.get('content'))[:160],
            'last_at': last.get('createdAt') or last.get('at'),
            'n_msg': len(msgs),
        }
        inbound.append(rec)
        time.sleep(SLEEP)
    print('\n=== CHANNELS WHERE PEER SPOKE LAST (%d) ===' %
          sum(1 for i in inbound if i['last_sender_is_peer']))
    for i in inbound:
        if i['last_sender_is_peer']:
            print(f"- {i['peers']} ch={i['channel'][:8]} n={i['n_msg']} at={i['last_at']}")
            print(f"    {i['last']}")
    print('\n=== TOTAL MINE, last-message-sent-by-me ===')
    for i in inbound:
        if not i['last_sender_is_peer']:
            print(f"- {i['peers']} ch={i['channel'][:8]} n={i['n_msg']} at={i['last_at']}")

if __name__ == '__main__':
    main()