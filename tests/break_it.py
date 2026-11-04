#!/usr/bin/env python3
"""Break the page on purpose and see whether the tests notice.

    python tests/break_it.py [FOLDER] [--work NEW_FOLDER] [--jobs 3] [--only id,id]

Each bug below is a mistake somebody could really make while editing the page. It is applied alone to a throwaway copy of FOLDER (under NEW_FOLDER, which must not
exist yet and is left in place), the tests run on the copy, and the table says CAUGHT (with the checks that failed) or MISSED. Nothing in FOLDER is touched.
Needs node and Google Chrome for the browser checks (the run stops with a message if they are missing).
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent

# (id, what a visitor or maintainer cares about, the mistake, file, text to find, text to put in its place)
BUGS = [
    ("theme-not-applied", "theme", "the switch no longer turns the page dark", "index.html",
     "if (dark) root.setAttribute('data-theme', 'dark'); else root.removeAttribute('data-theme');", "root.removeAttribute('data-theme');"),
    ("theme-not-kept", "theme", "the choice is not saved", "index.html", "try { localStorage.setItem('theme', dark ? 'dark' : 'light'); } catch (err) {}", ""),
    ("theme-ignored-on-load", "theme", "a saved dark choice is not read when the page opens", "index.html", "localStorage.getItem('theme')==='dark'", "localStorage.getItem('theme')==='darkmode'"),
    ("dark-text-unreadable", "readable", "dark theme text colour set to the background", "index.html", "--ground:#0e1625;--fg:#e9eef6;--fg2:#93a0b6;--fg3:#b9c4d6;", "--ground:#0e1625;--fg:#1d2a44;--fg2:#93a0b6;--fg3:#b9c4d6;"),
    ("light-text-pale", "readable", "a restyle makes the grey text too pale", "index.html", "--fg2:#566377;", "--fg2:#b4bcc8;"),
    ("puzzle-bound", "puzzle", "the try box lets row 41 through", "index.html", "if (n > 40) {\n      msgOut.textContent", "if (n > 41) {\n      msgOut.textContent"),
    ("puzzle-crash-row", "puzzle", "the try box moves the crash from row 0 to row 1", "index.html", "if (n === 0) {\n      msgOut.textContent", "if (n === 1) {\n      msgOut.textContent"),
    ("puzzle-case", "puzzle", "the try box ignores letter case in the A7 check", "index.html", "if (text.slice(0, 2) !== 'A7') {", "if (text.slice(0, 2).toUpperCase() !== 'A7') {"),
    ("scene-bound", "scenes", "a scene's model of the program lets row 41 through", "index.html", "if (n > 40) return { stop: 'bound'", "if (n > 41) return { stop: 'bound'"),
    ("show-me-wrong", "puzzle", "Show me offers an input that does not crash", "index.html", "input.value = 'A700';\n    var outcomeName = run('A700');", "input.value = 'A712';\n    var outcomeName = run('A712');"),
    ("language-view", "puzzle", "choosing a language leaves the old program on screen", "index.html", "codeView.innerHTML = TARGETS[id].code;", ""),
    ("language-pressed", "puzzle", "every language button shows as chosen", "index.html", "b.setAttribute('aria-pressed', String(b.getAttribute('data-target') === id));", "b.setAttribute('aria-pressed', 'true');"),
    ("tab-wrong-scene", "scenes", "every tab opens the first scene", "index.html", "label.setAttribute('for', 'tab-' + techId);", "label.setAttribute('for', 'tab-symbolic');"),
    ("scene-never-ends", "scenes", "a scene's loop forgets to advance", "index.html", "for (var k = 0; k < inputs.length; k++) {", "for (var k = 0; k < inputs.length; ) {"),
    ("scene-last-note", "scenes", "a scene stops before its closing sentence", "index.html", "setNote(fig, 'A700 reaches the last line and it crashes.');", ""),
    ("replay-dead", "scenes", "Play again does nothing", "index.html", "    stopState(st);\n    st.done = false;\n    startState(st);\n  });", "  });"),
    ("reduced-motion", "scenes", "the reduced-motion setting is looked up wrongly", "index.html", "'(prefers-reduced-motion: reduce)'", "'(prefers-reduced-motion: no-preference)'"),
    ("no-script-hidden", "no script", "scenes are hidden even when no script runs", "index.html", ".js .tech{display:none}", ".tech{display:none}"),
    ("card-too-wide", "fits", "a card gets a minimum width wider than a phone", "index.html", ".viz{margin:0;min-width:0", ".viz{margin:0;min-width:620px"),
    ("logo-path", "files", "the logo path has a typo", "index.html", '<img src="logo.png"', '<img src="logos.png"'),
    ("font-path", "files", "a font file is renamed", "index.html", 'url("fonts/funnel-display-latin.woff2")', 'url("fonts/funnel-display.woff2")'),
    ("anchor-typo", "files", "the link to the techniques points at a missing section", "index.html", 'href="#answers-h"', 'href="#answer-h"'),
    ("third-party-font", "private", "a web font from another site is added", "index.html", '<link rel="icon" type="image/png" href="logo.png">', '<link rel="icon" type="image/png" href="logo.png"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">'),
    ("link-no-noopener", "private", "an outbound link loses rel=noopener", "index.html", '<a href="https://arxiv.org/abs/2608.06397" rel="noopener">', '<a href="https://arxiv.org/abs/2608.06397">'),
    ("toggle-unnamed", "reader", "the theme button loses its name", "index.html", 'data-theme-toggle aria-label="Switch between light and dark"', "data-theme-toggle"),
    ("second-h1", "reader", "a section heading becomes a second main heading", "index.html", '<h2 id="answers-h">The techniques</h2>', '<h1 id="answers-h">The techniques</h1>'),
    ("no-viewport", "reader", "the viewport tag is removed", "index.html", None, None),
]


def apply(text: str, old, new) -> str:
    if old is None:      # remove the viewport meta tag
        out = re.sub(r'<meta name="viewport"[^>]*>', "", text, count=1)
        assert out != text
        return out
    assert text.count(old) >= 1, f"not found: {old[:60]}"
    return text.replace(old, new, 1)


def run_one(bug, source: Path, work: Path, slot: int):
    bid, area, what, fname, old, new = bug
    d = work / bid
    shutil.copytree(source, d, ignore=shutil.ignore_patterns("tests", ".git", "__pycache__", ".chrome-profile"))
    shutil.copytree(HERE, d / "tests", ignore=shutil.ignore_patterns("__pycache__"))
    f = d / fname
    f.write_text(apply(f.read_text(encoding="utf-8"), old, new), encoding="utf-8")
    r = subprocess.run([sys.executable, str(d / "tests/run.py"), str(d)], capture_output=True, text=True, timeout=400, env={**os.environ, "PORT_OFFSET": str(slot * 5)})
    out = r.stdout + r.stderr
    failed = [m.group(1).strip()[:70] for m in re.finditer(r"^FAIL (?:the )?(.*)$", out, re.M)] + [m.group(1) for m in re.finditer(r"^FAIL: (test_\w+)", out, re.M)]
    return bid, area, what, r.returncode != 0, sorted(set(failed))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("folder", nargs="?", default=str(HERE.parent))
    ap.add_argument("--work")
    ap.add_argument("--jobs", type=int, default=3)
    ap.add_argument("--only", default="")
    a = ap.parse_args(argv)
    if not shutil.which("node") or not Path(os.environ.get("CHROME", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")).is_file():
        sys.exit("break_it needs node and Google Chrome (set CHROME to the browser binary)")
    source = Path(a.folder).resolve()
    work = Path(a.work) if a.work else Path(tempfile.mkdtemp(prefix="break-it-"))
    if work.exists() and any(work.iterdir()):
        sys.exit(f"{work} is not empty; give a new folder")
    work.mkdir(parents=True, exist_ok=True)
    bugs = [b for b in BUGS if not a.only or b[0] in a.only.split(",")]
    for b in bugs:      # every bug must apply to the page as it is, or the table would be wrong
        apply((source / b[3]).read_text(encoding="utf-8"), b[4], b[5])
    base = subprocess.run([sys.executable, str(HERE / "run.py"), str(source)], capture_output=True, text=True, timeout=400)
    if base.returncode != 0:
        sys.exit("the tests fail on the unbroken page, so the table would mean nothing:\n" + base.stdout[-1500:] + base.stderr[-500:])
    rows = []
    with cf.ThreadPoolExecutor(a.jobs) as ex:
        futs = [ex.submit(run_one, b, source, work, i % a.jobs) for i, b in enumerate(bugs)]
        for f in futs:
            rows.append(f.result())
    caught_by: dict[str, int] = {}
    print(f"{'bug':22s} {'about':10s} result  caught by")
    for bid, area, what, caught, failed in rows:
        print(f"{bid:22s} {area:10s} {'CAUGHT' if caught else 'MISSED':7s} {'; '.join(failed) if failed else ''}")
        for t in failed:
            caught_by[t] = caught_by.get(t, 0) + 1
    n = sum(1 for r in rows if r[3])
    print(f"\n{n} of {len(rows)} bugs caught, {len(rows) - n} missed.  Copies are in {work}")
    if caught_by:
        print("checks that caught something:", len(caught_by))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
