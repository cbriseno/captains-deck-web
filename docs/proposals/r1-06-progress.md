# R1-06: ten animated concepts in the real Deck

Review round 4 asks for five creative breathing variations and five new concepts.
Version 6 offers R1 Tinta (uniform surface), R2 Halo (diffuse center), R3 Fuelle
(paired lateral veils), R4 Marea (light from below), R5 Contorno (stationary outline),
N1 Trama (diagonal texture), N2 Ondas (expanding waves), N3 Péndulo (hinged stroke),
N4 Ecualizador (vertical strokes), and N5 Pliegue (folding shape).
The five new concepts do not repeat the earlier top trace, whole-surface breathing,
sweep, moving title, traveling perimeter, dot, track, ring, numeric or milestone cues.
No replacement has been selected. This is proposal-only; production source is unchanged.

## Manual procedure

1. Start `web/tests/approved_fixture.py` in a disposable directory with
   `CD_TEST_PROGRESS=1 CD_WEB_LANGUAGE=es`. Read its printed loopback URL.
2. Open that real Deck. Expand its requests and observe the task count and
   measured steps separately. Read `/api/board` and `/api/locale` from that
   fixture into temporary JSON files; remove the board's `csrf` field.
3. Run `python3 docs/proposals/build-r1-06.py BOARD_JSON LOCALE_JSON OUTPUT_HTML`.
   Use only synthetic fixture inputs. The script embeds the existing Deck
   HTML/CSS/JavaScript and replaces `progress()` and adds card decorations only in the generated page.
   It supplies five synthetic cases through an in-memory fixture transport.
4. Open the generated HTML locally and with the same sandbox flags as Lavish.
   Switch R1–R5 and N1–N5, expand requests, search, compare
   light/dark at desktop and mobile widths, and pause motion with and
   without the system's reduced-motion preference. No backend is contacted.
5. Review the same artifact in the existing worker-owned Lavish session.
   Obtain independent visual and blind usability reviews before closing P16.
   A later implementation requires its own SDLC and the selected design.
6. Close the fixture and test browser. Keep only the explicitly hosted review
   board and its supervised listener available for feedback.

## Scope and semantics

The HTML file in this directory is the report template; build it before review.
The generated output is a single offline file, with no fonts, CDNs or servers
required. Original Deck scripts retain search and inline request expansion.
Fixture transport refuses mutations; real Firstmate data is never read.

All concepts display the same five states: measured 2/5, unmeasured activity,
dependency wait, parked, and unconfirmed activity. Only measured current steps
have `role=progressbar`; no percentage is assigned to the other states. The
request's completed-task count is distinct from task steps. Steps are not time,
effort, installation, or acceptance. Activity freshness and progress freshness
are independent; the report describes the stale-progress/confirmed-activity case.

All ten patterns animate by default on the real active request cards. They do
not animate the measured percentage. Waiting, parked and unconfirmed cards
stay static. The pause checkbox and system `prefers-reduced-motion` disable
all ten; text and actual measurements remain available. The decoration is
absolutely positioned within the real request header, behind its text. Inline
marks replace the active status dot only for N3–N5. Card dimensions are checked
at desktop and mobile widths. The measured percentage never animates.

The generated copy removes the service-worker cleanup line: it has no worker to
unregister and Lavish disallows that API in its sandbox. Appearance controls and
intrinsic height use `postMessage` between the report and its embedded Deck;
this supports the manual theme/concept/pause controls without cross-frame DOM
access. The production code and Lavish's sandbox permissions are unchanged.
This corrects two observed SecurityErrors in the initial sandbox run.

The design uses Grafito tokens shared by Captain's Deck and Day Attendant,
system typography, a plain report layout, and inline disclosure. Benefits and
tradeoffs are design hypotheses, not measured usability results. Browser checks
and screenshots belong to the task's private report directory, not this repo.

The former proposal's isolated samples did not meet the requirement to demonstrate
the concepts in the real interface. This revision replaces them with the actual
renderer and synthetic owner projection. Linux is verified; the Mac is not.
Source references: approved plan v2 P16, report b group 11, attachment R1-02/R1-06,
`web/static/deck-ui.js` (`progress`, `requestRow`) and `web/static/deck.css`.
No L1–L23 issue was reopened.

## Breathing geometry correction

The real v5 run reproduced the reported mismatch: a 10px rounded overlay on
straight request rows, positioned over the entire request including expanded
content. In v6 the overlay inherits the actual header radius, has zero inset,
and stays behind its content. It never grows with expanded task details.
The regression check fails on the v5 fixture and passes on v6. Evidence and
captures live in the task report directory. This correction is only in the
proposal layer; no production padding, row geometry or renderer was modified.
