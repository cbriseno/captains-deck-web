"""Hold one actual HTTP board response after its owner read, in a disposable home."""
import json
from pathlib import Path
import runpy
import sys
import time

from fixtures import bridge

root = Path(sys.argv[1])
original = bridge.Board.board


def board(self, selected=''):
    result = original(self, selected)
    try:
        (root / 'delay-response').rename(root / 'response-held')
    except FileNotFoundError:
        return result
    (root / 'held-board.json').write_text(json.dumps(result))
    deadline = time.monotonic() + 18
    while not (root / 'release-response').exists():
        if time.monotonic() > deadline:
            raise RuntimeError('Test did not release the held response')
        time.sleep(.02)
    if (root / 'fail-response').exists():
        raise bridge.Refusal('Delayed fixture read failed.', 503)
    return result


bridge.Board.board = board
runpy.run_path(str(Path(__file__).with_name('approved_fixture.py')), run_name='__main__')
