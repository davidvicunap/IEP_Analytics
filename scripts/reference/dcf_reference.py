"""Independent reference for src/lib/dcf.ts (the "hoja de referencia" in PRODUCT_PLAN.md, block 1e).

Same model, different implementation: 50-digit decimal arithmetic instead of floats, and the
secant method instead of bisection for the implied growth. Reads the inputs fixture and writes
the expected values next to it:

    python3 scripts/reference/dcf_reference.py src/lib/__fixtures__/dcf-inputs.json \
        > src/lib/__fixtures__/dcf-reference.json

Model: years 1-5 grow at g1, years 6-10 fade linearly to gT, terminal value at year 10 with
Gordon growth, everything discounted at r.
"""
import json
import sys
from decimal import Decimal, getcontext

getcontext().prec = 50
YEARS, HIGH = 10, 5


def equity_value(fcf0: Decimal, r: Decimal, gt: Decimal, g1: Decimal) -> Decimal:
    total = Decimal(0)
    fcf = fcf0
    for t in range(1, YEARS + 1):
        g = g1 if t <= HIGH else g1 + (gt - g1) * Decimal(t - HIGH) / Decimal(YEARS - HIGH)
        fcf = fcf * (1 + g)
        total += fcf / (1 + r) ** t
    terminal = fcf * (1 + gt) / (r - gt)
    return total + terminal / (1 + r) ** YEARS


def implied_growth(fcf0: Decimal, r: Decimal, gt: Decimal, target: Decimal) -> Decimal:
    a, b = Decimal("0.0"), Decimal("0.2")
    fa, fb = equity_value(fcf0, r, gt, a) - target, equity_value(fcf0, r, gt, b) - target
    for _ in range(100):
        if fb == fa:
            break
        c = b - fb * (b - a) / (fb - fa)
        a, fa = b, fb
        b, fb = c, equity_value(fcf0, r, gt, c) - target
        if abs(b - a) < Decimal("1e-15"):
            break
    return b


def main() -> None:
    data = json.load(open(sys.argv[1]))
    r, gt = Decimal(str(data["r"])), Decimal(str(data["gT"]))
    for case in data["cases"]:
        fcf0 = Decimal(str(case["fcf0"]))
        case["expected"] = {
            name: float(equity_value(fcf0, r, gt, Decimal(str(g1)))) for name, g1 in case["scenarios"].items()
        }
        case["expected"]["impliedGrowth"] = float(implied_growth(fcf0, r, gt, Decimal(str(case["marketCap"]))))
    json.dump(data, sys.stdout, indent=1)
    print()


if __name__ == "__main__":
    main()
