# -*- coding: utf-8 -*-
"""
重新生成 assets/fonts/LXGWWenKaiGBScreen-Subset.woff2（霞鹜文楷 GB 屏读版子集）。

用途：界面文案变更后（新增了楷体渲染的汉字），跑一次本脚本即可更新子集，
保证 webfont 覆盖所有实际用字。许可与来源见 assets/fonts/CREDITS.md。

依赖：Python 3.9+，pip install fonttools brotli
用法：python tools/build-font-subset.py
"""
import pathlib
import subprocess
import sys
import tempfile
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
TTF_URL = ("https://github.com/lxgw/LxgwWenKai-Screen/releases/"
           "download/v1.522/LXGWWenKaiGBScreen.ttf")
OUT = ROOT / "assets" / "fonts" / "LXGWWenKaiGBScreen-Subset.woff2"
# 额外保留的 ASCII/常用符号区段（数字、字母、约等号、摄氏度等）
EXTRA_UNICODS = ("U+0020-007E,U+00B0,U+00B7,U+2013-2015,U+2018-201D,"
                 "U+2026,U+2103,U+2248")
# 常用中文标点（不含 CJK 统一表意区已覆盖的部分）
PUNCT = ("\uff0c\u3002\uff01\uff1f\uff1a\uff1b\u00b7\u300c\u300d\u300e\u300f"
         "\uff08\uff09\u300a\u300b\u2014\u2026\u3001\uff05\u201c\u201d"
         "\u2018\u2019\u2248\u2103")


def extract_used_chars() -> str:
    """从 H5 源码（html + js）提取实际渲染的中文字符与常用中文标点。"""
    chars = set()
    files = [ROOT / "index.html"] + sorted((ROOT / "js").glob("*.js"))
    for f in files:
        for ch in f.read_text(encoding="utf-8"):
            o = ord(ch)
            if 0x4E00 <= o <= 0x9FFF or 0x3400 <= o <= 0x4DBF:
                chars.add(ch)
            elif ch in PUNCT:
                chars.add(ch)
    return "".join(sorted(chars))


def main() -> None:
    text_file = ROOT / "tools" / "font-chars.txt"
    chars = extract_used_chars()
    text_file.write_text(chars, encoding="utf-8")
    print(f"用字字符集：{len(chars)} 个字符")

    tmp = pathlib.Path(tempfile.gettempdir()) / "LXGWWenKaiGBScreen.ttf"
    if not tmp.exists():
        print("下载上游 TTF（约 24MB）…")
        urllib.request.urlretrieve(TTF_URL, tmp)

    subprocess.run([
        sys.executable, "-m", "fontTools.subset", str(tmp),
        f"--text-file={text_file}", f"--unicodes={EXTRA_UNICODS}",
        "--flavor=woff2", "--layout-features=*", "--no-hinting",
        f"--output-file={OUT}",
    ], check=True)
    print(f"完成：{OUT}（{OUT.stat().st_size / 1024:.0f} KB）")


if __name__ == "__main__":
    main()
