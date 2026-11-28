#!/usr/bin/env python3
"""
构建：把 design/ 下的样式、字体、图标 sprite、公共脚本内联进每个应用，
产出可直接部署的单文件 build/sites/<app>/index.html 与 build/zip/<app>.zip。

只用 Python 标准库。用法：
    python build/build.py                 # 构建全部
    python build/build.py table-cleaner   # 只构建指定应用
    python build/build.py --serve 8765    # 构建后启动本地预览（http://127.0.0.1:8765/sites/<app>/）

应用源码（apps/<app>/index.html）里用这几种占位引用公共资源：
    <link rel="stylesheet" href="../../design/tokens.css">     内联为 <style>
    <script src="../../design/shared.js"></script>             内联为 <script>
    <!--@include ../../design/icons.html-->                     原样嵌入（图标 / 标志 sprite）
    <!--@favicon-->                                             注入当前应用的网站图标（SVG data URI）
外链（https://…）的 <link> / <script> 保持原样，不内联。
"""
import base64
import sys
import zipfile
import re
import mimetypes
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DESIGN = ROOT / "design"
APPS = ROOT / "apps"
OUT_SITES = ROOT / "build" / "sites"
OUT_ZIP = ROOT / "build" / "zip"

APPS_MANIFEST = [
    ("table-cleaner", "logo-table-cleaner", "表格清洗"),
    ("digital-maturity", "logo-digital-maturity", "数字化成熟度自评"),
    ("pmp-assistant", "logo-pmp-assistant", "PMP 助手"),
    ("coder-pitfalls", "logo-coder-pitfalls", "程序员避坑指南"),
    ("ai-agent-readiness", "logo-ai-agent-readiness", "AI Agent 落地评估"),
]
EXTRA_PAGES = [("_styleguide", "logo-toolbox", "设计系统 · 样式指南")]

LINK_RE = re.compile(r'<link\s+[^>]*href="(?P<href>(?!https?://)[^"]+\.css)"[^>]*>\s*', re.I)
SCRIPT_RE = re.compile(r'<script\s+[^>]*src="(?P<src>[^"]+)"[^>]*>\s*</script>\s*')
INCLUDE_RE = re.compile(r"<!--@include\s+(?P<path>\S+)\s*-->\s*")
CSS_URL_RE = re.compile(r'url\(\s*["\']?(?P<path>(?!data:|https?://)[^"\')]+)["\']?\s*\)')


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def data_uri(path: Path) -> str:
    mime = mimetypes.guess_type(path.name)[0] or {
        ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png"
    }.get(path.suffix.lower(), "application/octet-stream")
    return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode("ascii")


def resolve_css(css: str, base: Path) -> str:
    """把 CSS 里的相对 @import 与 url() 解析为内联内容 / data URI。"""
    def repl_import(m):
        target = (base / m.group(1)).resolve()
        return resolve_css(read(target), target.parent) if target.exists() else m.group(0)

    def repl_url(m):
        target = (base / m.group("path")).resolve()
        return f'url("{data_uri(target)}")' if target.exists() else m.group(0)

    css = re.sub(r'@import\s+url\(\s*["\']?(?!https?://)([^"\')]+)["\']?\s*\)\s*;', repl_import, css)
    return CSS_URL_RE.sub(repl_url, css)


def inline_linked_css(html: str, src_dir: Path) -> str:
    def repl(m):
        target = (src_dir / m.group("href")).resolve()
        if not target.exists():
            raise FileNotFoundError(f"找不到样式表：{m.group('href')}（在 {src_dir}）")
        media = re.search(r'media="([^"]+)"', m.group(0))
        attr = f' media="{media.group(1)}"' if media else ""
        return f"<style{attr}>\n{resolve_css(read(target), target.parent)}\n</style>\n"

    return LINK_RE.sub(repl, html)


def inline_scripts(html: str, src_dir: Path) -> str:
    def repl(m):
        src = m.group("src")
        if src.startswith("https://") or src.startswith("http://"):
            return m.group(0)
        target = (src_dir / src).resolve()
        if not target.exists():
            raise FileNotFoundError(f"找不到脚本：{src}（在 {src_dir}）")
        js = read(target)
        # 内联进 <script> 的 JS 不能包含结束标签，否则产物脚本在这里被浏览器截断。
        # 这类内容通常藏在注释或字符串里（比如“用法示例”），静默截断会让页面完全打不开。
        if "</script" in js.lower():
            raise RuntimeError(
                f"{src} 里含有 </script>，内联后脚本会被截断。"
                "把注释或字符串里的写法改掉（例如拆成 '</scr' + 'ipt>'）再构建。"
            )
        return f"<script>\n{js}\n</script>\n"

    return SCRIPT_RE.sub(repl, html)


def inline_includes(html: str, src_dir: Path) -> str:
    def repl(m):
        target = (src_dir / m.group("path")).resolve()
        if not target.exists():
            raise FileNotFoundError(f"找不到要嵌入的文件：{m.group('path')}（在 {src_dir}）")
        return read(target)

    return INCLUDE_RE.sub(repl, html)


def inject_favicon(html: str, logo_id: str) -> str:
    svg_file = DESIGN / "brand" / f"favicon-{logo_id.replace('logo-', '')}.svg"
    if not svg_file.exists():
        raise FileNotFoundError(f"找不到网站图标：{svg_file}")
    tag = f'<link rel="icon" type="image/svg+xml" href="{data_uri(svg_file)}">'
    return html.replace("<!--@favicon-->", tag, 1)


def build(app_id: str, logo_id: str, title: str) -> Path:
    src_file = (APPS if not app_id.startswith("_") else DESIGN) / app_id / "index.html"
    if not src_file.exists():
        raise FileNotFoundError(f"找不到源文件：{src_file}")
    html = read(src_file)
    html = inline_linked_css(html, src_file.parent)
    html = inline_includes(html, src_file.parent)
    html = inline_scripts(html, src_file.parent)
    html = inject_favicon(html, logo_id)

    if "@include" in html or "@favicon-->" in html:
        raise RuntimeError(f"{app_id}: 仍有未解析的占位符")

    out_dir = OUT_SITES / app_id
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / "index.html"
    out_file.write_text(html, encoding="utf-8", newline="\n")

    zip_file = None
    if not app_id.startswith("_"):
        OUT_ZIP.mkdir(parents=True, exist_ok=True)
        zip_file = OUT_ZIP / f"{app_id}.zip"
        with zipfile.ZipFile(zip_file, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.write(out_file, "index.html")
    return out_file


def serve(port: int):
    """在 build/sites 上启动本地静态预览。"""
    import http.server

    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(OUT_SITES), **kwargs)

    with http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler) as httpd:
        print(f"预览服务已启动：http://127.0.0.1:{port}/{OUT_SITES.name}/<app>/  （Ctrl+C 停止）", flush=True)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass


def main(argv):
    # Windows 控制台默认 GBK：保持原生编码，只把“无法编码的字符”替换掉，避免打印时崩溃
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(errors="replace")

    port = None
    if "--serve" in argv:
        i = argv.index("--serve")
        port = int(argv[i + 1]) if i + 1 < len(argv) else 8765
        argv = [a for a in argv if a not in ("--serve", str(port))]
    wanted = [a for a in argv if not a.startswith("-")]
    targets = [t for t in APPS_MANIFEST + EXTRA_PAGES if not wanted or t[0] in wanted]
    if wanted and len(targets) != len(wanted):
        unknown = set(wanted) - {t[0] for t in targets}
        raise SystemExit(f"未知应用：{sorted(unknown)}；可选：{[t[0] for t in APPS_MANIFEST + EXTRA_PAGES]}")
    for app_id, logo_id, title in targets:
        out = build(app_id, logo_id, title)
        zip_path = OUT_ZIP / f"{app_id}.zip"
        size = f"{out.stat().st_size / 1024:.0f} KB"
        extra = f"，zip {zip_path.stat().st_size / 1024:.0f} KB" if zip_path.exists() else ""
        print(f"[OK] {title}  ->  {out.relative_to(ROOT)}  ({size}{extra})")
    if port:
        serve(port)


if __name__ == "__main__":
    main(sys.argv[1:])
