"""Minimal event projection for the disposable Deck owner fixture."""


class Projection:
    def __init__(self, base):
        self.capabilities = {}
        self.install(base['snapshot'])

    def install(self, value):
        self.value = value
        tasks = [row for row in value.get('tasks', [])]
        self.rows = {row['key'].removeprefix('task:'): dict(row, id=row['key'].removeprefix('task:')) for row in tasks}
        self.presentations = {key: {'presentation': {'card_title': row.get('title'),
            'summary': '', 'status': ''}} for key, row in self.rows.items()}
        self.activity, self.status, self.calls, self.messages = {}, {}, {}, {}
        self.history = set()

    def apply(self, event):
        if event.get('event') != 'fixture.snapshot':
            return False
        self.install(event['value'])
        return True
