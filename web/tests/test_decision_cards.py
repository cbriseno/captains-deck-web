"""Synthetic decision cards retain choices across the web and terminal boards."""
import contextlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from fixtures import fixture, bridge, start_fixture

f = bridge.fm
ROOT = Path(__file__).resolve().parents[2]
TASKS = ['sample-decision']
CARD = {'key': TASKS[0], 'type': 'decision', 'title': 'Sample decision',
        'about': 'Sample background', 'decide': 'Choose an option', 'detail': 'Sample instructions',
        'options': [{'value': 'yes', 'label': 'Yes'}, {'value': 'no', 'label': 'No'}],
        'recommend_value': 'yes', 'allow_freeform': True}
ANSI = re.compile(r'\x1b\[[0-9;?]*[A-Za-z]')
CALL = {'question': '¿Quito las dos entradas?', 'context': 'Contexto corto de la llamada.',
        'options': [{'id': 'si', 'label': 'Sí, ya'}, {'id': 'no', 'label': 'Mejor no'}], 'recommended': 'no'}


def authored(task):
    return dict(CARD, key=task)


def row(task, **extra):
    return {'id': task, 'title': authored(task)['title'], 'owner': '(main)', 'reason': 'Respuesta humana pendiente',
            'flow': {'phase': 'human', 'state': 'held', 'reason': 'Falta tu respuesta.',
                     'next_action': 'Responder con una opción.'}, **extra}


class DecisionCardTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        env = patch.dict(os.environ, CD_WEB_LANGUAGE='es-MX', HERDR_PLUGIN_STATE_DIR=str(self.root / 'state'))
        env.start(); self.addCleanup(env.stop)
        # The terminal board loads the installation language once per process.
        self.addCleanup(setattr, f, '_LOCALIZATION', None); f._LOCALIZATION = None

    def board(self, rows):
        board, home = fixture(self.root / str(len(list(self.root.iterdir()))))
        for task in TASKS:
            (Path(home.path) / 'state' / 'decision-cards' / f'{task}.json').write_text(
                json.dumps({'schema': 'fm-decision-card.v1', 'card': authored(task)}))
        start_fixture(board, home)
        self.addCleanup(board.stop)
        snapshot = json.loads((Path(home.path) / 'work-snapshot.json').read_text())
        snapshot['tasks'] = [dict(key='task:' + row['id'], title=row['title'], project='project:fixture',
            state='captain', rev='r1', body='Captain hold set: 2026-10-25T15:00:00Z',
            question={'open': True, 'call': row.get('call')}) for row in rows]
        from fixtures import publish_fixture
        publish_fixture(board, home, snapshot)
        cards = {c.task: c for c in board.view_cards()['captains_call']}
        return board, home, cards

    def tickets(self, board, cards):
        tickets = {}
        for task, card in cards.items():
            ticket = board.ticket(board.key(card))
            self.assertFalse(ticket['call']['error'], task)
            tickets[task] = json.loads(json.dumps(ticket))
        return tickets

    def dialog(self, card, home):
        return f.DecisionDialog(f.decision_card_content(card, [home], home))

    def dialog_text(self, dialog, home):
        snap = f.Snapshot(); snap.homes = [home]; snap.home = home
        snap.cols = {key: [] for key, _ in f.COLUMNS}; snap.totals = {}
        snap.activity = {}; snap.counts = {home.label: 1}; snap.collected_at = f.time.time()
        snap.loading = False; snap.error = ''
        ui = f.UI(); ui.dialog = dialog
        frame = io.StringIO()
        with contextlib.redirect_stdout(frame):
            ui.render(snap)
        return [ANSI.sub('', line) for line in frame.getvalue().split('\x1b[K')]

    def render_web(self, tickets, expected):
        data = self.root / 'dom.json'
        data.write_text(json.dumps({'tickets': {t['key']: t for t in tickets.values()},
                                    'expected': {tickets[task]['key']: want for task, want in expected.items()}}))
        result = subprocess.run(['node', str(Path(__file__).with_name('decision_cards_dom.cjs')), str(data)],
                                capture_output=True, text=True, timeout=120)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_cards_without_call_offer_their_options_on_both_boards(self):
        board, home, cards = self.board([row(task) for task in TASKS])
        self.assertEqual(sorted(cards), TASKS)
        self.assertTrue(all(card.call == {} for card in cards.values()))
        tickets = self.tickets(board, cards)
        columns = {c['id']: c for c in board.board()['columns']}
        self.assertEqual({c['task']: c['question'] for c in columns['captains_call']['cards']}, {t: '' for t in TASKS})
        recheck = f.tr(' REC ').strip()
        self.assertEqual(recheck, 'RECOM.')
        expected = {}
        for task in TASKS:
            card = authored(task)
            values = [o['value'] for o in card['options']]
            labels = [o['label'] for o in card['options']]
            call = tickets[task]['call']
            # Web: the card's options plus the re-check, the recommendation and Spanish chrome.
            self.assertEqual([o['value'] for o in call['options']], values + ['reconcile'], task)
            self.assertEqual(call['recommend'], card['recommend_value'], task)
            self.assertEqual([o['label'] for o in call['presentation']['options']], labels + ['Revisar otra vez primero'], task)
            self.assertEqual(call['decide'], card['decide'], task)
            self.assertEqual(call['title'], card['title'], task)
            self.assertTrue(call['freeform'], task)
            expected[task] = {'values': values, 'labels': labels, 'recommend': card['recommend_value']}
            # Terminal: the recommendation starts selected and carries the REC chip.
            dialog = self.dialog(cards[task], home)
            self.assertEqual([o['value'] for o in dialog.options], values + ['reconcile'], task)
            self.assertEqual(dialog.selected_option()['value'], card['recommend_value'], task)
            self.assertEqual(dialog.keyed_line().split('\t')[1], card['recommend_value'], task)
            lines = self.dialog_text(dialog, home)
            recommended = next(o['label'] for o in card['options'] if o['value'] == card['recommend_value'])
            chosen = [line for line in lines if recommended in line]
            self.assertTrue(chosen and all(recheck in line and '●' in line for line in chosen), (task, chosen))
            others = [line for line in lines if any(label in line for label in labels if label != recommended)]
            self.assertTrue(all(recheck not in line and '○' in line for line in others), (task, others))
            self.assertTrue(any('Revisar otra vez primero' in line for line in lines), task)
        self.render_web(tickets, expected)
        self.assertFalse((Path(home.path) / 'mutations.jsonl').exists())

    def test_call_options_win_over_the_card_and_keep_its_title(self):
        task = TASKS[0]
        card = authored(task)
        board, home, cards = self.board([row(task, call=CALL)])
        ticket = self.tickets(board, cards)[task]
        call = ticket['call']
        self.assertEqual([o['value'] for o in call['options']], ['si', 'no', 'reconcile'])
        self.assertEqual(call['recommend'], 'no')
        self.assertEqual((call['title'], call['detail']), (card['title'], card['detail']))
        self.assertEqual(call['decide'], CALL['question'])
        self.assertEqual((call['about'], call['background']), (CALL['context'], card['about']))
        self.assertEqual(ticket['question'], CALL['question'])
        dialog = self.dialog(cards[task], home)
        self.assertEqual(dialog.selected_option()['value'], 'no')
        self.render_web({task: ticket}, {task: {'values': ['si', 'no'], 'labels': ['Sí, ya', 'Mejor no'], 'recommend': 'no'}})

    def test_call_options_without_recommendation_never_borrow_the_cards(self):
        task = TASKS[0]
        board, home, cards = self.board([row(task, call=dict(CALL, recommended=''))])
        call = self.tickets(board, cards)[task]['call']
        self.assertEqual([o['value'] for o in call['options']], ['si', 'no', 'reconcile'])
        self.assertEqual(call['recommend'], '')
        self.assertIsNone(self.dialog(cards[task], home).selected_option())

    def test_a_call_question_without_options_keeps_the_cards_choices(self):
        task = TASKS[0]
        card = authored(task)
        board, home, cards = self.board([row(task, call={'question': '¿Lo integro ya?'})])
        call = self.tickets(board, cards)[task]['call']
        self.assertEqual([o['value'] for o in call['options']], [o['value'] for o in card['options']] + ['reconcile'])
        self.assertEqual(call['recommend'], card['recommend_value'])
        self.assertEqual(call['decide'], '¿Lo integro ya?')
        self.assertEqual(self.dialog(cards[task], home).selected_option()['value'], card['recommend_value'])


if __name__ == '__main__':
    unittest.main()
