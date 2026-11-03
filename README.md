# Captain’s Deck Web

A dependency-free local web board for Firstmate, with an optional Herdr terminal plugin.
This is a derivative of [deimantasnork/captains-deck](https://github.com/deimantasnork/captains-deck), licensed under MIT; the original LICENSE is retained unchanged.
Compared with upstream, this distribution adds a standalone web entry point, guarded work controls, delivery history, explicit localization and generic trusted-proxy authentication.
It contains no image assets, bundled fonts or installation-specific data.

## Required versus optional tools

The standalone board requires an already approved Python 3.11+ with its standard
library. A modern browser is needed to use the UI; Safari is normally supplied
by macOS but its minimum version is unknown. Python of the required version is
not assured on a managed Mac. Firstmate supplies live data and controls; Herdr
and the relay extension are optional integrations. Node and pytest are only
needed for the development checks below, which also use existing locked Node test
dependencies. Exact lower versions are unknown unless stated below.

Run the read-only inventory from the source root:

```sh
python3 -B scripts/check_tools.py
```

If `python3` is absent, the shell reports that before the check can run. READY
covers the standalone runtime only; optional integrations require their own checks.

## macOS

Linux is verified. macOS is supported by design but is not accepted until the
inventory and documented tests run on the target Mac. Use already approved tools;
no root or new dependencies are required for standalone operation. Temporary
files use the standard temporary directory and respect a writable `TMPDIR`.
Native integration, permissions and producer behavior still need Mac validation.

## Install and run

Production requires Python 3.11 or newer; it uses only the standard library and requires no Node packages or build step.
Extract or clone this distribution into a directory you own and open a terminal at its root.
Run the empty standalone board:

```sh
FM_FLOW_HOMES_JSON='{}' FM_FLOW_HOMES_ONLY=1 python3 web/launch.py run --port 18787
```

Open the URL printed at startup and stop the foreground process with Ctrl+C.
The standalone board is intentionally empty, explains how to connect a producer, and disables controls without a producer.
After the first collection, `/health` returns HTTP 200 with `mode: standalone`; loading and collection failures return 503.
Runtime state and receipts live outside the checkout in the user’s platform data directories.
Use separate `CD_WEB_DATA`, `CD_WEB_RUNTIME` and `HERDR_PLUGIN_STATE_DIR` directories when running independent instances.

To connect Firstmate, replace the empty `FM_FLOW_HOMES_JSON` object with a JSON map of labels to absolute home paths, keep `FM_FLOW_HOMES_ONLY=1`, and restart only your own Deck process.
Optional discovery of managed checkouts reads only the roots in `FLOW_WORKTREE_ROOTS`, which defaults to empty.
Separate roots with the platform path separator (colon on POSIX, semicolon on Windows); spaces inside a root are preserved.
When empty, pool discovery and its lease/presentation scans are skipped without error.
Each configured root is searched for two directory levels followed by a Firstmate checkout; explicit home maps still take precedence when homes-only mode is selected.
Use a fresh standalone Firstmate checkout; do not point development tests at an operational home.
See [the integration and security contract](web/README.md) for capabilities and configuration.
Firstmate is optional; Herdr is optional for the web.
English is the default even on non-English systems.
Set `CD_WEB_LANGUAGE=es` or a supported regional variant such as `es-MX` for Spanish; task prose is never translated.

## Anonymize mode

Enable **Anonymize** (**Anonimizar** in Spanish) in the header before taking a
screenshot. It starts off and is remembered only in this tab's `sessionStorage`.
The page scans text, tooltips (`title`), accessible labels, alternative text,
placeholders and form values, including hidden and newly added DOM content.
Unknown prose, errors, conversation, paths and attachment names are replaced with
deterministic neutral words in the interface language. Catalog labels and explicitly
typed counts, progress and formatted dates remain visible. The tab title stays unchanged.
Original strings remain in memory for restoration when the switch is turned off.

Text editing and selection changes are read only while enabled. Deck also refuses
server writes and draft saves during this mode, so a replacement cannot become a
real answer. Turn it off to edit or submit. Keyboard focus is retained.

This is a screenshot aid, **not a privacy guarantee**. It does not cover browser
chrome or tabs, images, canvas, CSS pseudo-elements, iframes or embedded content.
Internal attributes and URLs, logs and network traffic retain real values. Review
the entire screenshot before sharing it. Closed shadow roots are outside the DOM
scanner; Deck currently creates no shadow roots. Open roots are scanned.

Development check: `node --test web/tests/anonymize.browser.cjs`, using the existing
`chrome-devtools-axi` browser fixture. Large sweeps run in hidden stages: the page can take several seconds to become
visible on large boards. The check reports both total time and the largest measured
main-thread pause, and keeps a 200 ms pause budget for 500 synthetic rows.

## Security defaults

The listener accepts only `the numeric loopback address`; remote authentication is off by default.
Local users with access to the listener are trusted.
Remote access requires an authenticating reverse proxy on the same host, an exact HTTPS origin, a configurable identity header and an explicit identity allow-list.
The proxy must strip client-supplied identity headers and set a single authenticated identity.
Host checks, exact-origin writes, session-bound CSRF tokens, JSON-only writes, frame restrictions and cross-site API protections remain active.
Do not expose the raw listener.
The board reads producer data and uses documented guarded intakes; it does not supervise agents or provide a shell-command API.

## Development checks

Tested development runtimes: Python 3.11 and Python 3.13; Node.js 22 for JavaScript checks and the locked history reader.
The optional terminal plugin declares Herdr 0.9.0 or newer, Bash and Python 3.11 or newer.
Its source and manifest are included; live plugin activation is outside the web distribution’s acceptance tests.
It uses the same plugin ID as upstream, so install only one variant.

The full development suite requires pytest and the locked Node test dependencies
to be already available and approved. Do not install packages on a managed image.
If they are absent, record the affected checks as unavailable.

The recorded producer inputs are materialized into temporary runtime directories for contract checks; generated runtime files never enter the source tree.
The Python suite also needs pytest 9.0.2 in your chosen development environment.
Run the suites sequentially from the repository root:

```sh
python3 -m unittest discover -s web/tests -p 'test_*.py'
PATH="$PWD/tests/node_modules/.bin:$PATH" python3 -m pytest tests/ -q
node web/tests/localization.test.cjs
node web/tests/board_dom.test.cjs
node web/tests/creation_age.test.cjs
node web/tests/deck_motion_module.test.cjs
node web/tests/deck_relations_module.test.cjs
node web/tests/native_details.test.cjs
python3 tests/check_fixture.py
```

Linux is the verified environment.
macOS and Windows/WSL are not yet validated platforms for this distribution.
Native Windows can host an empty web UI; Firstmate integration and the terminal plugin require a POSIX environment.
Relay settings are available through an optional Firstmate extensions checkout; automatic relay remains off by default. This distribution contains no relay engine, push-notification sender or installable PWA.
