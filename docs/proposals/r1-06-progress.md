# R1-06: five progress concepts in the real Deck

Review round 2 rejected the previous animated indicator. Version 4 compares
A (continuous track), B (ring), C (discrete segments), D (numeric fraction),
and E (milestone sequence). No replacement has been selected. This is a
proposal only; no production source is modified.

## Manual procedure

1. Start `web/tests/approved_fixture.py` in a disposable directory with
   `CD_TEST_PROGRESS=1 CD_WEB_LANGUAGE=es`. Read its printed loopback URL.
2. Open that real Deck. Expand its requests and observe the task count and
   measured steps separately. Read `/api/board` and `/api/locale` from that
   fixture into temporary JSON files; remove the board's `csrf` field.
3. Run `python3 docs/proposals/build-r1-06.py BOARD_JSON LOCALE_JSON OUTPUT_HTML`.
   Use only synthetic fixture inputs. The script embeds the existing Deck
   HTML/CSS/JavaScript and replaces `progress()` only inside the generated page.
   It supplies five synthetic cases through an in-memory fixture transport.
4. Open the generated HTML locally. Switch A–E, expand requests, search, compare
   light/dark at desktop and mobile widths, and try optional motion with and
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

Motion is off initially. Optional motion only affects indeterminate A and B;
C–E remain static. CSS honors `prefers-reduced-motion`. The same 32 px progress
slot is used across concepts. No extra sidebar or dialog is introduced.

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
