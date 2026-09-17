#!/usr/bin/env python3
"""Remove ALL duplicate Unstuck blocks from Caddyfile, insert one clean copy before catch-all."""
import re, sys

with open(sys.argv[1]) as f:
    content = f.read()

# Strategy: simply remove every line from '# Unstuck' through the next '}'
# at depth 0. Do this iteratively until no Unstuck blocks remain.
lines = content.split('\n')

def remove_one_unstuck(lines):
    """Remove the first Unstuck block found. Returns (new_lines, removed)."""
    out = []
    i = 0
    skip = -1  # -1 = not skipping, >=0 = skipping at this depth
    
    while i < len(lines):
        line = lines[i]
        
        if skip >= 0:
            # We are inside a block to skip
            braces_open = line.count('{')
            braces_close = line.count('}')
            skip += braces_open - braces_close
            if skip == 0:
                # End of block
                skip = -1
                i += 1
                continue
            i += 1
            continue
        
        # Check if this line starts an Unstuck block
        if line.strip().startswith('# Unstuck'):
            skip = 0  # Will be incremented by the opening brace on the next line
            i += 1
            continue
        
        out.append(line)
        i += 1
    
    return out

# Remove iteratively until done
prev_len = len(lines) + 1
while len(lines) < prev_len:
    prev_len = len(lines)
    lines = remove_one_unstuck(lines)

# Now insert clean block before the catch-all handle
inserted = [
    '',
    '\t# Unstuck — SPA frontend',
    '\thandle_path /unstuck/* {',
    '\t\troot * /var/www/unstuck',
    '\t\theader Cache-Control "no-cache, must-revalidate"',
    '\t\ttry_files {path} /index.html',
    '\t\tfile_server',
    '\t}',
    '',
    '\t# Unstuck — API reverse proxy',
    '\thandle_path /unstuck/api/* {',
    '\t\turi strip_prefix /unstuck/api',
    '\t\treverse_proxy 127.0.0.1:4310',
    '\t}',
    '',
    '\t# Unstuck — Bridge proxy (Nano x402 conversion)',
    '\thandle_path /unstuck/bridge/* {',
    '\t\turi strip_prefix /unstuck/bridge',
    '\t\treverse_proxy 127.0.0.1:3402',
    '\t}',
    '',
]

for idx, line in enumerate(lines):
    if re.match(r'^\thandle \{', line) and 'x-oauth' not in lines[idx]:
        lines[idx:idx] = inserted
        break

sys.stdout.write('\n'.join(lines))