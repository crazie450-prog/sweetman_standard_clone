# Staging run, 13 November 2026

Direct application test (`adapters/nexus-app/run_app_test.py`, package commit `d35d83f`) against the team's staging
API, test organization "Test org". 130 open documents x 3 runs = 390 uploads. Staging has no version endpoint, so
the application commit is not known.

- `score.txt`: output of `nexus_test.py score`. `score-details.txt`: every wrong line.
- `results.tar.gz`: the 390 result files (re-score with `nexus_test.py score <folder>`).

Result: FAIL. Line accuracy 58.02% (95% interval 45.0-69.6), 798 unflagged errors, 84 failed jobs, 0 of 24 choice lines flagged (scored with the final rules of 14 November: peer-reviewed keys and the choice-line check; first scoring on 13 November: 58.15%, 802).
