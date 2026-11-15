# R1-06: activity indicator proposal

Open [the standalone proposal](r1-06-progress.html) locally or in Lavish.
This document proposes a shared activity signal; it changes no production behavior.
Review round 2 rejected the former animated dot and requested at least five
distinct concepts. Version 3 provides a linear track, ring, discrete steps,
typographic percentage and milestone log. No replacement has been selected.
Implementation remains outside P16; the earlier choice of B is superseded.

## Manual review

1. Run the existing isolated `approved_fixture.py` with `CD_TEST_PROGRESS=1`.
2. Expand the request and its task rows. Observe the completed-task ratio and the
   measured-step progress separately; check which activities have a signal.
3. Open the proposal and compare the five concepts, each measured and unmeasured.
4. Check mobile width, both Grafito themes, movement disabled, and the system's
   reduced-motion preference. Choose a variant or request adjustments in Lavish.
5. Record the response. A subsequent implementation uses P10/P12 data and P14
   layout slots, then repeats the reviewed cases against the real Deck.

## Evidence and boundaries

Baseline: `71212910948f0100eb4accd69b31b7d2da67deed`, Linux, synthetic local data.
The live fixture showed a 40 px completed-task bar, a 64 px measured-step bar,
and `33% · 1/3 pasos` without a pseudo-element indicator on the active task.
The source limits the request-stage indicator to confirmed active activity with
non-current progress. This supports comparing a shared signal for measured and
unmeasured work; it does not establish the reported animation defect on macOS.

The measured examples all represent 2/5 steps. Indeterminate examples show
confirmed activity, never a percentage. Only the track and ring animate; step,
type and milestone concepts are static. Phase and milestone text are explicitly
synthetic; absent producer data must fall back to `Trabajando`, not invented steps.
Dependency wait, parked and unconfirmed activity have shared static treatment.
The explanatory text covers independent activity/progress freshness and the two
different task/step metrics. The prior live baseline remains historical evidence.

The artifact uses the Deck's Grafito light/dark tokens and system font, with the
lightweight Firstmate report structure. It contains no remote assets or libraries.
Normal controls change only local preview state. Feedback is queued once on form
submission; the same queue key replaces an unsent answer. Standalone mode exposes
the answer as text for manual delivery. No bridge, backend or new service is added.

Artifact checks cover desktop/mobile geometry, both themes, static/moving signals,
actual Chromium reduced-motion emulation using its startup flag, keyboard access
and the offline answer path. A queue-function stub checks zero calls on selection
and one call on submit; it does not verify Lavish delivery. The same task-owned
review session is reused. This proposal does not claim measured usability gains.

The baseline screenshot, offline report containing that screenshot, check logs and
review session are task evidence outside the source tree, under Firstmate's
`data/macb-p16-20261114/`. The source artifact remains portable and synthetic.

Sources: report b group 11; R1-02/R1-06 in
`deck-ui-feedback-round-1.json`; approved plan v2 P16; `progress()` in
`web/static/deck-ui.js`; `.request-stage`, `.request-bar`, `.prog-bar` in
`web/static/deck.css`. R1-02's positional selector cannot identify the bar subtype.
No L1–L23 behavior was reopened or changed.
