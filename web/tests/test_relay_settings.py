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

@unittest.skipUnless(os.environ.get('CD_TEST_EXTENSIONS_ROOT'), 'Set CD_TEST_EXTENSIONS_ROOT for isolated real-CLI acceptance')
class RealExtensionTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
        self.env=patch.dict(os.environ,HOME=str(self.root),XDG_CONFIG_HOME=str(self.root/'xdg'),
            XDG_STATE_HOME=str(self.root/'state'),XDG_DATA_HOME=str(self.root/'data'),
            CODEX_HOME=str(self.root/'codex'),CLAUDE_CONFIG_DIR=str(self.root/'claude'),HERDR_PLUGIN_STATE_DIR=str(self.root/'plugin'))
        self.env.start();self.addCleanup(self.env.stop)
        self.board,self.home=fixture(self.root);home=Path(self.home.path)
        (home/'config').mkdir();(home/'config/relay-lite.json').write_text(json.dumps({'threshold_tokens':250000}))
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

    def test_relay_cells_preserve_scalar_and_other_roles(self):
        initial=self.adapter.source(self.home)
        self.assertTrue(initial['available'])
        cells=initial['relay']['thresholds']
        self.assertEqual(len(cells),8)
        self.assertEqual(next(x for x in cells if x['role']=='primary' and x['harness']=='claude' and x['axis']=='tokens')['value'],250000)
        for role in ('primary','worker'):
            for harness in ('claude','codex'):
                for axis in ('percent','tokens'):
                    self.adapter.request(self.home,'apply',{'action':'threshold','role':role,'harness':harness,'axis':axis,'value':50 if axis=='percent' else 100})
        self.adapter.request(self.home,'apply',{'action':'threshold','role':'worker','harness':'codex','axis':'tokens','value':200})
        data=json.loads((Path(self.home.path)/'config/relay-lite.json').read_text())
        self.assertEqual(data['threshold_tokens'],250000)
        self.assertEqual(data['thresholds']['primary']['claude']['tokens'],100)
        self.assertEqual(data['thresholds']['worker']['codex']['tokens'],200)
        for value in (-1,101,True,'1'):
            with self.assertRaises(ControlError):
                self.adapter.request(self.home,'apply',{'action':'threshold','role':'worker','harness':'codex','axis':'percent','value':value})

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



if __name__=='__main__':unittest.main()
