"""Keep terminal tests independent of the operator's Deck configuration."""
import os

import pytest


@pytest.fixture(autouse=True)
def isolated_deck_environment(monkeypatch, tmp_path):
    for name in os.environ:
        if name.startswith('FM_FLOW_') or name in ('FM_HOME', 'CD_WEB_LANGUAGE'):
            monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv('HERDR_PLUGIN_CONFIG_DIR', str(tmp_path / 'config'))
    monkeypatch.setenv('HERDR_PLUGIN_STATE_DIR', str(tmp_path / 'state'))
