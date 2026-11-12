"""The board says what is happening now, from the reproduced busy-looking fleet."""
from datetime import date, timedelta
import http.client
import json
import threading
import os
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import activity_fleet
from fixtures import bridge

f = bridge.fm


class ActivityTruthTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        env = patch.dict(os.environ, HERDR_PLUGIN_STATE_DIR=str(Path(self.tmp.name) / 'state'), CD_WEB_LANGUAGE='en')
        env.start()
        self.addCleanup(env.stop)
        locale = patch.object(f, '_LOCALIZATION', bridge.Localization('en'))
        locale.start()
        self.addCleanup(locale.stop)

    def board(self, firstmate_fields=False):
        root = Path(self.tmp.name) / ('with-fields' if firstmate_fields else 'today')
        return activity_fleet.fleet(root, firstmate_fields)[0]

    def cards(self, board):
        return {c['task']: c for col in board.board()['columns'] for c in col['cards']}

    def test_only_agents_reported_working_count_as_working_now(self):
        cards = self.cards(self.board())
        expected = {
            'api-pagination': ('working', 'working'), 'search-index': ('working', 'working'),
            'docs-refresh': ('working', 'working'),
            # crew state reports the validation run as working; it is not the agent.
            'release-notes': ('validating', 'validation'),
            'billing-export': ('validation_gate', 'present'),
            'cache-migration': ('paused', 'none'), 'log-rotation': ('paused', 'none'),
            'notes-sync': ('finished', 'present'), 'mobile-publish': ('blocked', 'present'),
            # A working verdict read from the status log is not a busy pane.
            'queue-retry': ('unknown', 'present'),
            # Working, but its source is replaced by the hold until state_source is exported.
            'theme-tokens': ('unknown', 'open'),
        }
        self.assertEqual({k: (cards[k]['activity']['kind'], cards[k]['activity']['agent']) for k in expected}, expected)
        for firstmate_fields, working in ((False, 3), (True, 4)):
            underway = self.board(firstmate_fields).collector.snap.cols['underway']
            self.assertEqual(len(underway), 11)
            self.assertEqual(f.activity_counts(underway)['working'], working)

    def test_queued_ready_is_distinct_from_blocked_and_deferred(self):
        from fixtures import fixture, start_fixture, publish_fixture
        board, home = fixture(Path(self.tmp.name) / 'queued')
        start_fixture(board,home);self.addCleanup(board.stop)
        snapshot=json.loads((Path(home.path)/'work-snapshot.json').read_text())
        snapshot['tasks'] = [
            {'key':'task:'+name,'title':name,'state':'waiting_dep','rev':'r1',
             'question':{'open':False},'blocked_by':[{'ref':'task:missing','open':True}]}
            for name in ('invoice-email','pricing-page','pricing-followup')]
        snapshot['tasks'] += [
            {'key':'task:'+name,'title':name,'state':'waiting_future','rev':'r1',
             'question':{'open':False},'pause':{'own':{'kind':'future'},'inherited':None}}
            for name in ('device-trial','pilot-rollout')]
        snapshot['tasks'] += [
            {'key':'task:readme-badges','title':'Ready','state':'ready','rev':'r1','question':{'open':False}},
            {'key':'task:scope-choice','title':'Choose','state':'captain','rev':'r1',
             'question':{'open':True,'call':None}}]
        publish_fixture(board,home,snapshot)
        cards=self.cards(board)
        kinds={k:cards[k]['activity']['kind'] for k in
               ('invoice-email','pricing-page','pricing-followup','device-trial','pilot-rollout','readme-badges')}
        self.assertEqual(kinds,{'invoice-email':'blocked','pricing-page':'blocked','pricing-followup':'blocked',
                                'device-trial':'held','pilot-rollout':'held','readme-badges':'ready'})
        self.assertEqual(cards['scope-choice']['activity']['kind'],'decision')

    def test_hold_and_pause_dates_come_only_from_exported_fields(self):
        board = self.board()
        today = self.cards(board)
        # The gate reason says "until <date>", but prose is never parsed for a date.
        gate = next(c for c in board.collector.snap.cols['charted'] if c.task == 'device-trial')
        self.assertTrue(gate.doing.startswith('until '))
        for task, gap in (('device-trial', 'hold_until'), ('cache-migration', 'wait_until'), ('log-rotation', 'wait_until')):
            self.assertEqual((today[task]['activity']['until'], today[task]['activity']['gap']), ('', gap), task)
        present = self.cards(self.board(firstmate_fields=True))
        self.assertEqual(present['device-trial']['activity']['kind'], 'deferred')
        self.assertRegex(present['device-trial']['activity']['until'], r'^\d{4}-\d{2}-\d{2}$')
        self.assertEqual(present['cache-migration']['activity']['kind'], 'paused')
        self.assertRegex(present['cache-migration']['activity']['until'], r'^\d{4}-\d{2}-\d{2}T15:00:00\+00:00$')
        self.assertFalse(any(c['activity']['gap'] for c in present.values()))

    def test_a_passed_pause_date_or_hold_is_not_presented_as_current(self):
        board = self.board(True)
        card = next(c for c in board.collector.snap.cols['underway'] if c.task == 'cache-migration')
        card.wait_until = '2020-01-01T00:00:00Z'
        gate = next(c for c in board.collector.snap.cols['charted'] if c.task == 'device-trial')
        self.assertEqual(gate.hold_bucket, 'dated')
        gate.hold_until = '2020-01-01'
        cards = self.cards(board)
        self.assertEqual((cards['cache-migration']['activity']['kind'], cards['cache-migration']['activity']['until']), ('paused', ''))
        self.assertEqual((cards['device-trial']['activity']['kind'], cards['device-trial']['activity']['until']), ('held', ''))
        card.wait_until = ''
        card.hold_bucket, card.hold_until = 'dated', '2020-01-01'
        self.assertEqual((f.card_activity(card)['kind'], f.card_activity(card)['until']), ('held', ''))
        card.hold_until = '2999-01-01'
        self.assertEqual((f.card_activity(card)['kind'], f.card_activity(card)['until']), ('deferred', '2999-01-01'))

    def test_a_malformed_or_offsetless_pause_date_never_breaks_the_board(self):
        board = self.board(True)
        card = next(c for c in board.collector.snap.cols['underway'] if c.task == 'cache-migration')
        cases = {'2999-01-01': '2999-01-01T00:00:00+00:00', '2999-01-01T15:00:00': '2999-01-01T15:00:00+00:00',
                 '2999-01-01T15:00:00+02:00': '2999-01-01T15:00:00+02:00', '2020-01-01': '', '2020-01-01T15:00:00': ''}
        for value, until in cases.items():
            card.wait_until = value
            self.assertEqual(self.cards(board)['cache-migration']['activity'], {'kind': 'paused', 'agent': 'none', 'until': until, 'gap': '', 'seen_at': 0.0}, value)
        card.wait_until = 'soon'
        self.assertEqual(self.cards(board)['cache-migration']['activity'], {'kind': 'paused', 'agent': 'none', 'until': '', 'gap': 'wait_until', 'seen_at': 0.0})
        gate = next(c for c in board.collector.snap.cols['charted'] if c.task == 'device-trial')
        gate.hold_until = 'later'
        self.assertEqual(self.cards(board)['device-trial']['activity'], {'kind': 'held', 'agent': '', 'until': '', 'gap': '', 'seen_at': 0.0})

    @unittest.skipUnless(hasattr(time, 'tzset'), 'needs time.tzset')
    def test_hold_day_is_compared_with_the_local_calendar_day(self):
        gate = next(c for c in self.board(True).collector.snap.cols['charted'] if c.task == 'device-trial')
        # One of these zones is on a different calendar day than UTC at any instant.
        for zone in ('Etc/GMT-14', 'Etc/GMT+12'):
            try:
                with patch.dict(os.environ, TZ=zone):
                    time.tzset()
                    today = date.today()
                    gate.hold_until = today.isoformat()
                    self.assertEqual(f.card_activity(gate)['kind'], 'held', zone)
                    gate.hold_until = (today + timedelta(days=1)).isoformat()
                    self.assertEqual((f.card_activity(gate)['kind'], f.card_activity(gate)['until']), ('deferred', gate.hold_until), zone)
            finally:
                time.tzset()

    def test_state_source_separates_agent_from_validation_when_flow_source_is_replaced(self):
        card = next(c for c in self.board(True).collector.snap.cols['underway'] if c.task == 'release-notes')
        card.flow = dict(card.flow, source='backlog.hold_reason', reason='Held for review')
        card.doing = 'Held for review'
        self.assertEqual(f.card_activity(card)['kind'], 'validating')
        card.state_source = ''
        # With no known source, a fresh validation run still marks validation.
        self.assertEqual(f.card_activity(card)['kind'], 'validating')
        card.run_step = {}
        # Without either signal Firstmate's working verdict is not live evidence.
        self.assertEqual((f.card_activity(card)['kind'], f.card_activity(card)['agent']), ('paused', 'open'))
        for source, kind in (('pane', 'working'), ('run-step', 'validating'), ('status-log', 'paused'),
                             ('remote-endpoint', 'paused'), ('none', 'paused'), ('later', 'paused')):
            card.state_source = source
            self.assertEqual(f.card_activity(card)['kind'], kind, source)
            self.assertEqual(f.activity_counts([card]).get('working', 0), int(kind == 'working'), source)

    def test_missing_endpoint_export_degrades_to_unknown_presence(self):
        data = activity_fleet.payload()
        data.pop('endpoints')
        home = f.Home('Firstmate', str(Path(self.tmp.name) / 'home'), 'captain')
        cols, _ = f.make_cards(home, data, {}, {}, {}, [home])
        agents = {c.task: f.card_activity(c)['agent'] for c in cols['underway']}
        self.assertEqual(agents['cache-migration'], 'unknown')
        self.assertEqual(agents['notes-sync'], 'unknown')
        self.assertEqual(agents['api-pagination'], 'working')

    def test_unknown_codex_survives_the_actual_board_http_path(self):
        from fixtures import fixture, start_fixture, publish_fixture
        board, home = fixture(Path(self.tmp.name) / 'http')
        start_fixture(board, home)
        self.addCleanup(board.stop)
        snapshot = json.loads((Path(home.path) / 'work-snapshot.json').read_text())
        snapshot['tasks'] = [
            {'key':'task:unknown','title':'Unconfirmed','state':'running','rev':'r1',
             'worker_liveness':{'state':'unknown','verdict':'unverified'},'question':{'open':False}},
            {'key':'task:resolved','title':'Resolved dependency','state':'running','rev':'r1',
             'worker_liveness':{'state':'unknown','verdict':'unverified'},'question':{'open':False},
             'blocked_by':[{'ref':'task:previous','open':False}]},
            {'key':'task:reconcile','title':'Missing archived dependency','state':'running','rev':'r1',
             'worker_liveness':{'state':'unknown','verdict':'unverified'},'question':{'open':False},
             'blocked_by':[{'ref':'task:archived','open':True}]}]
        publish_fixture(board, home, snapshot)
        server = bridge.Server((bridge.LOOPBACK, 0), board, bridge.Security(8787))
        server.security = bridge.Security(server.server_port)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            client = http.client.HTTPConnection(bridge.LOOPBACK, server.server_port, timeout=5)
            client.request('GET', '/api/board')
            response = client.getresponse()
            self.assertEqual(response.status, 200)
            data = json.loads(response.read())
            client.close()
            cards = {c['task']: c for col in data['columns'] for c in col['cards']}
            self.assertEqual(set(cards), {'unknown', 'resolved', 'reconcile'})
            for card in cards.values():
                self.assertTrue(card['native']['unconfirmed'])
                self.assertEqual(card['activity']['agent'], 'unknown')
                self.assertNotEqual(card['activity']['kind'], 'working')
            self.assertFalse(cards['resolved']['dependencies'][0]['unresolved'])
            self.assertTrue(cards['reconcile']['dependencies'][0]['unresolved'])
            self.assertFalse((Path(home.path) / 'mutations.jsonl').exists())
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    def test_language_changes_labels_only(self):
        from fixtures import fixture, start_fixture
        english_board, home = fixture(Path(self.tmp.name) / 'language')
        start_fixture(english_board,home);self.addCleanup(english_board.stop)
        spanish_board=bridge.Board(english_board.data_dir,collector=english_board.collector,language='es')
        spanish_board.collector=english_board.collector
        start_fixture(spanish_board,home);self.addCleanup(spanish_board.stop)
        spanish = self.cards(spanish_board)
        english = self.cards(english_board)
        self.assertTrue(english)
        self.assertEqual({k: v['activity'] for k, v in spanish.items()}, {k: v['activity'] for k, v in english.items()})

    def terminal(self, snap):
        ui = f.UI()
        ui.collector.snapshot = lambda: snap
        frames = []
        with patch.object(f.shutil, 'get_terminal_size', return_value=os.terminal_size((184, 40))), \
                patch.object(ui, 'paint', side_effect=lambda rows, *_: frames.append(rows)):
            ui.render(snap, force=True)
        return '\n'.join(f._ANSI_RE.sub('', row) for row in frames[-1])

    def test_terminal_underway_heading_counts_agents_working_now(self):
        snap = self.board().collector.snap
        text = self.terminal(snap)
        self.assertIn('Underway (11 · ●3 working)', text)
        badges = {c.task: c.badge for c in snap.cols['underway']}
        self.assertEqual(sorted(k for k, b in badges.items() if b == '● shipping'), ['api-pagination', 'docs-refresh', 'search-index'])
        self.assertEqual(badges['queue-retry'], '? unknown')

    def test_a_retained_snapshot_after_a_failed_refresh_never_claims_work_now(self):
        from fixtures import fixture, start_fixture, publish_fixture
        board, home = fixture(Path(self.tmp.name) / 'retained')
        start_fixture(board, home)
        self.addCleanup(board.stop)
        root = Path(home.path)
        snapshot = json.loads((root / 'work-snapshot.json').read_text())
        task = next(row for row in snapshot['tasks'] if row['key'] == 'task:web')
        task['worker_liveness'] = {'state': 'alive'}
        publish_fixture(board, home, snapshot)
        journal = root / 'state/fleet-ledger.jsonl'
        with journal.open('a') as out:
            out.write(json.dumps({'home': str(root.resolve()), 'event': 'agent.activity',
                                  'task': 'web', 'value': {'gen': 'fixture', 'seq': 1, 'state': 'busy'}}) + '\n')
        projection = board.projection
        with projection.condition:
            self.assertTrue(projection.condition.wait_for(
                lambda: projection.readers[bridge.home_id(home)]['model'].activity.get('web'), timeout=5))
        self.assertEqual(self.cards(board)['web']['activity']['kind'], 'working')
        with journal.open('a') as out:
            out.write('invalid event\n')
        with projection.condition:
            self.assertTrue(projection.condition.wait_for(lambda: bool(projection.error), timeout=5))
        self.assertFalse(board.board()['deck']['sources'][0]['available'])
        self.assertNotEqual(self.cards(board)['web']['activity']['kind'], 'working')


if __name__ == '__main__':
    unittest.main()
