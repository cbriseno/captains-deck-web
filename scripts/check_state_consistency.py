#!/usr/bin/env python3
"""Compare read-only Firstmate/Deck observations from a sanitized JSON bundle.

Input is a JSON object with ``tasks``; each task may carry ``backlog``, ``meta``,
``status``, ``worker``, ``pause``, ``snapshot`` and ``deck`` objects. The checker
does not infer absent evidence. It reports only explicit disagreements and
returns 1 when any are found.

    python3 scripts/check_state_consistency.py --snapshot FILE
"""
import argparse
import json
import sys


def audit(bundle):
    findings = []

    def add(task, source, shown, truth, cause, severity='high'):
        findings.append({'task': task, 'source_of_truth': source, 'shown': shown,
                         'expected': truth, 'cause': cause, 'severity': severity})

    for row in bundle.get('tasks', []):
        task = str(row.get('id', '<unknown>'))
        backlog, status = row.get('backlog') or {}, row.get('status') or {}
        meta, worker = row.get('meta') or {}, row.get('worker') or {}
        pause, snap, deck = row.get('pause') or {}, row.get('snapshot') or {}, row.get('deck') or {}
        inventory = set(bundle.get('project_inventory') or [])
        state = backlog.get('state')
        reported = status.get('state')
        projected = snap.get('state')
        if state == 'in_flight' and reported in ('done', 'failed', 'blocked', 'needs-decision'):
            add(task, 'backlog lifecycle + latest status report', f'backlog={state}, status={reported}',
                'both sources agree on current lifecycle', 'backlog row and status tail disagree')
        if state == 'in_flight' and projected == 'done':
            add(task, 'backlog lifecycle', 'work snapshot says done while backlog remains in flight',
                'reconciled current lifecycle', 'owner work projection and backlog disagree')
        if state in ('queued', 'charted', 'ready') and projected == 'active':
            add(task, 'backlog lifecycle', f'work snapshot says {projected} while backlog says {state}',
                'reconciled current lifecycle', 'owner work projection and backlog disagree')
        if state == 'in_flight' and worker.get('observed') is True and worker.get('alive') is False:
            add(task, 'backlog lifecycle + live Herdr inventory', 'in flight, no live worker',
                'worker evidence reconciled with task lifecycle', 'dispatch artifacts or worker inventory are stale')
        pane = meta.get('pane_id')
        live_pane = worker.get('pane_id')
        if pane and worker.get('observed') is True and live_pane != pane:
            add(task, 'live Herdr pane identity', f'meta pane={pane}; live pane={live_pane}',
                'meta points to the current worker or is cleared', 'stale task metadata was not reconciled')
        owner_pause = pause.get('owner')
        projected_pause = pause.get('snapshot')
        if owner_pause is not None and projected_pause is not None and owner_pause != projected_pause:
            add(task, 'pause owner record', f'pause={projected_pause}', f'pause={owner_pause}',
                'work snapshot pause projection differs from control record')
        expected_column = {'active': 'now', 'stopping': 'now', 'ready': 'now',
                           'waiting': 'waiting', 'paused': 'paused', 'done': 'done'}.get(projected)
        if expected_column and deck.get('column') and deck['column'] != expected_column:
            add(task, 'work snapshot state', f'Deck column={deck["column"]}',
                f'Deck column={expected_column}', 'Deck column derivation or cached board is stale')
        project = row.get('project') or {}
        if project.get('label') and deck.get('group') in ('', 'Project not reported', 'Not recorded.'):
            add(task, 'canonical project label', f'Deck group={deck.get("group") or "missing"}',
                f'Deck group={project["label"]}', 'project hierarchy was not reconciled from available card data', 'medium')
        if project.get('visibility') and deck.get('visibility') == 'Visibility not reported':
            add(task, 'project visibility inventory', 'Deck says visibility not reported',
                f'Deck visibility={project["visibility"]}', 'Deck did not use the reported visibility value', 'medium')
        if deck.get('id_pending') is True and (snap.get('alias') or snap.get('id')):
            add(task, 'stable task identity', 'Deck says ID pending',
                f'Deck ID={snap.get("alias") or snap.get("id")}', 'Deck renderer discarded available identity', 'medium')
        for field, source_field in (('alias', 'alias'), ('parent', 'parent')):
            expected = snap.get(source_field)
            shown = deck.get(field)
            if expected and shown and expected != shown:
                add(task, f'work snapshot {source_field}', f'Deck {field}={shown}',
                    f'Deck {field}={expected}', 'Deck relationship/identity reconciliation is stale')
        if snap.get('parent') and inventory and snap['parent'] not in inventory:
            add(task, 'project/subproject inventory', f'work snapshot parent={snap["parent"]} has no inventory row',
                'parent resolves to a project or subproject', 'Firstmate emitted a dangling hierarchy reference')
        if deck.get('progress_percent') == 100 and projected != 'done':
            add(task, 'task lifecycle state', 'Deck shows 100% while task remains unfinished',
                'show completed declared steps alongside unfinished task state',
                'progress rendering omits the independent lifecycle state', 'medium')
        if deck.get('age_seconds') is not None and snap.get('updated_epoch') is not None:
            delta = abs(deck['age_seconds'] - max(0, bundle.get('observed_epoch', 0) - snap['updated_epoch']))
            if delta > bundle.get('age_tolerance_seconds', 90):
                add(task, 'work snapshot updated timestamp', f'Deck age={deck["age_seconds"]}s',
                    f'age={max(0, bundle.get("observed_epoch", 0) - snap["updated_epoch"])}s',
                    'Deck age uses a different event or a stale cached timestamp', 'medium')
        controls = deck.get('controls') or {}
        if 'pause' in controls and 'can_pause' in pause and controls['pause'] != pause['can_pause']:
            add(task, 'pause control projection', f'Deck pause control={controls["pause"]}',
                f'pause allowed={pause["can_pause"]}', 'Deck control cache disagrees with owner pause evidence')
        group = row.get('group') or {}
        if group.get('source_count') is not None and group.get('deck_count') is not None and group['source_count'] != group['deck_count']:
            add(task, 'descendant task inventory', f'Deck group count={group["deck_count"]}',
                f'group descendant count={group["source_count"]}', 'group aggregation omitted or duplicated descendants')
    return findings


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot', required=True, help='sanitized JSON comparison bundle')
    args = parser.parse_args()
    try:
        with open(args.snapshot, encoding='utf-8') as stream:
            findings = audit(json.load(stream))
    except (OSError, ValueError) as exc:
        print(f'cannot read consistency snapshot: {exc}', file=sys.stderr)
        return 2
    if findings:
        print(json.dumps({'ok': False, 'contradictions': findings}, ensure_ascii=False, indent=2))
        return 1
    print(json.dumps({'ok': True, 'contradictions': []}, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
