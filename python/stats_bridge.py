#!/usr/bin/env python3
"""
PATIENT ZERO — Stats Bridge
Provides scipy/numpy statistical functions callable from Node.js via child_process.

Usage:
  python stats_bridge.py binomial_test  '{"n_successes":5,"n_trials":20,"p_null":0.1}'
  python stats_bridge.py bayes_shrinkage '{"observations":[1,2,5,10,20],"k":3}'
  python stats_bridge.py normalize       '{"values":[0.1,0.5,0.9,0.3,0.7]}'
  python stats_bridge.py --test

Output: JSON string to stdout
Errors: JSON {"error":"..."} to stdout (never raise to stderr)
"""

import sys
import json

try:
    import numpy as np
    from scipy import stats as scipy_stats
    SCIPY_AVAILABLE = True
except ImportError:
    SCIPY_AVAILABLE = False


def binomial_test(n_successes: int, n_trials: int, p_null: float) -> dict:
    """
    Test whether observed successes significantly exceed chance.
    Returns p-value from a one-sided binomial test (observed > expected).
    """
    if not SCIPY_AVAILABLE:
        # Fallback: normal approximation
        if n_trials == 0:
            return {"p_value": 1.0, "significant": False}
        expected = n_trials * p_null
        variance = n_trials * p_null * (1 - p_null)
        std = max(variance ** 0.5, 1e-9)
        z = (n_successes - expected) / std
        # Approximate p-value for one-sided test
        import math
        p = 0.5 * (1 + math.erf(-abs(z) / (2 ** 0.5)))
        return {"p_value": float(p), "significant": p < 0.05, "method": "normal_approx"}

    # Exact binomial test (one-sided: observed > expected under null)
    result = scipy_stats.binomtest(
        int(n_successes),
        int(n_trials),
        float(p_null),
        alternative='greater'
    )
    p_value = float(result.pvalue)
    return {
        "p_value": p_value,
        "significant": p_value < 0.05,
        "method": "exact_binomial"
    }


def bayes_shrinkage(observations: list, k: int = 3) -> dict:
    """
    Compute empirical Bayes shrinkage weights.
    shrinkage[i] = n_i / (n_i + k)
    Higher n → trust observed pattern more. Lower n → shrink toward population mean.
    """
    obs = np.array(observations, dtype=float) if SCIPY_AVAILABLE else observations
    weights = []
    for n in obs:
        w = float(n) / (float(n) + float(k))
        weights.append(round(w, 6))
    return {"shrinkage_weights": weights, "k": k}


def normalize(values: list) -> dict:
    """
    Min-max normalize a list of numbers to [0, 1].
    """
    if not values:
        return {"normalized": []}

    if SCIPY_AVAILABLE:
        arr = np.array(values, dtype=float)
        mn, mx = float(arr.min()), float(arr.max())
    else:
        mn, mx = min(values), max(values)

    rng = mx - mn
    if rng == 0:
        normalized = [0.5] * len(values)
    else:
        normalized = [round((v - mn) / rng, 6) for v in values]

    return {"normalized": normalized, "min": mn, "max": mx}


def run_tests() -> None:
    """Run self-tests and print results."""
    print("=== PATIENT ZERO Stats Bridge Self-Test ===")

    # Test 1: binomial_test — clearly significant
    r1 = binomial_test(18, 20, 0.1)
    assert r1["significant"] is True, f"Test 1 failed: {r1}"
    print(f"✓ binomial_test (significant): p={r1['p_value']:.6f}")

    # Test 2: binomial_test — not significant
    r2 = binomial_test(2, 20, 0.1)
    assert r2["significant"] is False, f"Test 2 failed: {r2}"
    print(f"✓ binomial_test (not significant): p={r2['p_value']:.6f}")

    # Test 3: bayes_shrinkage
    r3 = bayes_shrinkage([1, 3, 10, 50], k=3)
    weights = r3["shrinkage_weights"]
    assert weights[0] < weights[1] < weights[2] < weights[3], f"Test 3 failed: {weights}"
    print(f"✓ bayes_shrinkage: {weights}")

    # Test 4: normalize
    r4 = normalize([0, 5, 10, 2.5])
    norms = r4["normalized"]
    assert norms[0] == 0.0 and norms[2] == 1.0, f"Test 4 failed: {norms}"
    print(f"✓ normalize: {norms}")

    print("=== All tests passed ===")


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: stats_bridge.py <command> <json_args>"}))
        sys.exit(1)

    command = sys.argv[1]

    if command == "--test":
        run_tests()
        return

    if len(sys.argv) < 3:
        print(json.dumps({"error": f"Command '{command}' requires JSON args as second argument"}))
        sys.exit(1)

    try:
        args = json.loads(sys.argv[2])
    except json.JSONDecodeError as e:
        print(json.dumps({"error": f"Invalid JSON args: {e}"}))
        sys.exit(1)

    try:
        if command == "binomial_test":
            result = binomial_test(
                args["n_successes"],
                args["n_trials"],
                args["p_null"]
            )
        elif command == "bayes_shrinkage":
            result = bayes_shrinkage(
                args["observations"],
                args.get("k", 3)
            )
        elif command == "normalize":
            result = normalize(args["values"])
        else:
            result = {"error": f"Unknown command: {command}"}

        print(json.dumps(result))

    except KeyError as e:
        print(json.dumps({"error": f"Missing argument: {e}"}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))


if __name__ == "__main__":
    main()
