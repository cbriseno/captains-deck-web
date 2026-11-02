# Captain’s Deck Web

A dependency-free local web board for Firstmate, with an optional Herdr terminal plugin.
This is a derivative of [deimantasnork/captains-deck](https://github.com/deimantasnork/captains-deck), licensed under MIT; the original LICENSE is retained unchanged.
Compared with upstream, this distribution adds a standalone web entry point, guarded work controls, delivery history, explicit localization and generic trusted-proxy authentication.
It contains no image assets, bundled fonts or installation-specific data.

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

Install the locked Node test dependencies:

```sh
npm ci --prefix tests --ignore-scripts --no-audit --no-fund
```

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
macOS and Windows/WSL are portability targets, not validated platforms for this distribution.
Native Windows can host an empty web UI; Firstmate integration and the terminal plugin require a POSIX environment.
Relay settings are available through an optional Firstmate extensions checkout; automatic relay remains off by default. This distribution contains no relay engine, push-notification sender or installable PWA.
