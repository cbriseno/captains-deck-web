"""Materialize recorded synthetic inputs as a disposable producer fixture."""
import atexit
from pathlib import Path
import shutil
import tempfile

SOURCE = Path(__file__).resolve().parent / 'fixtures'


def create_fixture_tree(destination):
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(SOURCE / 'bearings_snapshot.json', destination / 'bearings_snapshot.json')
    owner = destination / 'owner'
    shutil.copytree(SOURCE / 'owner', owner)
    (owner / 'records').rename(owner / 'state')
    return destination


def materialized_fixtures():
    temporary = tempfile.TemporaryDirectory(prefix='deck-fixture-')
    atexit.register(temporary.cleanup)
    return create_fixture_tree(temporary.name)
