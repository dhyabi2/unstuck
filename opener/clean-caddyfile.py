#!/usr/bin/env python3
"""
Generate clean Caddyfile for 172-86-112-140.sslip.io.
Preserves non-Unstuck sections from the input; inserts clean Unstuck blocks before the catch-all handle.
"""
import re, sys

with open(sys.argv[1]) as f:
    content = f.read()

lines = content.split('\n')

# Track brace depth to skip Unstuck-related blocks
REMOVE_STARTS = [
    '# Unstuck', '# Default catch-all',
    'handle_path /unstuck/',
    'handle /.well-known/', 'handle_path /.well-known/',
]

def should_skip(line):
    s = line.strip()
    return any(s.startswith(p) for p in REMOVE_STARTS)

def skip_one_block(lines, start_idx):
    """Skip from start_idx until the matching closing brace. Returns the next index."""
    i = start_idx
    depth = 0
    # The opening line itself counts its braces
    depth = lines[i].count('{') - lines[i].count('}')
    i += 1
    while i < len(lines) and depth > 0:
        depth += lines[i].count('{') - lines[i].count('}')
        i += 1
    return i

# Generate output by keeping non-Unstuck blocks
out = []
i = 0
in_removed_block = False
while i < len(lines):
    line = lines[i]
    if not in_removed_block:
        if should_skip(line):
            i = skip_one_block(lines, i)
            continue
        out.append(line)
        i += 1
    else:
        i += 1

# Find the last `handle {` block and insert Unstuck blocks before it
# Actually, simpler: append our blocks and the catch-all at the right spot
# Find where the catch-all handle block starts
insert_idx = None
for i in range(len(out)):
    if re.match(r'^\thandle \{', out[i]) and 'x-oauth' not in out[i]:
        insert_idx = i
        break

# The clean Unstuck block
unstuck_blocks = [
    '',
    '\t# Unstuck \xe2\x80\x94 .well-known agent discovery',
    '\thandle /.well-known/x402 {',
    '\t\treverse_proxy 127.0.0.1:4310',
    '\t}',
    '\thandle /.well-known/agent.json {',
    '\t\treverse_proxy 127.0.0.1:4310',
    '\t}',
    '',
    '\t# Unstuck \xe2\x80\x94 SPA frontend',
    '\thandle_path /unstuck/* {',
    '\t\troot * /var/www/unstuck',
    '\t\theader Cache-Control "no-cache, must-revalidate"',
    '\t\ttry_files {path} /index.html',
    '\t\tfile_server',
    '\t}',
    '',
    '\t# Unstuck \xe2\x80\x94 API reverse proxy',
    '\thandle_path /unstuck/api/* {',
    '\t\turi strip_prefix /unstuck/api',
    '\t\treverse_proxy 127.0.0.1:4310',
    '\t}',
    '',
    '\t# Unstuck \xe2\x80\x94 Bridge proxy (Nano x402 conversion)',
    '\thandle_path /unstuck/bridge/* {',
    '\t\turi strip_prefix /unstuck/bridge',
    '\t\treverse_proxy 127.0.0.1:3402',
    '\t}',
    '',
]

if insert_idx is not None:
    out[insert_idx:insert_idx] = unstuck_blocks

sys.stdout.write('\n'.join(out) + '\n')