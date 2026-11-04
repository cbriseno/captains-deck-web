# Captain’s Deck web

A private, responsive view and control surface for existing Firstmate work.
Python 3.11+ is the only runtime dependency.
Firstmate remains the request intake and owns every change to work.

The board shows the owner’s project → subproject → task hierarchy, including public counterparts grouped as ordinary subprojects while their repository identities remain distinct.
Projects collapse individually or together, filter the board, and expose priority, pause and dependency controls at each level.
The five columns are Needs you, Now (In progress and Follow), Waiting, Paused and Finished.
Follow shows Firstmate’s actual turn order; Change order reveals drag and up/down controls; moving into a different priority previews the adopted priority and offers the owner’s Undo operation.
Waiting and Paused use the visible task priority; priority, dependency and pause remain separate facts.
Paused and Finished can collapse to rails, and the searchable history retains older deliveries and their summaries, reports and explanation requests.
Details expand inside the selected card or group; Esc, another click or a click outside closes them and restores keyboard focus where appropriate.
A phone uses five state tabs, a collapsible project list and labelled up/down controls during order editing instead of hover or drag.

Dependency connectors show blockers, work released by a task, completed blockers and recorded question origins.
Focus keeps a group or task and its relationships highlighted through pointer exit and scrolling.
A stationary pointer changes focus after one second by default, adjustable from zero to ten seconds; moving resets the wait and leaving cancels it.
Clicking a group filters its tasks, clicking it again removes the filter, and clicking empty board space or pressing Esc clears focus.
Turning Focus off removes highlighting and connectors while click filtering remains available.
Connectors route through available whitespace with separated segments and paired numbered endpoints; unclear routes remain available in the dependency detail.
State transitions preserve visual continuity, filter changes use one brief opacity crossfade, and reduced motion disables travel.
Adding a dependency previews the owner’s exact impact before confirmation.
Priority, pause and order retain the approved single-action behavior, checking with the owner and showing its exact impact and real result with Undo.
A parent resume never clears a descendant’s own pause, and a running worker’s pause stays received until Firstmate confirms its safe point.
Short T/P/S identifiers come from Firstmate’s persistent alias ledger; Deck displays and copies them without allocating its own IDs.
The red Discuss removal button sends an idempotent consultation through Firstmate’s existing request intake in one press, after guarded impact validation.
An optional comment field sits below the button.
Its receipt means the consultation was recorded, not that work was removed or approved for removal.
Firstmate advises on initiative, dependencies and active work, then needs separate captain approval before any retirement.
No Deck control creates or deletes work.

Questions use the established guarded answer intake, with the recommended choice and free text, drafts, occurrence guards and durable answer status.
A completed investigation report may be the origin of a separate still-open decision; the two states are shown separately and no decision closes merely because its origin was delivered.
Only genuine outstanding questions appear; several in one project form a compact stack.
The work contract’s explicit question state also covers questions behind dependencies; it reuses the native card normalizer, occurrence guard and answer intake.
Creation, update, question and completion times stay distinct, with unknown values explicit and date-only values retaining their date.
Progress bars use only current owner-confirmed checkpoint metrics.
Stale, missing, unconfirmed, invalid and unmeasured progress use distinct text rather than a percentage.
A retained declaration appears only in a detail labelled historical and never supplies a current bar.
Known delivery phases distinguish a branch ready for integration, integration and activation without changing the task’s actual state.

Graphite, Paper and Ocean each offer Light, Dark and Auto modes, with persistent browser preferences.
Focus and its delay, project collapse and both rails are also remembered in that browser.
The earlier Compact control was superseded by this approved layout.

## Run locally

Python 3.11+ and its standard library are enough to start the web server.
From the checkout, run:

```sh
python3 web/launch.py run
```

In Windows PowerShell, use `py -3 web/launch.py run`.
Open `the URL printed at startup`; Ctrl+C stops the foreground server.
An unconfigured server shows an empty standalone board with connection guidance. After collection, `/health` returns 200 with `mode: standalone`; collection errors remain 503.
No Herdr process, build step or package installation is needed for the empty web UI.
A live board needs a compatible Firstmate producer in the same OS environment.
For the full stack on Windows, run Firstmate and Deck inside WSL2 and open the loopback URL from Windows.
Native Windows serving/control is implemented, but live Bash producer calls and safe report reads require POSIX/WSL; they do not silently fall back to weaker filesystem checks.
See [platform setup and validation limits](../docs/portability.md).

For an existing owner on Linux/macOS/WSL:

```sh
FM_FLOW_HOMES='firstmate=/absolute/firstmate-home' \
FM_FLOW_HOMES_ONLY=1 python3 web/launch.py run
```

For paths containing spaces, use `homes.conf` (one `label=path` per line) or `FM_FLOW_HOMES_JSON` (a JSON object mapping labels to paths).
Explicit configured homes remain visible even before they contain tasks.
`FM_ROOT_OVERRIDE` optionally selects a separate Firstmate code checkout; an existing owner `bin/` endpoint takes precedence for compatibility.
Every child process still receives the owning `FM_HOME`.

| Environment | Default | Purpose |
| --- | --- | --- |
| `CD_WEB_LANGUAGE` | `en` | Explicit per-installation UI language: `en`, `es`, or a regional variant |
| `CD_WEB_PORT` | `8787` | Listener port, 1024–65535 |
| `CD_WEB_BIND` | `the numeric loopback address` | Other bind addresses are rejected |
| `CD_WEB_ORIGIN` | empty | Exact optional private HTTPS origin, without path |
| `CD_WEB_USERS` | empty | Comma-separated authenticated proxy identities, required with an external origin |
| `CD_WEB_IDENTITY_HEADER` | empty (disabled) | Dedicated X- prefixed header set only by the authenticating proxy; required with origin and users |
| `CD_WEB_HERDR_ORIGIN` | empty | Optional supported Herdr Web HTTPS origin |
| `CD_WEB_EXTENSIONS_ROOT` | unset | Absolute extensions checkout exposing `bin/fm-extension settings` |
| `CD_WEB_DATA` | user config directory | Private deduplication receipts; no new task queue |
| `CD_WEB_RUNTIME` | user state directory | Managed instance control record, lifetime lock and log |
| `FM_ROOT_OVERRIDE` | empty | Optional Firstmate code root fallback |
| `FLOW_WORKTREE_ROOTS` | empty | Explicit manager search roots, separated by the platform path separator; empty skips pool/lease/presentation discovery |
| `FM_BASH` | `bash` | POSIX interpreter for explicit shell endpoint calls |
| `FM_FLOW_HOMES_JSON` | unset | JSON label/path mapping; `{}` with homes-only disables automatic discovery |
| `FM_FLOW_HOMES`, `FM_FLOW_HOMES_ONLY` | existing Deck discovery | Pin the owner scope for a service |

The server collects All and filters each request independently.
Two browsers selecting different crews cannot switch one another's board.
Source-read times remain separate from collector repaint and task event times.
A failed source retains its last successful read; a reconnect never submits a draft.

## Private configuration and process control

Keep deployment choices outside the checkout in a private JSON file containing the environment keys above, with string values.
`launch.py --config` loads that explicit file over inherited environment values.
For example, an empty local-only board needs just:

```json
{
  "CD_WEB_PORT": "8787",
  "FM_FLOW_HOMES_JSON": "{}",
  "FM_FLOW_HOMES_ONLY": "1"
}
```

```sh
python3 web/launch.py start --config /absolute/private/deck.json
python3 web/launch.py status --config /absolute/private/deck.json
python3 web/launch.py stop --config /absolute/private/deck.json
```

Use the same config for all commands.
`start` launches one managed instance; `managed` holds it in the foreground for a service manager.
Control uses a private instance token on a separate loopback socket, never a PID kill or a public HTTP action.
An old or unrelated PID cannot be stopped by this launcher.
The private runtime directory must be readable/writable only by its owner; on Windows use a user-owned directory with appropriate ACLs.
Do not place it on a shared/network filesystem.
The POSIX lock is compatible with the previous `run-managed.sh` flock lock, so existing cron entries can retain their paths and environment.
A legacy instance without a control record remains under its existing process manager; the new control commands do not adopt or stop it.
Keep answer receipts across updates and restarts.

For login persistence, configure your OS user service manager to run `launch.py managed --config ...` with absolute Python, script and config paths.
Linux systemd user services, macOS LaunchAgents and Windows Task Scheduler can use that same foreground entrypoint.
Nothing installs, enables or changes a service automatically.

## Language and appearance

English is the deterministic public default, including on Spanish-language systems and browsers.
Set `CD_WEB_LANGUAGE` in the existing private JSON configuration to select this installation’s language:

```json
{
  "CD_WEB_LANGUAGE": "es-MX",
  "CD_WEB_PORT": "8787",
  "FM_FLOW_HOMES_JSON": "{}",
  "FM_FLOW_HOMES_ONLY": "1"
}
```

```sh
python3 web/launch.py run --config /absolute/private/deck.json
```

For a temporary foreground preference on Linux, macOS or WSL:

```sh
CD_WEB_LANGUAGE=es python3 web/launch.py run
```

In PowerShell, use `$env:CD_WEB_LANGUAGE = 'es'; py -3 web/launch.py run`.
An explicit `--config` value overrides the inherited environment; an absent key uses the environment, then `en`.
The JSON file persists across launcher restarts and upgrades without editing application source.
Restart that Deck server with the same configuration and reload its browsers after changing the value.
Use the existing service manager for a service-managed installation.
No Herdr restart is needed.

Supported values are `en` and `es`, optionally followed by a two-letter or three-digit region: for example `en-GB`, `en-US`, `es-ES`, `es-MX` or `es-419`.
Case and surrounding whitespace are normalized; underscores are accepted as region separators.
Regional variants share their language catalog and use the regional locale for dates.
Unknown languages, malformed values, extensions and `auto` fall back to `en`.
Missing translation keys fall back to English.
There is no automatic browser, OS or agent-conversation language detection.
An agent selects the desired language by reading or updating this explicit installation preference.
All browsers of that server see the same language; independent servers with separate configurations remain independent.
The terminal board follows the same `CD_WEB_LANGUAGE` values from its own environment or the `language` file in its plugin config directory; see the [install notes](../README.md#install-and-run).

Only presentation changes: task titles, authored questions/options, reports, answers, URLs and protocol/state identifiers retain their content.
Exact times use the selected locale and the browser’s timezone; date-only events keep their calendar date without inventing a time or shifting across timezones.
Provenance retains the original source and timestamp values.

The header offers **Light**, **Dark** and **Auto**, plus **Graphite**, **Paper** and **Ocean** palettes.
Auto follows the operating system, including changes while the page is open.
Preferences persist per browser and origin; when storage is unavailable they work for the current page.
Appearance never writes task data or server configuration.

### Adding translations

`web/locales/en.json` and `es.json` are plain-text catalogs shared by the Python bridge and browser.
English source messages are stable keys; preserve named placeholders such as `{count}` and `{date}`.
To add a language, copy the English catalog, translate its values, and extend the language pattern in `normalize_language` in `web/localization.py` (currently the bounded `en|es` match); without that change the new code normalizes to `en`.
No translation framework or service is needed.
The terminal board reads these same catalogs; its shared helpers accept an optional presentation callback, which the web uses to supply its own language.
Never run a translator over authored task content or decision payloads.
Use `t(...)` for new UI chrome and `data-i18n`, `data-i18n-aria-label`, `data-i18n-placeholder` or `data-i18n-title` for static document text.
Catalog values enter the page through `textContent` and safe attribute setters.

## Optional private HTTPS proxy

Keep the listener on `the numeric loopback address` and use a dedicated private HTTPS origin with no URL prefix.
Set `CD_WEB_ORIGIN` to that exact origin and `CD_WEB_USERS` to a comma-separated list of case-sensitive authenticated identities.
These must be nonempty printable ASCII values without whitespace.
Set `CD_WEB_IDENTITY_HEADER` to a dedicated header such as `X-Authenticated-User`.
A trusted reverse proxy must authenticate callers, remove any caller-supplied identity header and set exactly one verified identity header.
The origin, header and identity allow-list must all be configured together; otherwise startup fails.
Missing identity or configuration fails closed.
Never expose this listener through a public tunnel or untrusted proxy.
No separate dashboard is required or included.

Local access requires the exact loopback Host.
Remote access requires the configured Host and allowed identity.
Every write requires exact Origin, JSON, a session cookie and a session-bound CSRF header.
Cross-site API reads, embedded frames and writes remain rejected.
A user-activated cross-site GET navigation to `/` or `/index.html` may open the initial document, still subject to Host and identity checks.
Existing remote configurations must explicitly add the trusted identity header setting before startup.
The separate `CD_WEB_HERDR_ORIGIN` setting does not grant remote web access.

## Producer compatibility

Firstmate does not currently expose a stable semantic version for all these surfaces.
Compatibility is defined by the capabilities below rather than a guessed minimum version.
The minimum read contract is `fm-bearings.v1`; work mutations require `fm-work-contract.v1` with the advertised operation.
Guarded question submission and history require the schemas listed below.
Missing capabilities keep read-only views available and disable unsupported controls.
The `deck-with-firstmate` clean-clone scenario is pending until a reviewed producer staging repository is available; fixture tests alone do not establish compatibility with a live producer.

## Work controls

`web/deck_control.py` consumes `fm-work-contract.v1` through the existing owner endpoint `bin/fm-tasks-axi.sh work`.
It uses capabilities, snapshot, preview, apply and request-status; JSON operations are sent on stdin with an explicit local `FM_HOME` and the existing sanitized child environment.
The browser cannot choose a shell command, code root, actor or arbitrary owner path.
After web authentication, operations carry the captain role; source reads and controls share a local adapter lock while Firstmate retains its authoritative lock and revision checks.
No duplicate queue, scheduler, daemon or direct backlog writer is added.
Missing capabilities or an unsupported contract major keep the board readable and controls disabled; missing operations disable their controls individually.
Remote homes remain read-only.

The adapter preserves numeric own priority and null separately, and uses each target’s revision for optimistic concurrency.
A reported unset priority displays NA while an absent priority remains unknown.
Firstmate owns cycle validation, inherited pauses, safe points, ranking and the authoritative Follow order.
The owner’s impact, conflict/cycle details, received/applied/error status and revision-bound Undo are displayed without simulated success.
The browser keeps request IDs in session storage so a reload can check status without resubmitting.
The Changes view offers status checks for pending requests; answering questions retains its separate existing durable receipts.

| Method | Route | Owner operation |
| --- | --- | --- |
| POST | `/api/control/OWNER/preview` | Read-only impact validation |
| POST | `/api/control/OWNER/apply` | Apply an existing-work operation |
| GET | `/api/control/OWNER/receipt?request_id=ID` | Check the same request |

Every new POST passes the same Host, identity, Origin, session, JSON and CSRF checks as answers.
Scope removal only submits `request_removal` to Firstmate; it does not delete anything.

## Actions and receipts

The current Firstmate owner must expose `fm-captain-hold.sh capabilities --json` with schema `fm-captain-hold.capabilities.v1`, `guarded_input:single-row` and `expected_identity` including `answers` and `reconcile-requests`.
`open TASK --identity` supplies the lifecycle (`hold-set#resolution-count`).
On a Markdown backlog an open reads the same value from the call's row; once Firstmate disagrees for a home, its opens ask Firstmate again.
The bridge sends that exact identity via `--expected-identity` on the public keyed-answer or reconcile-request intake.
Firstmate compares it under the existing owner task-control lock.
Without this capability, the question remains readable and submission fails closed.
The bridge binds the rendered question and ordered options to an opaque occurrence token and revalidates home, task, question and state.
Presentation and answer selection use that same normalized question content.
One durable receipt per occurrence prevents double submission across browsers and restarts.
Interrupted calls remain explicitly uncertain; a retry reads that receipt rather than automatically invoking the intake again.
If the question content or option order changes before intake, submission is refused with "The question changed" and the session draft is preserved; refresh and review the current question before retrying.
The keyed intake currently accepts a single-line answer of up to 512 bytes; over-limit answers are rejected before submission, never silently truncated.

A Firstmate captain call row can carry a structured `call` object: `question`, `options` (each `id`, `label` and optional `detail`), `recommended`, `context` and `link`.
An option `id` is a slug of 1 to 40 letters, digits, `.`, `_` or `-` that starts with a letter or digit, unique within the call and not `reconcile`; the board drops any other option, and `scripts/fm_contract_check.py` warns about it.
Its options become one-click choices with the recommended one marked; answering in your own words and the re-check request stay available as secondary paths.
The chosen option id goes through the same keyed-answer intake, and `link` opens the full report.
Options are never inferred from prose: a row without the object keeps the own-words flow.

Intake acceptance confirms a saved answer or review request.
Notice, ACK and consumption are separate fields and remain unconfirmed without owner evidence.
No receipt claims the agent resumed.
After the owning home's intake records an answer to that home's own `(main)` call, the bridge points its Firstmate at the record through the Deck's message-Firstmate path: one fixed line, sent with `herdr agent prompt` to the agent pane whose working directory is the home.
The line names the task, never the answer text or a home-relative command. The existing exclusive answer receipt prevents another notification when a submission is replayed, including after a restart.
When no such pane accepts it, the answer stays saved and the receipt says Firstmate will see it at its next turn.
Secondmate-owned calls, reconcile requests and unsaved answers send no message.
Reconcile is a request to recheck, never an answer or a release.
Explanations use `fm-delivery-explain.sh --task … --request-id … --json`, with `--status` for reads.
The existing stable home/task request ID owns deduplication; actual replies and ACKs are displayed as recorded.
Reports and user content only reach DOM `textContent`; report links are text, never commands or authority.
Report reads reuse the model’s task scope, size bounds and symlink/traversal protections.

The prior experimental Web Push surface is retired from this server.
It creates no keys/subscriptions, sends no alerts, and unregisters its old worker on an existing Deck origin.
Legacy push utilities are excluded from the public source export.

## Endpoints

All routes are on the dedicated origin and require the trust checks above.
Identifiers are server-issued opaque owner/card IDs; clients cannot supply filesystem roots.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/locale` | Instance language, regional locale and plain-text UI catalog |
| GET | `/health` | Readiness: 503 while the first snapshot is loading or unavailable, 200 after a valid snapshot |
| GET | `/api/board?home=ID` | Four states, sources, owner declarations and session CSRF |
| GET | `/api/ticket/KEY` | Full task context or current question/options |
| GET | `/api/ticket/KEY/report` | The call's linked report file, only a `.md`/`.txt` under the owner's `data/TASK/` |
| POST | `/api/ticket/KEY/answer` | Explicit answer: value, note, occurrence, request_id |
| GET | `/api/receipts` | This actor’s latest ten durable answer receipts |
| GET | `/api/history?home=ID&q=TEXT` | Retained history search, newest first, up to 1000 results with omission count |
| GET | `/api/delivery/OWNER/TASK` | Readable summary, report, details and the links its title carried |
| GET | `/api/delivery/OWNER/TASK/explanation` | Actual explanation receipt, ACK and reply |
| POST | `/api/delivery/OWNER/TASK/explanation` | Explicit request through the existing owner intake |

The listener can answer requests before discovery, Herdr and bearings finish.
During this startup interval the board reports `loading=true`; empty homes or history do not mean the owner has no retained work.
Health reports `ok=false`, `collector_at=0` and HTTP 503 until the first valid snapshot arrives.
Its `loading` and `error` fields distinguish a pending read from a reported collector failure.
Health confirms collector readiness; source timestamps and errors on the board describe freshness separately.

## Validation

```sh
python3 -m unittest discover -s /absolute/captains-deck/web/tests -p 'test_*.py' -v
node /absolute/captains-deck/web/tests/localization.test.cjs
node /absolute/captains-deck/web/tests/board_dom.test.cjs
```

The approved browser check uses `chrome-devtools-axi` against a disposable fixture owner at 1440, 390 and 360 px.
It checks hierarchy, exact turn order, preview/apply/undo transport, inline recommended answers and retained drafts, connectors/Focus, keyboard focus, history and all six theme combinations.
It skips when that CLI is unavailable; `CD_TEST_BROWSER` chooses its executable and `CD_TEST_SESSION` can select an existing task-owned browser session.
`board_dom.test.cjs` includes the retained native question/report tests and the browser check; `board_layout.browser.cjs` is a compatibility entrypoint for the same browser check, so run one entrypoint per validation batch.
These fixture checks do not prove the real Firstmate engine, safe-point protocol or dispatch behavior.
Real acceptance must read the configured local owner first, then exercise the actual owner implementation against disposable state and verify persisted requests and Firstmate receipt.

The native detail helpers run under Node.js 22; production still requires only Python.
The HTTP tests retain two-browser races, restart deduplication, identity/origin/CSRF rejection, stale questions, long answers, archive history and report symlink/traversal checks.
`web/tests/approved_fixture.py /ABSOLUTE/PROOF_DIR` starts the disposable approved-layout fixture on a free loopback port.
Production has no fixture or arbitrary data-file CLI flag.
Viewport emulation does not constitute a physical touch-device test.

## Stable notification links

Use `/?home=HOME_ID&task=TASK_ID&view=call` or `view=delivery`.
For a local owner, `HOME_ID` is `sha256(UTF8(realpath(FM_HOME))).hexdigest()[:32]`.
The task is the exact owning-home slug, URL encoded.
The route contains no absolute path, pane/session identity or transient ticket key.
It resolves only configured/discovered homes and never chooses a same-named task in another home.
Opening a link is read-only.
Optional `item=hold:N` binds a call notification to its original canonical hold occurrence.
A replaced occurrence opens an explicit old-notification context, with separate navigation to the current question.
`resolved TASK N` confirms a resolved original call where the owner retains that evidence.
Missing or unverifiable historical evidence stays explicit; it never becomes a new answer form for an old notice.
The current delivery history cannot correlate arbitrary notification item/artifact IDs, so a delivery link with such an item labels that correlation as unverified while showing the retained summary for the exact home/task.
`GET /api/resolve?home=…&task=…&view=…&item=…` is the read-only entry resolver.

## Relay and planning settings

**Relay settings** opens the selected coordinating space's relay mode, thresholds, planning preferences and recent relay activity.
Set `CD_WEB_EXTENSIONS_ROOT` to an installed extensions checkout that exposes the versioned `bin/fm-extension settings` contract.
An absent or incompatible extension, an absent Firstmate endpoint or a remote space shows an unavailable state and permits no writes.
Deck does not install extensions, prepare hooks, grant harness trust or initiate handoffs.

Thresholds keep the captain's notation: `umbral:600K`, `umbral:80%`, `compactaciones:5`, whitespace for both conditions and `o` for whichever happens first.
The extension validates and saves changes; Deck never edits its configuration files.
Planning scopes distinguish task, project, coordinating space and installation; existing tasks keep their assigned plan.
Project and task choices cover the Deck’s known board identities and registered preferences, rather than a complete inventory.
Local managed `projects/<repository>` links map the owner’s repository identity to its canonical path; unresolved local identities have no writable selector.
Every settings change uses a request ID and the extension's expected revision, with applied/rejected results, explicit retries with the same request ID and the extension's Undo token where available.

Both enabling and disabling automatic relay require a separate confirmation dialog and the captain's own words.
Activation discloses the effective harness thresholds and attempt limits, checks each covered harness through the extension's preflight, explains that authorization is global, and sends the confirmation verbatim through its authorize command.
The installed default remains assisted, with automatic relay off; viewing the panel never changes it.
An uncertain response offers **Retry same request**, which resends the exact confirmed operation rather than inventing a new request.
The browser remembers that operation for this session; it never resends automatically on reload.
Signed previews survive a Deck restart using a private key under `CD_WEB_DATA/settings`, created only after a valid preview.


## Compatibility and inherited tools

`python3 web/serve.py` accepts the same commands as `launch.py` and delegates to that launcher.
The unregistered manifest and `push.py` are inherited artifacts; Web Push remains retired.
No images are bundled; `python3 web/tools/make_icons.py` optionally generates local icons on demand.
The optional push module requires cryptography and the icon generator requires Pillow; neither is imported or required by the web server.
