"""Disposable snapshot-backed projection, not the Firstmate engine."""


class Projection:
    def __init__(self, base):
        self.value = base['snapshot']
        self.rows = {row['key'][5:]: dict(row, id=row['key'][5:], name=row['title'],
                     body=row.get('body', ''), closed=row.get('closed')) for row in self.value['tasks']}
        self.presentations = {task: {'presentation': row.get('presentation', {})} for task, row in self.rows.items()}
        self.history = {task for task, row in self.rows.items() if row['state'] == 'done'}
        self.activity, self.status, self.calls, self.messages = {}, {}, {}, []

    def apply(self, event):
        if event.get('event') == 'agent.activity':
            self.activity[event['task']] = event['value']
            return True
        if event.get('event') == 'task.status':
            task = event['task']
            self.status[task] = (self.status.get(task, '') + '\n' + (event.get('state') or '') +
                                 ' [at=' + str(event['ts']) + '] [key=' + str(event.get('key') or '') + ']: ' + event.get('text', ''))
            return True
        if event.get('event') != 'fixture.snapshot':
            return False
        self.__init__({'snapshot': event['value']})
        return True
