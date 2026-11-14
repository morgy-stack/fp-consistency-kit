# Canvas / Audio consistency report: <browser under test>

## Setup

| | Baseline | Candidate |
|---|---|---|
| Browser + version | | |
| Chromium base revision | | |
| Device / OS | | |
| Kit commit | | |

Each browser was run 3 times. Results were stable across runs unless noted.

## Results

<!-- paste the output of: python3 compare.py baseline.json candidate.json -->

## Findings

For each flagged check:

### <ID>: <one-line description>

- **Observed:** what the candidate returned, compared with the baseline
- **Invariant broken:** which consistency property fails
- **Code path:** the source file(s) and function(s) responsible, with links
  to the exact revision
- **Evidence:** a minimal reproduction (a single test page or snippet),
  logs, or a debugger trace showing where the value changes
- **Classification:** intended privacy behaviour, inconsistent API output,
  or implementation defect
- **Fix options:** what change would restore consistency, and the trade-off

## Summary

| Finding | Classification | Suggested fix | Effort |
|---------|----------------|---------------|--------|
