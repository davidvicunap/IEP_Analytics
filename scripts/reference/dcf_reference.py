"""Independent reference for src/lib/dcfModel.ts (the "hoja de referencia" in PRODUCT_PLAN.md, block 1e).

Same FCFF model, different implementation: 50-digit decimal arithmetic instead of floats, and
the secant method instead of bisection for the implied revenue growth. Reads the inputs fixture
and writes the expected values next to each case:

    python3 scripts/reference/dcf_reference.py inputs.json > src/lib/__fixtures__/dcf-reference.json

Per projected year: revenue grows; EBIT = revenue x margin; NOPAT = EBIT x (1 - tax);
FCFF = NOPAT + D&A - capex - change in NWC (NWC as % of the change in revenue). WACC from the
cost of equity (rf + beta x ERP) and after-tax cost of debt, weighted by market cap and debt.
Flows are discounted to mid-year or year-end; the terminal value (Gordon or EV/EBITDA exit
multiple) to the end of the last year. Equity = EV - debt + cash; per share = equity / (market cap / price).
"""
import json
import sys
from decimal import Decimal, getcontext

getcontext().prec = 50
D = lambda x: Decimal(str(x))  # noqa: E731


def wacc(base, a):
    if a.get("waccOverride") is not None:
        return D(a["waccOverride"])
    ke = D(a["rf"]) + D(a["beta"]) * D(a["erp"])
    kd = D(a["costOfDebt"]) * (1 - D(a["taxRate"]))
    debt, equity = max(D(base["debt"]), Decimal(0)), max(D(base["marketCap"]), Decimal(0))
    wd = debt / (debt + equity) if debt + equity > 0 else Decimal(0)
    return (1 - wd) * ke + wd * kd


def value(base, a, terminal, mid_year, growth=None):
    w = wacc(base, a)
    g = [D(x) for x in (growth if growth is not None else a["growth"])]
    prev = D(base["revenue0"])
    pv = Decimal(0)
    fcff = ebitda = Decimal(0)
    n = len(g)
    for k in range(n):
        rev = prev * (1 + g[k])
        ebit = rev * D(a["ebitMargin"][k])
        da = rev * D(a["daPct"][k])
        fcff = ebit * (1 - D(a["taxRate"])) + da - rev * D(a["capexPct"][k]) - (rev - prev) * D(a["nwcPct"][k])
        ebitda = ebit + da
        t = Decimal(k + 1) - (Decimal("0.5") if mid_year else 0)
        pv += fcff / (1 + w) ** t
        prev = rev
    if terminal == "gordon":
        gt = D(a["terminalGrowth"])
        tv = fcff * (1 + gt) / (w - gt)
    else:
        tv = ebitda * D(a["exitMultiple"])
    ev = pv + tv / (1 + w) ** n
    equity = ev - D(base["debt"]) + D(base["cash"])
    per_share = equity / (D(base["marketCap"]) / D(base["price"]))
    return ev, per_share, w


def implied_growth(base, a):
    n = len(a["growth"])
    price = D(base["price"])
    f = lambda g: value(base, a, a["terminal"], a["midYear"], [g] * n)[1] - price  # noqa: E731
    x0, x1 = Decimal("0.0"), Decimal("0.15")
    f0, f1 = f(x0), f(x1)
    for _ in range(100):
        if f1 == f0:
            break
        x2 = x1 - f1 * (x1 - x0) / (f1 - f0)
        x0, f0, x1, f1 = x1, f1, x2, f(x2)
        if abs(x1 - x0) < Decimal("1e-15"):
            break
    return x1


def main() -> None:
    data = json.load(open(sys.argv[1]))
    for case in data["cases"]:
        base, a = case["base"], case["assumptions"]
        exp = {}
        for terminal in ("gordon", "exit"):
            for mid in (True, False):
                ev, ps, w = value(base, a, terminal, mid)
                exp[f"{terminal}-{'mid' if mid else 'end'}"] = {"ev": float(ev), "perShare": float(ps)}
        exp["wacc"] = float(wacc(base, a))
        exp["impliedGrowth"] = float(implied_growth(base, a))
        case["expected"] = exp
    json.dump(data, sys.stdout, indent=1)
    print()


if __name__ == "__main__":
    main()
