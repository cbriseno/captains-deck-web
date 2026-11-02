"""Settings contract transport in disposable homes; never installed configuration."""
import json
import os
from pathlib import Path
import tempfile
import unittest
import subprocess
from unittest.mock import patch

from fixtures import fixture, bridge
from relay_fixture import extension_fixture
from relay_settings import RelaySettings
from deck_control import ControlError


class RelaySettingsTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name)
        self.env=patch.dict(os.environ,HOME=str(self.root),XDG_CONFIG_HOME=str(self.root/'xdg'),HERDR_PLUGIN_STATE_DIR=str(self.root/'plugin-state'))
        self.env.start();self.addCleanup(self.env.stop)
        self.board,self.home=fixture(self.root)
        self.extension=extension_fixture(self.root/'extension',self.home.path)
        self.adapter=RelaySettings(self.board.child_env,str(self.extension))

    def body(self, **fields):
        return dict(action='threshold',harness='codex',value='umbral:80%',revision=self.adapter.source(self.home)['revision'],request_id='a'*32,**fields)

    def state(self):
        return json.loads((Path(self.home.path)/'extension-state.json').read_text())

    def test_read_projects_owner_text_and_keeps_auto_off(self):
        data=self.adapter.source(self.home)
        self.assertTrue(data['available']);self.assertFalse(data['relay']['auto_enabled'])
        self.assertEqual(data['relay']['mode'],'assisted')
        self.assertEqual(data['relay']['thresholds'][1]['value'],'umbral:600K o compactaciones:5')
        self.assertEqual(data['planning']['installation_default'],'native')
        self.assertFalse(self.state().get('automatic_enabled',False))
        calls=[json.loads(line) for line in (Path(self.home.path)/'extension-calls.jsonl').read_text().splitlines()]
        self.assertTrue(all(row['home']==self.home.path and row['xdg']==str(self.root/'xdg') for row in calls))
        self.assertTrue(all(row['args'][1] in ('status','preflight') for row in calls))

    def test_missing_extension_and_missing_firstmate_are_unavailable_without_writes(self):
        self.assertEqual(RelaySettings(self.board.child_env).source(self.home),{'available':False,'actions':[]})
        (Path(self.home.path)/'bin/fm-tasks-axi.sh').unlink()
        self.assertFalse(self.adapter.source(self.home)['available'])
        self.assertFalse((Path(self.home.path)/'extension-calls.jsonl').exists())
        self.adapter.proof_dir=self.root/'proof'
        with self.assertRaises(ControlError):self.adapter.request(self.home,'apply',dict(action='automatic',enabled=True,revision='1',request_id='missing-owner-001',preview='bad.token',captain_words='Enable'))
        self.assertFalse((self.root/'proof').exists())

    def test_revision_guard_preview_apply_and_owner_undo(self):
        body=self.body();preview=self.adapter.request(self.home,'preview',body)
        self.assertTrue(preview['allowed']);self.assertEqual(self.state()['generation'],1)
        applied=self.adapter.request(self.home,'apply',dict(body,preview=preview['token']))
        self.assertEqual(applied['state'],'applied');self.assertEqual(applied['request_id'],body['request_id'])
        repeated=self.adapter.request(self.home,'apply',dict(body,preview=preview['token']))
        self.assertEqual(repeated,applied);self.assertEqual(self.state()['generation'],2)
        self.assertEqual(repeated['state'],'applied')
        self.assertEqual(self.state()['thresholds']['codex'],'umbral:80%')
        stale=self.adapter.request(self.home,'preview',dict(body,request_id='b'*32))
        self.assertEqual(stale['code'],'stale_revision')
        undo=dict(action='undo',undo_operation=applied['undo'],revision=applied['revision'],request_id='c'*32)
        review=self.adapter.request(self.home,'preview',undo)
        self.assertEqual(self.adapter.request(self.home,'apply',dict(undo,preview=review['token']))['state'],'applied')
        self.assertEqual(self.state()['thresholds']['codex'],'umbral:600K o compactaciones:5')

    def test_activation_requires_review_words_and_current_extension_preflight(self):
        body=dict(action='automatic',enabled=True,revision=self.adapter.source(self.home)['revision'],request_id='d'*32)
        with self.assertRaises(ControlError):self.adapter.request(self.home,'apply',body)
        preview=self.adapter.request(self.home,'preview',body)
        for words in ('','  '):
            with self.assertRaises(ControlError):self.adapter.request(self.home,'apply',dict(body,preview=preview['token'],captain_words=words))
        words='  Actívalo exactamente así; "$()"\ncon mi confirmación.  '
        result=self.adapter.request(self.home,'apply',dict(body,preview=preview['token'],captain_words=words))
        self.assertEqual(result['state'],'rejected');self.assertFalse(self.state().get('automatic_enabled',False))
        calls=[json.loads(line)['args'] for line in (Path(self.home.path)/'extension-calls.jsonl').read_text().splitlines()]
        authorize=next(args for args in calls if args[1]=='authorize')
        self.assertEqual(authorize[authorize.index('--captain-words')+1],words)
        value=self.state();value['can_authorize']=False
        (Path(self.home.path)/'extension-state.json').write_text(json.dumps(value))
        refused=self.adapter.request(self.home,'apply',dict(body,preview=preview['token'],captain_words=words))
        self.assertEqual(refused['code'],'authorization_required')
        calls=[json.loads(line)['args'] for line in (Path(self.home.path)/'extension-calls.jsonl').read_text().splitlines()]
        self.assertEqual(sum(args[1]=='authorize' for args in calls),1)

    def test_planning_scopes_and_unsupported_input_never_choose_a_command_or_path(self):
        for body in ({'action':'shell'}, {'action':'planning','scope':'other','mode':'native'},
                     {'action':'automatic','enabled':'true'}, {'action':'threshold','harness':'other','value':'umbral:80%'}):
            with self.assertRaises(ControlError):self.adapter.request(self.home,'preview',dict(body,revision='1',request_id='e'*32))
        self.assertFalse((Path(self.home.path)/'extension-calls.jsonl').exists())

    def test_a_single_harness_refusal_blocks_global_authorization(self):
        value=self.state();value['blocked_harness']='codex'
        (Path(self.home.path)/'extension-state.json').write_text(json.dumps(value))
        source=self.adapter.source(self.home);self.assertFalse(source['relay']['can_authorize'])
        preview=self.adapter.request(self.home,'preview',dict(action='automatic',enabled=True,revision=source['revision'],request_id='one-harness-0001'))
        self.assertFalse(preview['allowed'])
        calls=(Path(self.home.path)/'extension-calls.jsonl').read_text();self.assertNotIn('"authorize"',calls)

    def test_arbitrary_paths_are_not_scope_selectors(self):
        with self.assertRaises(ControlError):self.adapter.request(self.home,'preview',dict(action='planning',scope='project',mode='native',selection=str(self.root),target=str(self.root),revision='1',request_id='bad-selector-001'))
        self.assertEqual(self.state()['generation'],1)

    def test_disabling_also_requires_the_captains_literal_confirmation(self):
        body=dict(action='automatic',enabled=False,revision='1',request_id='h'*32)
        preview=self.adapter.request(self.home,'preview',body)
        with self.assertRaises(ControlError):self.adapter.request(self.home,'apply',dict(body,preview=preview['token']))
        words='Desactívalo.  Conserva estas palabras.'
        receipt=self.adapter.request(self.home,'apply',dict(body,preview=preview['token'],captain_words=words))
        self.assertEqual(receipt['state'],'applied');self.assertIsNone(receipt['undo'])
        calls=[json.loads(line)['args'] for line in (Path(self.home.path)/'extension-calls.jsonl').read_text().splitlines()]
        off=next(args for args in calls if args[1]=='off')
        self.assertEqual(off[off.index('--captain-words')+1],words)
        self.assertFalse(self.state().get('automatic_enabled',False))

    def test_preview_is_bound_to_the_reviewed_change_and_unconfirmed_exits_are_not_success(self):
        body=self.body();preview=self.adapter.request(self.home,'preview',body)
        with self.assertRaises(ControlError):
            self.adapter.request(self.home,'apply',dict(body,preview=preview['token'],value='compactaciones:9'))
        self.assertEqual(self.state()['generation'],1)
        for output,code in [('not JSON',0),(json.dumps({'schema':'fm-extension-settings-receipt.v1','state':'applied','request_id':body['request_id']}),1)]:
            with self.subTest(output=output), patch('relay_settings.subprocess.run',return_value=subprocess.CompletedProcess([],code,output,'')):
                with self.assertRaises(ControlError) as raised:self.adapter.invoke(self.home,'set',receipt=True)
                self.assertEqual(raised.exception.code,'receipt-uncertain')


class RelayHTTPTests(unittest.TestCase):
    # Reuse the request harness, without inheriting/rerunning unrelated tests.
    from test_bridge import WebTests as _Harness
    setUp=_Harness.setUp
    stop=_Harness.stop
    req=_Harness.req
    init=_Harness.init

    def configure(self):
        root=extension_fixture(self.root/'extension',self.home.path)
        self.board.relay_settings=RelaySettings(self.board.child_env,str(root))
        env=patch.dict(os.environ,HOME=str(self.root),XDG_CONFIG_HOME=str(self.root/'xdg'))
        env.start();self.addCleanup(env.stop)
        self.init()
        return '/api/settings/'+bridge.home_id(self.home)

    def test_unavailable_is_a_readable_state_and_unknown_owner_cannot_invoke(self):
        self.init();route='/api/settings/'+bridge.home_id(self.home)
        status,data=self.req(route);self.assertEqual(status,200);self.assertFalse(data['available'])
        status,_=self.req('/api/settings/'+'f'*32);self.assertEqual(status,404)
        self.assertFalse((Path(self.home.path)/'extension-calls.jsonl').exists())

    def test_write_has_same_origin_csrf_and_local_owner_guards(self):
        route=self.configure()
        body=dict(action='threshold',harness='codex',value='umbral:80%',revision='1',request_id='f'*32)
        with patch.object(self.board.relay_settings,'request') as request:
            for headers in ({'X-Deck-CSRF':'wrong'},{'Origin':'https://foreign.example'}):
                status,_=self.req(route+'/preview',body,headers=headers);self.assertEqual(status,403)
            with patch.object(bridge.fm,'is_remote_home',return_value=True), patch.object(self.board,'home',return_value=self.home):
                status,data=self.req(route);self.assertEqual(status,200);self.assertFalse(data['available'])
                status,_=self.req(route+'/apply',body);self.assertEqual(status,403)
            request.assert_not_called()

    def test_http_activation_needs_the_deliberate_review_and_own_words(self):
        route=self.configure()
        body=dict(action='automatic',enabled=True,revision='1',request_id='g'*32)
        status,data=self.req(route+'/apply',dict(body,captain_words='Please enable'))
        self.assertEqual(status,409);self.assertEqual(data['code'],'preview-required')
        status,preview=self.req(route+'/preview',body);self.assertEqual(status,200)
        status,data=self.req(route+'/apply',dict(body,preview=preview['token']))
        self.assertEqual(status,400);self.assertEqual(data['code'],'authorization_required')
        calls=(Path(self.home.path)/'extension-calls.jsonl').read_text()
        self.assertNotIn('"authorize"',calls)


@unittest.skipUnless(os.environ.get('CD_TEST_EXTENSIONS_ROOT'), 'Set CD_TEST_EXTENSIONS_ROOT for isolated real-CLI acceptance')
class RealExtensionTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
        self.env=patch.dict(os.environ,HOME=str(self.root),XDG_CONFIG_HOME=str(self.root/'xdg'),
            XDG_STATE_HOME=str(self.root/'state'),XDG_DATA_HOME=str(self.root/'data'),
            CODEX_HOME=str(self.root/'codex'),CLAUDE_CONFIG_DIR=str(self.root/'claude'),HERDR_PLUGIN_STATE_DIR=str(self.root/'plugin'))
        self.env.start();self.addCleanup(self.env.stop)
        self.board,self.home=fixture(self.root);home=Path(self.home.path)
        (home/'config').mkdir();(home/'config/context-relay.json').write_text(json.dumps({'relay_mode':'assisted'}))
        (home/'config/umbrales-relevo').write_text('claude: compactaciones:2 umbral:80%\ncodex: compactaciones:4\n')
        (home/'bin/fm-tasks-axi.sh').write_text('#!/bin/sh\nexit 0\n')
        self.project=home/'projects/demo';self.project.mkdir(parents=True)
        self.nodes=[{'id':'project:demo','kind':'project','title':'Demo project','raw':{'repository_project':'project:demo'}},
                    {'id':'task:pending','kind':'task','task':'pending','title':'Pending task','raw':{'repository_project':'project:demo'}}]
        self.adapter=self.new_adapter()

    def new_adapter(self):
        return RelaySettings(self.board.child_env,os.environ['CD_TEST_EXTENSIONS_ROOT'],nodes=lambda home:self.nodes,proof_dir=self.root/'proof')

    def request(self,operation,selection='',request_id='real-request-0001'):
        source=self.adapter.source(self.home,selection);self.assertTrue(source['available'])
        body=dict(operation,selection=selection,revision=source['revision'],request_id=request_id)
        preview=self.adapter.request(self.home,'preview',body)
        self.assertTrue(preview['allowed'],preview)
        return body,preview

    def test_real_reads_do_not_create_state_and_activation_fails_closed(self):
        def files():return {str(p.relative_to(self.root)):p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        before=files();source=self.adapter.source(self.home)
        self.assertTrue(source['available']);self.assertFalse(source['relay']['auto_enabled']);self.assertFalse(source['relay']['can_authorize'])
        preview=self.adapter.request(self.home,'preview',dict(action='automatic',enabled=True,revision=source['revision'],request_id='real-blocked-001'))
        self.assertFalse(preview['allowed']);self.assertEqual(files(),before)

    def test_real_threshold_idempotency_undo_and_restart_keep_auto_off(self):
        original=(Path(self.home.path)/'config/umbrales-relevo').read_bytes()
        body,preview=self.request(dict(action='threshold',harness='codex',value='umbral:600K o compactaciones:5'))
        self.adapter=self.new_adapter()  # persisted disclosure, no transport queue
        applied=self.adapter.request(self.home,'apply',dict(body,preview=preview['token']))
        self.assertEqual(applied['state'],'applied',applied)
        self.assertEqual(self.adapter.request(self.home,'apply',dict(body,preview=preview['token'])),applied)
        undo,review=self.request(dict(action='undo',undo_operation=applied['undo']),request_id='real-undo-000001')
        self.assertEqual(self.adapter.request(self.home,'apply',dict(undo,preview=review['token']))['state'],'applied')
        self.assertEqual((Path(self.home.path)/'config/umbrales-relevo').read_bytes(),original)
        self.assertFalse(self.adapter.source(self.home)['relay']['auto_enabled'])

    def test_real_all_four_planning_scopes_use_deck_known_identities(self):
        for index,(scope,mode) in enumerate([('installation','native'),('home','speckit'),('project','native'),('task','speckit')]):
            source=self.adapter.source(self.home)
            selection=source['planning']['targets'][scope][0]['id'] if scope in ('project','task') else ''
            operation=dict(action='planning',scope=scope,mode=mode,target=selection or None)
            body,preview=self.request(operation,selection,request_id='real-scope-'+str(index).zfill(8))
            result=self.adapter.request(self.home,'apply',dict(body,preview=preview['token']))
            self.assertEqual(result['state'],'applied',result)
            selected=self.adapter.selection(self.home,selection)
            self.assertEqual(self.adapter.snapshot(self.home,selected)['planning']['scopes'][scope]['mode'],mode)
        self.assertFalse(self.adapter.source(self.home)['relay']['auto_enabled'])

    def test_real_off_records_verbatim_words_and_uses_assisted_mode(self):
        body,preview=self.request(dict(action='automatic',enabled=False),request_id='real-off-0000001')
        words='  Desactiva el relevo automático.\nConserva mis palabras.  '
        result=self.adapter.request(self.home,'apply',dict(body,preview=preview['token'],captain_words=words))
        self.assertEqual(result['state'],'applied',result)
        entries=[json.loads(line) for line in (Path(self.home.path)/'data/context-relay/automatic-events.jsonl').read_text().splitlines()]
        self.assertTrue(any(row.get('captain_words')==words and row.get('mode')=='assisted' for row in entries))
        source=self.adapter.source(self.home);self.assertEqual(source['relay']['mode'],'assisted');self.assertFalse(source['relay']['auto_enabled'])


if __name__=='__main__':unittest.main()
