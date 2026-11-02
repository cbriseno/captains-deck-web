"""Generic reverse-proxy configuration and identity ambiguity fail closed."""
from email.message import Message
from types import SimpleNamespace
import unittest

from fixtures import bridge


class ProxyAuthTests(unittest.TestCase):
    def test_partial_configuration_and_unsafe_headers_are_rejected(self):
        for origin, users, header in [
            ('https://deck.example.test', [], ''),
            ('', ['owner'], 'X-User'),
            ('https://deck.example.test', ['owner'], ''),
            ('https://deck.example.test', ['owner'], 'Host'),
            ('https://deck.example.test', ['owner'], 'X-Deck-CSRF'),
            ('https://deck.example.test', ['owner'], 'X-User\r\nInjected'),
        ]:
            with self.subTest(header=header), self.assertRaises(ValueError):
                bridge.Security(8787, origin, users, header)

    def test_disabled_proxy_cannot_accept_a_remote_authority(self):
        headers = Message()
        headers['Host'] = 'deck.example.test'
        headers['X-User'] = 'owner'
        with self.assertRaises(bridge.Refusal):
            bridge.Security(8787).check(SimpleNamespace(headers=headers))

    def test_duplicate_identity_is_rejected(self):
        headers = Message()
        headers['Host'] = 'deck.example.test'
        headers['X-User'] = 'owner'
        headers['X-User'] = 'intruder'
        security = bridge.Security(8787, 'https://deck.example.test', ['owner'], 'X-User')
        with self.assertRaises(bridge.Refusal):
            security.check(SimpleNamespace(headers=headers))


if __name__ == '__main__':
    unittest.main()
