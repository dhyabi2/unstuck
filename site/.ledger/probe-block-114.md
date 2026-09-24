# Probe — Block 114 (L69-L72)

One end-to-end scenario that must exercise every law through a DIFFERENT component,
so no evidence is reused between two laws.

Scenario: a stranger's machine, with nothing from this repository on it.

1. Fetch https://getunstuck.space/llms.txt and read only what it says.             -> L70
   The document must name the artifact as a full https URL on the canonical origin,
   give both invocations, and state the limits (holds no funds, sends nothing,
   cannot open an account).

2. Fetch the URL the document named, into an empty directory.                       -> L69
   One file, nothing else. Its sha256 must equal the committed site copy, which must
   equal the committed source in opener/. Its requires must all be node builtins.

3. Run `node nano-onramp-check.js --self-test` with the network unplugged.          -> L69
   Hermetic: no fetch, no socket. It must mint an address, verify its own checksum,
   reject a tampered address and break the seal on a wrong onboard_id, and exit 0
   only because all three controls held.

4. Run `node nano-onramp-check.js` — the live invocation the document gives.        -> L72
   It must reach the LAST step, prove the asker equality, and report which scratch
   engine served it. A MODULE_NOT_FOUND here is the defect L72 exists for.

5. Watch the process for writes to the public network.                             -> L71
   ask_target must name the local scratch server, the target must not be the public
   origin, and the default must not have posted anywhere outside 127.0.0.1.

6. Re-run the same file inside a checkout of the repository.                        -> L72
   scratch_engine must now name the repository server, so the strong run and the
   weak run can never be confused for each other.

Every law is proven by a different step, and steps 4 and 6 use the same program under
two different conditions, which is what makes them independent evidence.
