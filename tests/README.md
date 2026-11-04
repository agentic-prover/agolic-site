# Tests of the Agolic page

The page is one hand-written `index.html` with a logo and fonts. These tests guard what a visitor cares about and nothing else, so wording, colours and layout may change freely.

## What must never break

| What a visitor relies on | Test |
|---|---|
| The logo, fonts and every link inside the page lead somewhere | `run.py` (files) |
| The browser contacts no other site, and outbound links are safe | `run.py` (other sites) |
| A screen reader and a phone get a language, a title, one main heading, named buttons and fields | `run.py` (reader) |
| The page already holds every technique in written form before any script runs | `run.py` (before scripts) |
| The page loads without script errors or missing files, on a desktop and a phone | `browser.mjs` (loads) |
| The light and dark switch works and the choice is kept, including on the next visit | `browser.mjs` (theme) |
| Text can be read in both themes | `browser.mjs` (contrast) |
| The try-an-input box gives the right verdict for the program shown, stops at the right check, and Show me really crashes it | `browser.mjs` (try box) |
| Choosing a language shows that language's program and marks only that choice | `browser.mjs` (language) |
| Every scene has a tab and each tab shows its own scene alone | `browser.mjs` (tabs) |
| Every scene plays to its last picture and stops, and Play again does it again | `browser.mjs` (scenes) |
| With reduced motion every scene shows its last picture at once | `browser.mjs` (reduced motion) |
| No width scrolls sideways and every card fits its screen, from a small phone to a wide desktop | `browser.mjs` (fits) |
| With scripts off every technique is shown | `browser.mjs` (no scripts) |

## Running

Python 3.12 or later (standard library only). The browser checks need node and Google Chrome (set `CHROME` to the browser binary if it is not in the usual place); without them they are skipped and the run says so.

```
python tests/run.py                  # the page in the folder above, files and browser, about a minute
python tests/run.py OTHER_FOLDER     # another folder that holds an index.html
python tests/run.py --no-browser     # the file checks only, a second
python tests/break_it.py             # breaks the page on purpose and shows which bugs the tests catch
```
