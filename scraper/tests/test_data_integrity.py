"""
Integration test: data drift must not regress vs baseline.

The actual computation lives in scraper/validate_data_integrity.py. This test
just runs it in "compare" mode and asserts no regressions.

When you intentionally refine the parser (improving accuracy is great), refresh
the baseline:

    python3 scraper/validate_data_integrity.py --update-baseline

Then commit scraper/validation_baseline.json with the change.
"""

import sys
from pathlib import Path

# Allow importing the validator module
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from validate_data_integrity import (
    compute_drift,
    load_baseline,
    compare_against_baseline,
)


def test_no_data_drift_regressions():
    baseline = load_baseline()
    assert baseline is not None, (
        "scraper/validation_baseline.json missing. "
        "Run `python3 scraper/validate_data_integrity.py --update-baseline` to create it."
    )

    program_drift, course_drift = compute_drift()
    regressions = compare_against_baseline(program_drift, course_drift, baseline)

    if regressions:
        msg = f"{len(regressions)} data-drift regression(s) detected:\n"
        for r in regressions[:10]:
            msg += f"  • {r}\n"
        if len(regressions) > 10:
            msg += f"  ... and {len(regressions) - 10} more\n"
        msg += (
            "\nIf these are intentional improvements, refresh the baseline:\n"
            "    python3 scraper/validate_data_integrity.py --update-baseline"
        )
        raise AssertionError(msg)
