"""Real local Supabase API + browser regression tests. No production access."""
import concurrent.futures
from datetime import date, timedelta
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import subprocess
import time
from pathlib import Path
import threading
import unittest
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import ProxyHandler, Request, build_opener
from uuid import uuid4
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
STATUS = json.loads((ROOT / 'tests/.runtime/status.json').read_text())
API = STATUS['API_URL']
if urlsplit(API).hostname not in ('127.0.0.1', 'localhost') or urlsplit(API).port != 55321:
    raise RuntimeError('Tests require the dedicated local API on port 55321')
ANON = STATUS['ANON_KEY']
SERVICE = STATUS['SERVICE_ROLE_KEY']
PASSWORD = 'Local-only-test-password-42!'
DAY = (date.today() + timedelta(days=7)).isoformat()
OPENER = build_opener(ProxyHandler({}))


def api(path, method='GET', body=None, token=None, service=False):
    key = SERVICE if service else ANON
    headers = {'apikey': key, 'Authorization': 'Bearer ' + (token or key),
               'Content-Type': 'application/json', 'Prefer': 'return=representation'}
    request = Request(API + path, data=None if body is None else json.dumps(body).encode(),
                      headers=headers, method=method)
    try:
        with OPENER.open(request, timeout=20) as response:
            raw = response.read()
            return response.status, json.loads(raw) if raw else None
    except HTTPError as error:
        return error.code, json.loads(error.read())


def ok(result):
    code, data = result
    if code >= 300:
        raise AssertionError(f'Local API HTTP {code}: {data}')
    return data


def rpc(name, body):
    return api('/rest/v1/rpc/' + name, 'POST', body)


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


class Regression(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.users = {}
        for role in ('admin', 'coordinatore', 'volontario', 'in_attesa', 'bloccato'):
            email = f'{role}-{uuid4().hex[:8]}@example.test'
            user = ok(api('/auth/v1/admin/users', 'POST', {
                'email': email, 'password': PASSWORD, 'email_confirm': True,
                'user_metadata': {'full_name': 'Test ' + role}}, service=True))
            ok(api('/rest/v1/profiles?id=eq.' + user['id'], 'PATCH', {'ruolo': role}, service=True))
            session = ok(api('/auth/v1/token?grant_type=password', 'POST', {'email': email, 'password': PASSWORD}))
            cls.users[role] = {**user, 'token': session['access_token']}
        cls.pw = sync_playwright().start()
        options = {'headless': True}
        if os.environ.get('CHROMIUM_PATH'):
            options['executable_path'] = os.environ['CHROMIUM_PATH']
        if os.environ.get('HTTPS_PROXY'):
            options['proxy'] = {'server': os.environ['HTTPS_PROXY'], 'bypass': '127.0.0.1,localhost'}
        cls.browser = cls.pw.chromium.launch(**options)
        cls.server = ThreadingHTTPServer(('127.0.0.1', 8765), partial(QuietHandler, directory=str(ROOT)))
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()
        cls.server.shutdown()
        cls.server.server_close()
        for user in reversed(list(cls.users.values())):
            ok(api('/auth/v1/admin/users/' + user['id'], 'DELETE', service=True))

    def setUp(self):
        self.booking_ids = []
        self.volunteer_ids = []
        self.expense_ids = []
        self.context = self.browser.new_context()
        self.errors = []
        self.context.on('page', lambda page: page.on('pageerror', lambda error: self.errors.append(str(error))))
        # Only config is replaced. All application code and API responses are real.
        self.context.route('**/config.js*', lambda route: route.fulfill(
            content_type='application/javascript', body='window.SALA_CONFIG = ' + json.dumps({
                'supabaseUrl': API, 'supabaseAnonKey': ANON}) + ';'))
        # Fail closed even if an application change accidentally uses the live project.
        self.context.route('**/*.supabase.co/**', lambda route: route.abort())

    def tearDown(self):
        self.context.close()
        for bid in self.booking_ids:
            ok(api('/rest/v1/schede?booking_id=eq.' + bid, 'DELETE', service=True))
            ok(api('/rest/v1/eventi_info?chiave=eq.b:' + bid, 'DELETE', service=True))
            ok(api('/rest/v1/bookings?id=eq.' + bid, 'DELETE', service=True))
        for eid in self.expense_ids:
            ok(api('/rest/v1/expenses?id=eq.' + eid, 'DELETE', service=True))
        for vid in self.volunteer_ids:
            ok(api('/rest/v1/volontari?id=eq.' + vid, 'DELETE', service=True))
        self.assertEqual(self.errors, [], 'Browser JavaScript errors')

    def booking(self):
        record = ok(api('/rest/v1/bookings', 'POST', {
            'titolo': 'Evento test ' + uuid4().hex[:8], 'data': DAY,
            'inizio': '18:00', 'fine': '22:00', 'stato': 'confermata',
            'prezzo': 500, 'incassato': 0, 'telefono': '3330000000',
            'turni': [{'id': 'porta', 'label': 'Accoglienza', 'inizio': '18:00', 'fine': '22:00', 'posti': 2}]
        }, token=self.users['admin']['token']))[0]
        self.booking_ids.append(record['id'])
        return record

    def volunteers(self):
        records = ok(api('/rest/v1/volontari', 'POST', [{'nome': 'Test Ada'}, {'nome': 'Test Bruno'}], service=True))
        self.volunteer_ids.extend(v['id'] for v in records)
        return records

    def login(self, role="admin"):
        page = self.context.new_page()
        page.goto('http://127.0.0.1:8765/')
        expect(page.locator('#screen-login')).to_be_visible()
        page.locator('.login-pw summary').click()
        page.locator('#login-email').fill(self.users[role]['email'])
        page.locator('#login-password').fill(PASSWORD)
        page.locator('#login-pw button').click()
        expect(page.locator('#app')).to_be_visible(timeout=30000)
        return page

    def test_booking_created_in_browser_survives_reload(self):
        page = self.login()
        title = 'Prenotazione browser ' + uuid4().hex[:8]
        page.locator('#btn-new').click()
        page.locator('#b-titolo').fill(title)
        page.locator('#b-data').fill(DAY)
        page.locator('#b-inizio').fill('18:00')
        page.locator('#b-fine').fill('22:00')
        page.locator('#b-stato').select_option('confermata')
        try:
            page.locator('#b-submit').click()
            expect(page.locator('#dlg-booking')).not_to_be_visible(timeout=20000)
            page.reload()
            expect(page.locator('#app')).to_be_visible(timeout=30000)
            page.goto('http://127.0.0.1:8765/#prenotazioni')
            expect(page.get_by_text(title, exact=True).first).to_be_visible(timeout=20000)
            row = ok(api('/rest/v1/bookings?titolo=eq.' + title.replace(' ', '%20'), service=True))[0]
            self.assertEqual((row['data'], row['inizio'], row['fine'], row['stato']), (DAY, '18:00:00', '22:00:00', 'confermata'))
        finally:
            rows = ok(api('/rest/v1/bookings?titolo=eq.' + title.replace(' ', '%20'), service=True))
            self.booking_ids.extend(row['id'] for row in rows)

    def test_partial_payment_in_browser_updates_balance(self):
        b = self.booking()
        page = self.login()
        page.goto('http://127.0.0.1:8765/#turni')
        page.locator('[data-edit="' + b['id'] + '"]').click()
        page.locator('#b-incassato').fill('150')
        page.locator('#b-submit').click()
        expect(page.locator('#dlg-booking')).not_to_be_visible(timeout=20000)
        page.reload()
        expect(page.locator('#app')).to_be_visible(timeout=30000)
        row = ok(api('/rest/v1/bookings?id=eq.' + b['id'], service=True))[0]
        self.assertEqual(row['incassato'], 150)
        page.goto('http://127.0.0.1:8765/#oggi')
        expect(page.locator('#kpis .kpi').filter(has_text='Da incassare').locator('b')).to_contain_text('350')

    def test_volunteers_signup_and_transfer_in_browser(self):
        b = self.booking()
        a, other = self.volunteers()
        page = self.context.new_page()
        page.goto('http://127.0.0.1:8765/modulo/turni.html?t=' + a['token'])
        page.locator('[data-si="1"]').first.click()
        expect(page.locator('[data-cambio]')).to_be_visible()
        page.locator('[data-cambio]').click()
        expect(page.get_by_text('Cambio chiesto', exact=False).first).to_be_visible()
        rows = ok(api('/rest/v1/signups?booking_id=eq.' + b['id'], service=True))
        self.assertEqual([r['volontario_id'] for r in rows], [a['id']])
        page.goto('http://127.0.0.1:8765/modulo/turni.html?t=' + other['token'])
        page.locator('[data-prendi]').first.click()
        expect(page.locator('[data-cambio]')).to_be_visible()
        page.reload()
        expect(page.locator('[data-cambio]')).to_be_visible()
        rows = ok(api('/rest/v1/signups?booking_id=eq.' + b['id'], service=True))
        self.assertEqual([r['volontario_id'] for r in rows], [other['id']])

    def test_event_page_opens_from_booking_and_updates_payment(self):
        b = self.booking()
        other = self.booking()
        page = self.login()
        page.goto('http://127.0.0.1:8765/#prenotazioni')
        page.locator('[data-b="' + b['id'] + '"]').click()
        expect(page.locator('#evento-titolo')).to_have_text(b['titolo'])
        expect(page.locator('#evento-prossime')).to_contain_text('Restano 500')
        expect(page.locator('#evento-turni')).to_contain_text('2 posti da coprire')
        page.locator('#evento-pagamenti [data-event-action="payment"]').click()
        expect(page.locator('#b-titolo')).to_have_value(b['titolo'])
        page.locator('#b-incassato').fill('150')
        page.locator('#b-submit').click()
        expect(page.locator('#dlg-booking')).not_to_be_visible()
        expect(page.locator('#evento-pagamenti')).to_contain_text('350')
        page.reload()
        expect(page.locator('#evento-pagamenti')).to_contain_text('350')
        page.set_viewport_size({'width': 390, 'height': 844})
        self.assertTrue(page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
        if os.environ.get('SALA_SCREENSHOT'):
            page.locator('#sipario').wait_for(state='detached', timeout=10000)
            page.screenshot(path=os.environ['SALA_SCREENSHOT'], full_page=True)
        page.locator('#evento-turni [data-event-action="shifts"]').click()
        expect(page.locator('#shifts')).to_contain_text(b['titolo'])
        expect(page.locator('#shifts')).not_to_contain_text(other['titolo'])
        page.get_by_role('link', name='Tutti i turni', exact=True).click()
        expect(page.locator('#shifts')).to_contain_text(other['titolo'])

    def test_event_documents_and_private_materials(self):
        b = self.booking()
        ok(api('/rest/v1/schede', 'POST', {'booking_id': b['id'], 'titolo': b['titolo'],
            'stato': 'compilata', 'dati': {'siae': 'si', 'ente': 'Associazione test'}}, service=True))
        page = self.login()
        page.goto('http://127.0.0.1:8765/#evento/' + b['id'])
        expect(page.locator('#evento-documenti')).to_contain_text('Da verificare')
        expect(page.locator('#evento-documenti')).to_contain_text('Permesso da ricevere')
        page.locator('#evento-documenti [data-event-action="document"]').click()
        expect(page.locator('#dlg-scheda')).to_be_visible()
        expect(page.locator('#dlg-scheda')).to_contain_text('Associazione test')
        page.locator('#dlg-scheda [data-close]').first.click()
        page.locator('[data-event-action="social"]').click()
        expect(page.locator('#dlg-social')).to_be_visible()
        page.locator('#soc-descrizione').fill('Descrizione privata di prova')
        page.locator('#social-form button[type="submit"]').click()
        expect(page.locator('#dlg-social')).not_to_be_visible()
        expect(page.locator('#evento-materiali')).to_contain_text('Descrizione privata di prova')
        # Adding materials must not turn a private rental into a public event.
        record = ok(api('/rest/v1/bookings?id=eq.' + b['id'], service=True))[0]
        self.assertFalse(record['della_sala'])
        self.assertFalse(record['comune'])

    def test_event_volunteer_has_only_public_details(self):
        b = self.booking()
        ok(api('/rest/v1/bookings?id=eq.' + b['id'], 'PATCH',
               {'referente': 'Referente riservato', 'note': 'Nota riservata'}, service=True))
        page = self.login('volontario')
        page.goto('http://127.0.0.1:8765/#evento/' + b['id'])
        expect(page.locator('#evento-titolo')).to_have_text(b['titolo'])
        expect(page.locator('#evento-turni')).to_be_visible()
        for section in ('pagamenti', 'contatti', 'documenti', 'materiali', 'collegamenti'):
            expect(page.locator('#evento-' + section)).to_have_count(0)
        expect(page.locator('#evento-body')).not_to_contain_text('3330000000')
        expect(page.locator('#evento-body')).not_to_contain_text('Referente riservato')
        expect(page.locator('#evento-body')).not_to_contain_text('Nota riservata')
        expect(page.locator('[data-event-action="edit"]')).to_have_count(0)

    def test_event_unavailable_data_is_not_shown_as_complete(self):
        b = self.booking()
        for table in ('schede', 'signups', 'eventi_info'):
            self.context.route('**/rest/v1/' + table + '*', lambda route: route.fulfill(
                status=503, content_type='application/json', body='{"message":"Test: servizio non disponibile"}'))
        page = self.login()
        page.goto('http://127.0.0.1:8765/#evento/' + b['id'])
        expect(page.locator('#evento-documenti')).to_contain_text('Dati non disponibili', timeout=30000)
        expect(page.locator('#evento-documenti [data-event-action="send-document"]')).to_have_count(0)
        expect(page.locator('#evento-turni')).to_contain_text('copertura dei turni non è verificabile')
        expect(page.locator('#evento-turni')).not_to_contain_text('Tutti i posti coperti')
        expect(page.locator('#evento-materiali')).to_contain_text('Informazioni non disponibili')

    def test_event_cancelled_and_missing_are_explicit(self):
        b = self.booking()
        ok(api('/rest/v1/bookings?id=eq.' + b['id'], 'PATCH', {'stato': 'annullata'}, service=True))
        page = self.login()
        page.goto('http://127.0.0.1:8765/#evento/' + b['id'])
        expect(page.locator('#evento-body')).to_contain_text('Evento annullato')
        expect(page.locator('#evento-prossime')).to_have_count(0)
        page.goto('http://127.0.0.1:8765/#evento/' + str(uuid4()))
        expect(page.locator('#evento-body')).to_contain_text('Evento non disponibile')

    def test_signup_is_idempotent_and_invalid_link_rejected(self):
        b = self.booking()
        a, _ = self.volunteers()
        body = {'p_token': a['token'], 'p_booking': b['id'], 'p_slot': 'porta', 'p_si': True}
        ok(rpc('turni_segna', body))
        ok(rpc('turni_segna', body))
        rows = ok(api('/rest/v1/signups?booking_id=eq.' + b['id'], service=True))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['volontario_id'], a['id'])
        self.assertGreaterEqual(rpc('turni_segna', {**body, 'p_token': str(uuid4())})[0], 400)

    def test_concurrent_signup_is_successful_exactly_once(self):
        b = self.booking()
        a, _ = self.volunteers()
        body = {'p_token': a['token'], 'p_booking': b['id'], 'p_slot': 'porta', 'p_si': True}
        command = ['docker', 'exec', '-i', 'supabase_db_sala-regression-tests',
                   'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres']
        # Hold the event row so both real HTTP requests reach the locking point.
        # This reproduces a simultaneous double tap without relying on timing.
        lock = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, text=True)
        try:
            lock.stdin.write("BEGIN; SELECT id FROM public.bookings WHERE id = '" + b['id'] + "' FOR UPDATE;\n")
            lock.stdin.flush()
            self.assertEqual(lock.stdout.readline().strip(), b['id'])
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                futures = [pool.submit(rpc, 'turni_segna', body) for _ in range(2)]
                try:
                    deadline = time.monotonic() + 10
                    waiting = 0
                    while time.monotonic() < deadline:
                        waiting = int(subprocess.check_output(command + ['-c',
                            "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%turni_segna%';"], text=True).strip())
                        if waiting >= 2:
                            break
                        time.sleep(0.05)
                    self.assertGreaterEqual(waiting, 2, 'Both API requests must reach the row lock')
                finally:
                    lock.stdin.write('COMMIT;\n')
                    lock.stdin.flush()
                results = [future.result(timeout=20) for future in futures]
            rows = ok(api('/rest/v1/signups?booking_id=eq.' + b['id'], service=True))
            self.assertEqual(len(rows), 1, 'Never create duplicate signups')
            for result in results:
                ok(result)  # Both taps should succeed without a technical error.
        finally:
            lock.communicate(timeout=10)  # EOF also releases the lock on failure.

    def test_shift_transfer_only_after_acceptance(self):
        b = self.booking()
        a, other = self.volunteers()
        ok(rpc('turni_segna', {'p_token': a['token'], 'p_booking': b['id'], 'p_slot': 'porta', 'p_si': True}))
        ok(rpc('turni_cambio_chiedi', {'p_token': a['token'], 'p_booking': b['id'], 'p_slot': 'porta'}))
        rows = ok(api('/rest/v1/signups?booking_id=eq.' + b['id'], service=True))
        self.assertEqual([r['volontario_id'] for r in rows], [a['id']])
        change = ok(api('/rest/v1/turni_cambi?booking_id=eq.' + b['id'], service=True))[0]
        ok(rpc('turni_cambio_prendi', {'p_token': other['token'], 'p_cambio': change['id']}))
        rows = ok(api('/rest/v1/signups?booking_id=eq.' + b['id'], service=True))
        self.assertEqual([r['volontario_id'] for r in rows], [other['id']])
        self.assertGreaterEqual(rpc('turni_cambio_prendi', {'p_token': a['token'], 'p_cambio': change['id']})[0], 400)

    def test_roles_cannot_read_or_modify_forbidden_data(self):
        b = self.booking()
        expense = ok(api('/rest/v1/expenses', 'POST', {'data': DAY, 'importo': 99, 'descrizione': 'Spesa riservata test'}, token=self.users['admin']['token']))[0]
        self.expense_ids.append(expense['id'])
        self.assertEqual(len(ok(api('/rest/v1/expenses?id=eq.' + expense['id'], token=self.users['admin']['token']))), 1)
        self.assertEqual(ok(api('/rest/v1/expenses', token=self.users['coordinatore']['token'])), [])
        for role in ('volontario', 'in_attesa', 'bloccato'):
            with self.subTest(role=role):
                token = self.users[role]['token']
                self.assertEqual(ok(api('/rest/v1/bookings?id=eq.' + b['id'], token=token)), [])
                result = api('/rest/v1/bookings?id=eq.' + b['id'], 'PATCH', {'prezzo': 1}, token=token)
                self.assertTrue(result[0] >= 400 or result[1] == [])
                result = api('/rest/v1/bookings', 'POST', {'titolo': 'Vietata', 'data': DAY, 'inizio': '18:00', 'fine': '22:00'}, token=token)
                self.assertGreaterEqual(result[0], 400)
                self.assertEqual(ok(api('/rest/v1/expenses', token=token)), [])
                result = api('/rest/v1/profiles?id=eq.' + self.users[role]['id'], 'PATCH', {'ruolo': 'admin'}, token=token)
                self.assertTrue(result[0] >= 400 or result[1] == [])
                profile = ok(api('/rest/v1/profiles?id=eq.' + self.users[role]['id'], service=True))[0]
                self.assertEqual(profile['ruolo'], role)
                events = ok(api('/rest/v1/eventi?id=eq.' + b['id'], token=token))
                if role == 'volontario':
                    self.assertEqual(len(events), 1)
                    self.assertTrue({'prezzo', 'incassato', 'telefono', 'email'}.isdisjoint(events[0]))
                else:
                    self.assertEqual(events, [])
        row = ok(api('/rest/v1/bookings?id=eq.' + b['id'], service=True))[0]
        self.assertEqual(row['prezzo'], 500)
        self.assertEqual(len(ok(api('/rest/v1/bookings?id=eq.' + b['id'], token=self.users['coordinatore']['token']))), 1)


if __name__ == '__main__':
    unittest.main(verbosity=2)
