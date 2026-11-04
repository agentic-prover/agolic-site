#!/usr/bin/env python3
"""Tests of the Agolic page.  Standard library only.

    python tests/run.py [FOLDER] [--no-browser]

FOLDER holds index.html and the files it uses (default: the folder above this one). The file checks run in a second. The browser checks need node
and Google Chrome (set CHROME to the browser binary if it is elsewhere) and take about a minute; without them they are skipped and the run says so.
Exit status 0 when everything that ran passed.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import unittest
import urllib.parse
from html.parser import HTMLParser
from pathlib import Path

HERE = Path(__file__).resolve().parent
FOLDER = Path(".")


class Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.refs, self.ids, self.h1, self.title, self.lang = [], [], 0, "", ""
        self.meta, self.buttons, self.inputs, self.labels_for, self.img_no_alt = {}, [], [], set(), 0
        self.labelledby, self.externals = [], []
        self._t = self._b = False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if "id" in a:
            self.ids.append(a["id"])
        if tag == "html":
            self.lang = a.get("lang", "")
        elif tag == "title":
            self._t = True
        elif tag == "h1":
            self.h1 += 1
        elif tag == "meta" and a.get("name"):
            self.meta[a["name"]] = a.get("content", "")
        elif tag == "label" and a.get("for"):
            self.labels_for.add(a["for"])
        elif tag == "img" and "alt" not in a:
            self.img_no_alt += 1
        if "aria-labelledby" in a:
            self.labelledby.extend(a["aria-labelledby"].split())
        for k in ("href", "src"):
            if a.get(k) is not None and tag in ("a", "link", "script", "img", "source"):
                self.refs.append((tag, a[k], a.get("rel", "")))
        if tag == "button":
            self._b = True
            self.buttons.append([a, ""])
        if tag == "input" and a.get("type", "text") not in ("hidden", "radio", "checkbox"):
            self.inputs.append(a)

    def handle_endtag(self, tag):
        if tag == "title":
            self._t = False
        if tag == "button":
            self._b = False

    def handle_data(self, d):
        if self._t:
            self.title += d
        if self._b:
            self.buttons[-1][1] += d


def external(u: str) -> bool:
    return bool(re.match(r"^(?:[a-z][a-z0-9+.-]*:|//)", u, re.I))


class FileChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = (FOLDER / "index.html").read_text(encoding="utf-8")
        cls.page = Page()
        cls.page.feed(cls.text)

    def test_every_file_and_section_the_page_points_to_exists(self):
        """Logo, icon, fonts, and every #link to a part of the page."""
        problems = []
        for tag, url, rel in self.page.refs:
            if external(url):
                continue
            u = urllib.parse.urlsplit(url)
            if u.path and not (FOLDER / urllib.parse.unquote(u.path)).is_file():
                problems.append(url)
            if not u.path and u.fragment and u.fragment not in self.page.ids:
                problems.append("#" + u.fragment)
        for ref in re.findall(r"url\(([^)]+)\)", self.text):
            ref = ref.strip("'\"")
            if not ref.startswith(("data:", "#")) and not external(ref) and not (FOLDER / ref.split("?")[0].split("#")[0]).is_file():
                problems.append(ref)
        self.assertEqual(problems, [])

    def test_nothing_is_fetched_from_another_site_and_outbound_links_are_safe(self):
        """A visitor's browser only contacts this site for the page itself; links that leave are https and do not hand over the page."""
        for tag, url, rel in self.page.refs:
            if tag == "a":
                if external(url):
                    self.assertTrue(url.startswith("https://"), url)
                    self.assertIn("noopener", rel, url)
            elif "canonical" not in rel:
                self.assertFalse(external(url) and not url.startswith("data:"), (tag, url))
        self.assertIsNone(re.search(r"@import|url\(\s*['\"]?https?:|(?:fetch|XMLHttpRequest)\b", self.text))
        self.assertIsNone(re.search(r"<(?:iframe|embed|object)\b", self.text))
        self.assertGreaterEqual(sum(1 for t, u, _ in self.page.refs if t == "a" and external(u)), 2, "the links to the data site and the paper")

    def test_the_page_can_be_read_by_a_screen_reader_and_a_phone(self):
        """Language, title, one main heading, unique ids, named buttons and fields, described images, a viewport."""
        p = self.page
        self.assertTrue(p.lang and p.title.strip())
        self.assertEqual(p.h1, 1)
        self.assertIn("width=device-width", p.meta.get("viewport", ""))
        self.assertEqual(len(p.ids), len(set(p.ids)))
        self.assertEqual(p.img_no_alt, 0)
        self.assertTrue(set(p.labelledby) <= set(p.ids), set(p.labelledby) - set(p.ids))
        for attrs, text in p.buttons:
            self.assertTrue(text.strip() or attrs.get("aria-label"), attrs)
        for attrs in p.inputs:
            self.assertTrue(attrs.get("aria-label") or attrs.get("id") in p.labels_for, attrs)

    def test_the_page_works_before_any_script_runs(self):
        """The written page already holds every technique with its text, so a visitor without scripts (or a search engine) reads all of it."""
        scenes = re.findall(r'<article class="tech[^"]*"[^>]*data-tech="(\w+)"', self.text)
        self.assertGreaterEqual(len(scenes), 8)
        self.assertEqual(len(re.findall(r"<h3 id=\"t-\w+\">[^<]+</h3>", self.text)), len(scenes))
        self.assertEqual(len(re.findall(r'data-note>[^<]{10,}<', self.text)), len(scenes))
        self.assertIn("localStorage", self.text)      # the page asks for the remembered theme before it paints, in a script in the head
        head = self.text.split("</head>")[0]
        self.assertIn("data-theme", head)


class BrowserChecks(unittest.TestCase):
    def test_in_a_browser(self):
        node, chrome = shutil.which("node"), os.environ.get("CHROME", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
        if NO_BROWSER or not node or not Path(chrome).is_file():
            self.skipTest("browser checks NOT run: they need node and Google Chrome (set CHROME to the browser binary)")
        try:
            r = subprocess.run([node, str(HERE / "browser.mjs"), str(FOLDER), "--port", str(9620 + int(os.environ.get("PORT_OFFSET", "0"))), "--limit", "170"], capture_output=True, text=True, timeout=200)
        except subprocess.TimeoutExpired:
            self.fail("the browser checks did not finish in 200 seconds")
        print(r.stdout)
        self.assertEqual(r.returncode, 0, "\n".join(l for l in r.stdout.splitlines() if l.startswith("FAIL")) + r.stderr[-500:])


NO_BROWSER = False

if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    NO_BROWSER = "--no-browser" in sys.argv
    FOLDER = Path(args[0]).resolve() if args else HERE.parent
    if not (FOLDER / "index.html").is_file():
        sys.exit(f"{FOLDER} has no index.html")
    suite = unittest.defaultTestLoader.loadTestsFromModule(sys.modules[__name__])
    res = unittest.TextTestRunner(verbosity=2).run(suite)
    sys.exit(0 if res.wasSuccessful() else 1)
