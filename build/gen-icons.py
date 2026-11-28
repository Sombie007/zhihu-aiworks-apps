#!/usr/bin/env python3
"""
生成 design/icons.html：从 Heroicons 24 outline 源文件提取图标，做成统一的 sprite。

首次使用或要更新图标时：
    cd design/_vendor && npm pack heroicons@2.2.0 --registry=https://registry.npmmirror.com
    tar -xzf heroicons-2.2.0.tgz          # 解压出 package/
    python build/gen-icons.py             # 重新生成 design/icons.html
要增减图标，改下面的 NAMES。
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "design" / "_vendor" / "package" / "24" / "outline"
OUT = ROOT / "design" / "icons.html"

# 注意：故意不收录 sparkles、star 类装饰性图标——星芒是 AI 生成界面的标志性装饰。
NAMES = """academic-cap adjustments-horizontal arrow-down-tray arrow-down arrow-left arrow-long-right arrow-path arrow-right arrow-top-right-on-square
arrow-trending-down arrow-trending-up arrow-up-tray arrow-up arrow-uturn-left arrow-uturn-right arrows-right-left backspace banknotes bars-3 bold
book-open bookmark bug-ant building-library building-office-2 calculator calendar-days chart-bar chart-bar-square chart-pie check check-badge check-circle
chevron-double-down chevron-double-left chevron-double-right chevron-double-up chevron-down chevron-left chevron-right chevron-up chevron-up-down circle-stack
clipboard-document clipboard-document-check clipboard-document-list clock cloud-arrow-up code-bracket code-bracket-square cog-6-tooth command-line cpu-chip
document document-arrow-down document-check document-duplicate document-text ellipsis-horizontal envelope equals exclamation-circle exclamation-triangle
eye eye-slash face-frown flag folder-open forward funnel globe-alt hand-raised hashtag information-circle italic key language lifebuoy light-bulb link
list-bullet lock-closed lock-open magnifying-glass map megaphone minus minus-circle moon no-symbol numbered-list paper-clip pause pencil-square play plus plus-circle
presentation-chart-bar presentation-chart-line printer puzzle-piece question-mark-circle queue-list radio receipt-percent rocket-launch scale scissors server share shield-check shield-exclamation
signal square-2-stack squares-2x2 star stop-circle strikethrough sun swatch table-cells tag trash trophy underline user-circle user-group users variable
view-columns viewfinder-circle wallet wifi wrench wrench-screwdriver x-circle x-mark""".split()


def main():
    parts, missing = [], []
    for name in NAMES:
        path = SRC / f"{name}.svg"
        if not path.exists():
            missing.append(name)
            continue
        svg = path.read_text(encoding="utf-8")
        inner = re.search(r"<svg[^>]*>(.*?)</svg>", svg, re.S).group(1).strip()
        # 只保留几何元素。描边粗细、颜色由外层 .icon 统一继承，保证全站一致。
        inner = re.sub(r'\s(stroke|fill|stroke-width|stroke-linecap|stroke-linejoin|aria-hidden|data-slot)="[^"]*"', "", inner)
        parts.append(f'<symbol id="i-{name}" viewBox="0 0 24 24">{inner}</symbol>')
    if missing:
        raise SystemExit(f"找不到这些图标：{missing}")
    html = (
        "<!-- Heroicons 24 outline v2.2.0 (MIT, Tailwind Labs) — 统一 1.5px 描边；"
        '用法: <svg class="icon" aria-hidden="true"><use href="#i-name"/></svg> -->\n'
        '<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true" focusable="false">\n'
        + "\n".join(parts)
        + "\n</svg>\n"
    )
    OUT.write_text(html, encoding="utf-8", newline="\n")
    print(f"已生成 {len(parts)} 个图标 -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
