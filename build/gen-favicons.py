#!/usr/bin/env python3
"""
从 design/brand/logos.html 的标志 sprite 导出独立的 SVG 网站图标到 design/brand/favicon-<id>.svg。
改过 logos.html 之后运行一次：python build/gen-favicons.py
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOGOS = ROOT / "design" / "brand" / "logos.html"

# id -> (强调色, 强调色上的前景色)
ACCENTS = {
    "toolbox": ("#1b1f27", None),          # 系列标志：石墨色单色
    "table-cleaner": ("#0f766e", "#ffffff"),
    "digital-maturity": ("#2e7d46", "#ffffff"),
    "pmp-assistant": ("#1f5fae", "#ffffff"),
    "coder-pitfalls": ("#c2410c", "#ffffff"),
}


def main():
    html = LOGOS.read_text(encoding="utf-8")
    count = 0
    for m in re.finditer(r'<symbol id="logo-([\w-]+)" viewBox="([^"]+)">(.*?)</symbol>', html, re.S):
        logo_id, viewbox, inner = m.group(1), m.group(2), m.group(3)
        accent, on_accent = ACCENTS[logo_id]
        out = re.sub(r'var\(--accent,\s*#?\w+\)', accent, inner)
        out = out.replace("var(--on-accent, #fff)", on_accent or "#ffffff")
        if logo_id == "toolbox":
            out = out.replace("currentColor", accent)
        if "var(" in out:
            raise SystemExit(f"{logo_id}: 仍有未替换的变量")
        svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{viewbox}">{out.strip()}</svg>\n'
        (ROOT / "design" / "brand" / f"favicon-{logo_id}.svg").write_text(svg, encoding="utf-8", newline="\n")
        count += 1
    print(f"已导出 {count} 个网站图标到 design/brand/")


if __name__ == "__main__":
    main()
