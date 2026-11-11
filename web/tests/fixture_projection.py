"""Disposable snapshot-backed projection, not the Firstmate engine."""


class Projection:
    def __init__(self, base):
        self.value = base['snapshot']
        self.rows = {row['key'][5:]: dict(row, id=row['key'][5:], name=row['title'],
                     body='', closed=None) for row in self.value['tasks']}
        self.presentations = {task: {'presentation': {}} for task in self.rows}
        self.history = {task for task, row in self.rows.items() if row['state'] == 'done'}
        self.activity, self.calls, self.messages = {}, {}, []

    def apply(self, event):
        if event.get('event') != 'fixture.snapshot':
            return False
        self.__init__({'snapshot': event['value']})
        return True
