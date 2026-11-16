# R1-06, round 7: activity without recurring motion

This isolated proposal restarts the direction after rounds 1–6. It uses the real Deck renderer with eight simultaneous active requests and three inactive cases. Production files are unchanged.

Manual procedure: (1) start the approved fixture; (2) read its board and locale anonymously over loopback; (3) bundle the actual Deck HTML/CSS/JS; (4) apply a proposal-only signal to real request rows; (5) inspect all six patterns at 1970×1250 and 390×844, light/dark, with and without reduced motion; (6) hand offline artifacts to the coordinator for independent visual and blind review.

| Pattern | Direction | Cost / ambiguity |
| --- | --- | --- |
| A: fixed dot and text | Familiar status indicator | May imply presence rather than actual work |
| B: margin tab | Familiar fixed 2px marker | May resemble selection |
| C: inline label | Familiar small filled status | Eight repeated fills add visual weight |
| D: current verb | Describe what the agent is doing | Requires trustworthy current stage data |
| E: recent trace | Show the latest received work event | More reading; never infer work from a ticking clock |
| F: typography only | Use text weight, remove ornaments | Quietest, harder to scan |

Activity and measured completion remain separate. Four tasks have 2/5 steps (40%); four have no progress measurement. Waiting, parked and stale observations have no progress bar or recurring motion. The stale fixture has old 4/5 progress explicitly withheld. The existing request-level completion bar remains separate.

The renderer uses Grafito tokens and the existing Day Attendant list rhythm. It introduces no side panels, dialogs, help boxes, timers, external services or dependencies. The event trace and timestamps are synthetic and frozen; a real integration would update only on received evidence.

To build, use the five proposal source files in this directory and run from any directory:

```sh
python3 /ABSOLUTE/REPO/docs/proposals/build-r1-06.py \
  /ABSOLUTE/DATA/docs/proposals/r1-06-fixture-board.json \
  /ABSOLUTE/DATA/docs/proposals/r1-06-locale.json \
  /ABSOLUTE/REPO/docs/proposals/r1-06-offline.html
```

The standalone HTML needs no server. Search and inline expansion use the actual renderer; POST requests return 403. No production data or endpoints are used. Do not infer installation, integration, usability approval, or a selected design from this prototype. The coordinator owns the existing Lavish review and independent review assignments.

## Integrated independent review

The visual review and independent reading walkthrough cover the quiet round-7
delivery, despite their historical v4 task names. Round 7 supersedes earlier
animation counts. A is a static comparison reference, not the selected design.
The reader preferred its scanability without measuring time. They did not read
source or recommendations, but visible concept descriptions provided context;
this was not a fully blind participant study or a sustained comfort test.

The prototype now shows the next todo step after the active step when current
declared progress supplies it. It says "sin declarar" otherwise. No production
renderer or progress contract changes. The before walkthrough reproduced the
missing next step; the fixture already supplied Comprobación after Conexión.

Still open: confusion between request tasks and task steps; consistency of frozen
source/event timestamps; missing dependency/actor detail; and whether restrained
motion is comfortable with eight active cards. Text explanation is not evidence
these usability findings are fixed. A separate motion assignment remains pending;
its integrated comparison still requires independent visual and reading reviews.
No change to the general Deck layout or invented live data belongs to this step.

An optional fourth argument to the builder adds a link to the existing review
session. Opening the offline file does not start a server or create a session.
