"""Real local Supabase API + browser regression tests. No production access."""
import concurrent.futures
import csv
import io
from datetime import date, timedelta
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import re
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

    def do_GET(self):
        # Serve an older HTML shell over real HTTP to reproduce mixed cache
        # without changing the page's network origin or private-network checks.
        url = urlsplit(self.path)
        if url.path == '/modulo/compila.html' and 'legacy_test=1' in url.query:
            html = (ROOT / 'modulo/compila.html').read_text()
            body = re.sub(r'<p class="hint no-print">Versione modulo.*?</p>', '', html).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()


class Regression(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.users = {}
        for role in ('admin', 'coordinatore', 'volontario', 'in_attesa', 'bloccato', 'segreteria'):
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
        self.request_ids = []
        self.parish_ids = []
        self.group_ids = []
        self.contact_keys = []
        self.cash_ids = []
        self.cash_film_ids = []
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
        for sid in self.parish_ids:
            ok(api('/rest/v1/bookings?scheda_parrocchia_id=eq.' + sid, 'DELETE', service=True))
            ok(api('/rest/v1/schede?id=eq.' + sid, 'DELETE', service=True))
        for rid in self.request_ids:
            ok(api('/rest/v1/richieste?id=eq.' + rid, 'DELETE', service=True))
        for cid in self.cash_ids:
            ok(api('/rest/v1/cassa?id=eq.'+cid,'DELETE',service=True))
        for fid in self.cash_film_ids:
            ok(api('/rest/v1/films?id=eq.'+fid,'DELETE',service=True))
        for bid in self.booking_ids:
            ok(api('/rest/v1/schede?booking_id=eq.' + bid, 'DELETE', service=True))
            ok(api('/rest/v1/eventi_info?chiave=eq.b:' + bid, 'DELETE', service=True))
            ok(api('/rest/v1/bookings?id=eq.' + bid, 'DELETE', service=True))
        for eid in self.expense_ids:
            ok(api('/rest/v1/expenses?id=eq.' + eid, 'DELETE', service=True))
        for gid in self.group_ids:
            ok(api('/rest/v1/gruppi?id=eq.' + gid, 'DELETE', service=True))
        for key in self.contact_keys:
            ok(api('/rest/v1/rubrica?chiave=eq.' + key, 'DELETE', service=True))
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
        page.goto('http://127.0.0.1:8765/#economia')
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
        expect(page.locator('[data-event-action="quote"]')).to_have_count(0)

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

    def test_quote_tariffs_supplements_and_vat_do_not_change_booking(self):
        b = self.booking()
        ok(api('/rest/v1/bookings?id=eq.' + b['id'], 'PATCH',
               {'referente': 'Cliente prova', 'tariffa': {'spazio': 'galleria', 'biglietteria': True}}, service=True))
        page = self.login()
        page.goto('http://127.0.0.1:8765/#evento/' + b['id'])
        page.locator('[data-event-action="quote"]').click()
        expect(page.locator('#qa-modo')).to_have_value('concordato')
        expect(page.locator('#qa-preview')).to_contain_text('500,00')
        page.locator('#qa-modo').select_option('tariffa')
        expect(page.locator('#qa-preview')).to_contain_text('588,00')
        expect(page.locator('#qa-preview')).to_contain_text('88,00')
        expect(page.locator('#qa-differenza')).to_contain_text('500,00')
        page.locator('#qa-commerciale').check()
        expect(page.locator('#qa-preview')).to_contain_text('688,00')
        page.locator('#qa-close').click()
        page.locator('[data-event-action="quote"]').click()
        expect(page.locator('#qa-commerciale')).to_be_checked()
        expect(page.locator('#qa-preview')).to_contain_text('688,00')
        record = ok(api('/rest/v1/bookings?id=eq.' + b['id'], service=True))[0]
        self.assertEqual(record['prezzo'], 500)
        self.assertEqual(record['incassato'], 0)
        self.assertNotIn('commerciale', record['tariffa'])
        page.locator('#qa-close').click()
        ok(api('/rest/v1/bookings?id=eq.' + b['id'], 'PATCH', {'prezzo': 600}, service=True))
        page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
        expect(page.locator('#evento-pagamenti')).to_contain_text('600')
        page.locator('[data-event-action="quote"]').click()
        expect(page.locator('#qa-preview')).to_contain_text('688,00')
        expect(page.locator('#qa-differenza')).to_contain_text('600,00')

    def test_quote_vat_can_include_supplements(self):
        settings = ok(api('/rest/v1/settings?id=eq.1', service=True))[0]
        tariffs = {**settings['tariffe'], 'iva_supplementi': True}
        try:
            ok(api('/rest/v1/settings?id=eq.1', 'PATCH', {'tariffe': tariffs}, service=True))
            b = self.booking()
            ok(api('/rest/v1/bookings?id=eq.' + b['id'], 'PATCH', {'referente': 'Cliente prova',
                   'tariffa': {'spazio': 'galleria', 'biglietteria': True}}, service=True))
            page = self.login()
            page.goto('http://127.0.0.1:8765/#evento/' + b['id'])
            page.locator('[data-event-action="quote"]').click()
            page.locator('#qa-modo').select_option('tariffa')
            expect(page.locator('#qa-preview')).to_contain_text('110,00')
            expect(page.locator('#qa-preview')).to_contain_text('610,00')
        finally:
            ok(api('/rest/v1/settings?id=eq.1', 'PATCH', {'tariffe': settings['tariffe']}, service=True))

    def test_quote_prints_pdf_without_private_notes(self):
        b = self.booking()
        ok(api('/rest/v1/bookings?id=eq.' + b['id'], 'PATCH', {
            'referente': 'Cliente PDF', 'note': 'NOTA-INTERNA-RISERVATA', 'incassato': 150}, service=True))
        self.context.add_init_script('window.print = () => { window.printCalled = true; };')
        page = self.login()
        page.goto('http://127.0.0.1:8765/#evento/' + b['id'])
        page.locator('[data-event-action="quote"]').click()
        expect(page.locator('#qa-destinatario')).to_have_value('Cliente PDF')
        page.locator('#qa-condizioni').fill('Condizione concordata per il test.\nSeconda riga.')
        page.locator('#qa-note').fill('<script>window.evil=true</script> Testo da stampare')
        expect(page.locator('#qa-preview')).not_to_contain_text('NOTA-INTERNA-RISERVATA')
        with self.context.expect_page() as opened:
            page.locator('#qa-print').click()
        popup = opened.value
        expect(popup.locator('h1')).to_have_text('Preventivo utilizzo sala')
        expect(popup.locator('body')).to_contain_text('Cliente PDF')
        expect(popup.locator('body')).to_contain_text('500,00')
        expect(popup.locator('body')).to_contain_text('Seconda riga.')
        expect(popup.locator('body')).not_to_contain_text('NOTA-INTERNA-RISERVATA')
        self.assertIsNone(popup.evaluate('window.evil'))
        self.assertTrue(popup.evaluate('window.printCalled'))
        pdf = popup.pdf(format='A4', print_background=True)
        self.assertTrue(pdf.startswith(b'%PDF'))
        self.assertGreater(len(pdf), 5000)
        if os.environ.get('SALA_QUOTE_PDF'):
            Path(os.environ['SALA_QUOTE_PDF']).write_bytes(pdf)
        if os.environ.get('SALA_QUOTE_SCREENSHOT'):
            page.set_viewport_size({'width': 390, 'height': 844})
            page.locator('#sipario').wait_for(state='detached', timeout=10000)
            self.assertTrue(page.locator('#dlg-preventivo-affitto').evaluate('(el) => el.scrollWidth <= el.clientWidth'))
            page.screenshot(path=os.environ['SALA_QUOTE_SCREENSHOT'], full_page=True)

    def test_quote_from_request_requires_missing_data_and_valid_amounts(self):
        request = ok(api('/rest/v1/richieste', 'POST', {'account': 'test@example.test', 'thread_id': uuid4().hex,
            'mittente': 'Cliente email', 'mittente_email': 'cliente@example.test', 'oggetto': 'Richiesta sala per incontro',
            'testo': 'Testo originale non destinato al preventivo'}, service=True))[0]
        self.request_ids.append(request['id'])
        page = self.login()
        page.goto('http://127.0.0.1:8765/#richieste')
        page.locator('[data-preventivo-richiesta="' + request['id'] + '"]').click()
        expect(page.locator('#qa-destinatario')).to_have_value('Cliente email')
        expect(page.locator('#qa-condizioni')).to_have_value(re.compile('.*scheda tecnica.*', re.S))
        expect(page.locator('#qa-print')).to_be_disabled()
        page.locator('#qa-data').fill(DAY)
        page.locator('#qa-inizio').fill('18:00')
        page.locator('#qa-fine').fill('22:00')
        page.locator('#qa-spazio').select_option('platea')
        expect(page.locator('#qa-preview')).to_contain_text('610,00')
        expect(page.locator('#qa-print')).to_be_enabled()
        page.locator('#qa-modo').select_option('concordato')
        page.locator('#qa-importo').fill('-10')
        expect(page.locator('#qa-print')).to_be_disabled()
        page.locator('#qa-importo').fill('125.50')
        expect(page.locator('#qa-preview')).to_contain_text('125,50')
        expect(page.locator('#qa-print')).to_be_enabled()
        page.locator('#qa-validita').fill('2020-01-01')
        expect(page.locator('#qa-print')).to_be_disabled()
        record = ok(api('/rest/v1/richieste?id=eq.' + request['id'], service=True))[0]
        self.assertIsNone(record['booking_id'])
        self.assertEqual(record['stato'], 'nuova')

    def parish_request(self, rows=None):
        s = ok(api('/rest/v1/schede', 'POST', {'percorso': 'parrocchia', 'stato': 'inviata', 'titolo': 'Incontri parrocchiali'}, token=self.users['admin']['token']))[0]
        self.parish_ids.append(s['id'])
        d = {'attivita_parrocchiale': 'catechismo', 'gruppo': 'Gruppo catechismo', 'titolo': 'Incontri catechismo',
             'firma': 'Referente prova', 'referente': 'Referente prova', 'cellulare': '3330000000', 'resp_sera': 'Responsabile prova', 'resp_cell': '3331111111',
             'descrizione': 'Catechesi e confronto su un brano, con lavoro di gruppo.', 'utilizzo_spazi': 'Riunione di tutto il gruppo in galleria.', 'disposizione': 'seduti', 'palco': 'no', 'tecnico': 'nessuno', 'attrezzature': 'no', 'scenografie': 'no', 'conferma_esigenze': True, 'fascia': 'galleria', 'pubblico_n': 30, 'minori': 'si', 'siae': 'no', 'ok_regole': True, 'ok_privacy': True,
             'orari': rows or [{'data': DAY, 'inizio': '10:00', 'fine': '11:00', 'all_da': '09:30', 'all_a': '10:00', 'sgombero': '11:15'}]}
        return s, d

    def approve_parish(self, s, token=None, **extra):
        return api('/rest/v1/rpc/parrocchia_approva', 'POST', {'p_scheda': s['id'], 'p_sicurezza': 'compatibile', **extra}, token=token or self.users['admin']['token'])

    def test_parish_browser_request_requires_approval_and_creates_free_series(self):
        admin = self.login()
        admin.goto('http://127.0.0.1:8765/#schede')
        admin.locator('#sc-parrocchia').click()
        admin.locator('#ns-dest').fill('Referente prova')
        admin.locator('#ns-titolo').fill('Catechismo del gruppo')
        admin.locator('#ns-form button[type="submit"]').click()
        expect(admin.locator('#dlg-copy')).to_be_visible()
        text = admin.locator('#copy-text').input_value()
        versione = re.search(r'Versione (\S+)', admin.locator('footer.version').inner_text())[1]
        self.assertIn('&v=' + versione, text)
        token = re.search(r'[?&]t=([0-9a-f-]+)', text)[1]
        s = ok(api('/rest/v1/schede?token=eq.' + token, service=True))[0]
        self.parish_ids.append(s['id'])
        organizer = self.context.new_page()
        organizer.goto('http://127.0.0.1:8765/modulo/compila.html?t=' + token)
        expect(organizer.get_by_role('heading', name='Attività della Parrocchia')).to_be_visible()
        expect(organizer.locator('[name="cf"]')).to_have_count(0)
        organizer.locator('[name="attivita_parrocchiale"][value="catechismo"]').check()
        organizer.locator('#p-gruppo').fill('Gruppo catechismo')
        organizer.locator('#p-descrizione').fill('Catechesi con lettura e confronto tra i partecipanti.')
        organizer.locator('#p-utilizzo_spazi').fill('Tutto il gruppo si riunisce in galleria per un incontro seduto.')
        organizer.locator('[name="disposizione"][value="seduti"]').check()
        organizer.locator('[name="palco"][value="no"]').check()
        organizer.locator('[name="tecnico"][value="nessuno"]').check()
        organizer.locator('[name="attrezzature"][value="no"]').check()
        organizer.locator('[name="scenografie"][value="no"]').check()
        organizer.locator('[name="conferma_esigenze"]').check()
        organizer.locator('#p-cellulare').fill('3330000000')
        organizer.locator('[name="o_data"]').fill(DAY)
        organizer.locator('[name="o_inizio"]').fill('10:00')
        organizer.locator('[name="o_fine"]').fill('11:00')
        organizer.locator('#parrocchia-aggiungi').click()
        row = organizer.locator('.riga-orari').nth(1)
        row.locator('[name="o_data"]').fill((date.fromisoformat(DAY) + timedelta(days=1)).isoformat())
        row.locator('[name="o_inizio"]').fill('10:00')
        row.locator('[name="o_fine"]').fill('11:00')
        organizer.locator('[name="fascia"][value="galleria"]').check()
        organizer.locator('#p-pubblico_n').fill('30')
        organizer.locator('[name="minori"][value="si"]').check()
        organizer.locator('[name="siae"][value="no"]').check()
        organizer.locator('[name="ok_regole"]').check()
        organizer.locator('[name="ok_privacy"]').check()
        organizer.locator('#p-firma').fill('Referente prova')
        organizer.set_viewport_size({'width': 390, 'height': 844})
        self.assertTrue(organizer.evaluate('document.documentElement.scrollWidth <= innerWidth'))
        if os.environ.get('SALA_PARISH_SCREENSHOT'):
            organizer.evaluate('window.scrollTo(0, 0)')
            organizer.screenshot(path=os.environ['SALA_PARISH_SCREENSHOT'], full_page=True)
        organizer.locator('#parrocchia-invia').click()
        expect(organizer.get_by_role('heading', name='Richiesta inviata, in attesa di approvazione')).to_be_visible()
        self.assertEqual(ok(api('/rest/v1/bookings?scheda_parrocchia_id=eq.' + s['id'], service=True)), [])
        admin.goto('http://127.0.0.1:8765/#schede')
        admin.reload()
        admin.locator('[data-vedi="' + s['id'] + '"]').click()
        admin.locator('[name="sk-sic"][value="compatibile"]').check()
        admin.locator('#sk-approva').click()
        expect(admin.locator('#dlg-scheda')).not_to_be_visible(timeout=15000)
        rows = ok(api('/rest/v1/bookings?scheda_parrocchia_id=eq.' + s['id'], service=True))
        self.assertEqual(len(rows), 2)
        for b in rows:
            self.assertEqual((b['stato'], b['prezzo'], b['incassato'], b['della_sala']), ('confermata', 0, 0, True))
        self.assertEqual(ok(self.approve_parish(s))['incontri'], 2)
        organizer.reload()
        expect(organizer.get_by_role('heading', name='Richiesta parrocchiale approvata')).to_be_visible()
        admin.goto('http://127.0.0.1:8765/#evento/' + rows[1]['id'])
        expect(admin.locator('#evento-programma')).to_contain_text('Catechesi con lettura')
        expect(admin.locator('#evento-programma')).to_contain_text('Galleria')
        expect(admin.locator('#evento-pagamenti')).to_contain_text('Parrocchia · gratuita')
        expect(admin.locator('[data-event-action="quote"]')).to_have_count(0)
        expect(admin.locator('[data-event-action="payment"]')).to_have_count(0)
        admin.get_by_role('button', name='Modifica prenotazione', exact=True).click()
        expect(admin.locator('#b-prezzo')).not_to_be_visible()
        admin.locator('#b-pubblico').select_option('galleria')
        admin.locator('#b-submit').click()
        expect(admin.locator('#dlg-booking')).not_to_be_visible()

    def test_parish_approval_conflicts_roll_back_all_dates(self):
        b = self.booking()
        next_day = (date.fromisoformat(DAY) + timedelta(days=1)).isoformat()
        s, d = self.parish_request([{'data': next_day, 'inizio': '10:00', 'fine': '11:00'}, {'data': DAY, 'inizio': '17:30', 'fine': '18:30'}])
        ok(rpc('scheda_invia', {'p_token': s['token'], 'p_dati': d, 'p_firma': 'Referente prova'}))
        result = self.approve_parish(s)
        self.assertGreaterEqual(result[0], 400)
        self.assertIn('Sovrapposizione', result[1]['message'])
        self.assertEqual(ok(api('/rest/v1/bookings?scheda_parrocchia_id=eq.' + s['id'], service=True)), [])
        saved = ok(api('/rest/v1/schede?id=eq.' + s['id'], service=True))[0]
        self.assertEqual(saved['stato'], 'compilata')
        self.assertIsNone(saved['booking_id'])

    def test_parish_route_and_approval_cannot_be_self_assigned(self):
        s, d = self.parish_request()
        ok(rpc('scheda_invia', {'p_token': s['token'], 'p_dati': d, 'p_firma': 'Referente prova'}))
        self.assertGreaterEqual(self.approve_parish(s, token=self.users['volontario']['token'])[0], 400)
        self.assertGreaterEqual(rpc('parrocchia_approva', {'p_scheda': s['id'], 'p_sicurezza': 'compatibile'})[0], 400)
        result = api('/rest/v1/schede', 'POST', {'percorso': 'parrocchia', 'stato': 'inviata'}, token=self.users['volontario']['token'])
        self.assertGreaterEqual(result[0], 400)
        result = api('/rest/v1/schede', 'POST', {'percorso': 'parrocchia', 'stato': 'inviata'}, token=self.users['segreteria']['token'])
        self.assertGreaterEqual(result[0], 400)
        external = ok(api('/rest/v1/schede', 'POST', {'stato': 'inviata'}, service=True))[0]
        self.parish_ids.append(external['id'])
        d['a_titolo'] = 'parrocchia'
        ok(rpc('scheda_invia', {'p_token': external['token'], 'p_dati': d, 'p_firma': 'Referente prova'}))
        self.assertGreaterEqual(self.approve_parish(external)[0], 400)
        self.assertEqual(ok(api('/rest/v1/bookings?scheda_parrocchia_id=eq.' + external['id'], service=True)), [])
        self.assertGreaterEqual(api('/rest/v1/schede?id=eq.' + external['id'], 'PATCH', {'percorso': 'parrocchia'}, token=self.users['admin']['token'])[0], 400)

    def test_parish_free_amounts_and_approved_request_are_protected(self):
        s, d = self.parish_request()
        d.update({'prezzo': 999, 'incassato': 99, 'cf': 'Dato non necessario'})
        ok(rpc('scheda_invia', {'p_token': s['token'], 'p_dati': d, 'p_firma': 'Referente prova'}))
        ok(self.approve_parish(s))
        b = ok(api('/rest/v1/bookings?scheda_parrocchia_id=eq.' + s['id'], service=True))[0]
        self.assertEqual(b['inizio'], '09:30:00')
        self.assertEqual(b['fine'], '11:15:00')
        for change in ({'prezzo': 1}, {'incassato': 1}, {'della_sala': False}, {'scheda_parrocchia_id': None}):
            self.assertGreaterEqual(api('/rest/v1/bookings?id=eq.' + b['id'], 'PATCH', change, token=self.users['admin']['token'])[0], 400)
        self.assertGreaterEqual(rpc('scheda_invia', {'p_token': s['token'], 'p_dati': d, 'p_firma': 'Referente prova'})[0], 400)
        saved = ok(api('/rest/v1/schede?id=eq.' + s['id'], service=True))[0]
        self.assertNotIn('cf', saved['dati'])
        self.assertNotIn('prezzo', saved['dati'])
        fake = {'titolo': 'Incontro non approvato', 'data': DAY, 'inizio': '12:00', 'fine': '13:00', 'prezzo': 0,
                'incassato': 0, 'stato': 'confermata', 'della_sala': True, 'scheda_parrocchia_id': s['id'], 'parrocchia_riga': 2}
        result = api('/rest/v1/bookings', 'POST', fake, token=self.users['admin']['token'])
        self.assertGreaterEqual(result[0], 400)
        self.assertIn('data approvata', result[1]['message'])
        next_day = (date.fromisoformat(DAY) + timedelta(days=1)).isoformat()
        result = api('/rest/v1/bookings?id=eq.' + b['id'], 'PATCH', {'data': next_day}, token=self.users['segreteria']['token'])
        self.assertGreaterEqual(result[0], 400)
        ok(api('/rest/v1/bookings?id=eq.' + b['id'], 'PATCH', {'data': next_day}, token=self.users['admin']['token']))
        summary = ok(rpc('scheda_apri', {'p_token': s['token']}))
        self.assertEqual(summary['incontri'][0]['data'], next_day)

    def test_parish_checks_activity_capacity_times_and_rights(self):
        s, d = self.parish_request()
        invalid = [{**d, 'attivita_parrocchiale': 'festa_privata'}, {**d, 'attivita_parrocchiale': 'corso_esterno'},
                   {**d, 'pubblico_n': 135}, {**d, 'resp_cell': ''}, {**d, 'ok_regole': False},
                   {**d, 'orari': [{'data': DAY, 'inizio': '11:00', 'fine': '10:00'}]}]
        for data in invalid:
            self.assertGreaterEqual(rpc('scheda_invia', {'p_token': s['token'], 'p_dati': data, 'p_firma': 'Referente prova'})[0], 400)
        d.update({'siae': 'si', 'siae_opere': 'Proiezione da verificare'})
        ok(rpc('scheda_invia', {'p_token': s['token'], 'p_dati': d, 'p_firma': 'Referente prova'}))
        self.assertGreaterEqual(self.approve_parish(s)[0], 400)
        self.assertEqual(ok(self.approve_parish(s, p_siae_verificata=True))['incontri'], 1)

    def test_parish_full_requirements_are_visible_to_manager(self):
        s, d = self.parish_request()
        d.update({'attivita_parrocchiale': 'conferenza', 'fascia': 'platea', 'palco': 'si', 'palco_n': 3,
            'palco_uso': 'Tre relatori presentano il tema dal palco.', 'disposizione': 'seduti',
            'descrizione': 'Conferenza con tre interventi, slide e domande del pubblico.',
            'utilizzo_spazi': 'Relatori sul palco in platea e partecipanti seduti in platea.',
            'proiettore': True, 'contenuti_proiezione': 'Slide preparate dal gruppo.', 'collegamento_video': 'PC portatile del gruppo con HDMI',
            'audio': True, 'audio_uso': 'Voce dei relatori e domande del pubblico.', 'mic_filo': True, 'mic_filo_n': 2,
            'radiomic': True, 'radiomic_n': 1, 'mic_tavolo': True, 'mic_tavolo_n': 1, 'tavolo': True, 'tavolo_n': 3,
            'tecnico': 'nostro', 'tecnico_nome': 'Tecnico prova', 'tecnico_cell': '3332222222',
            'attrezzature': 'si', 'attrezzature_quali': 'Un PC e un piccolo mixer del gruppo.', 'potenza_w': 250,
            'scenografie': 'si', 'scenografie_quali': 'Pannelli ignifughi da concordare con la sala.',
            'esigenze_apertura': 'Il referente arriva alle 09:30 e chiede supporto per accendere gli impianti.',
            'variazioni_incontri': 'Per tutti gli incontri sono richieste le stesse dotazioni.'})
        ok(rpc('scheda_invia', {'p_token': s['token'], 'p_dati': d, 'p_firma': 'Referente prova'}))
        organizer = self.context.new_page()
        organizer.goto('http://127.0.0.1:8765/modulo/compila.html?t=' + s['token'])
        expect(organizer.locator('#p-mic_filo_n')).to_have_value('2')
        expect(organizer.locator('#p-tecnico_nome')).to_have_value('Tecnico prova')
        expect(organizer.locator('#p-resp_sera')).to_have_value('Responsabile prova')
        organizer.locator('#p-descrizione').fill('Conferenza con tre interventi, slide e un confronto finale con il pubblico.')
        organizer.reload()
        expect(organizer.locator('#p-descrizione')).to_have_value('Conferenza con tre interventi, slide e un confronto finale con il pubblico.')
        organizer.set_viewport_size({'width': 390, 'height': 844})
        self.assertTrue(organizer.evaluate('document.documentElement.scrollWidth <= innerWidth'))
        if os.environ.get('SALA_PARISH_SCREENSHOT'):
            organizer.evaluate('window.scrollTo(0, 0)')
            organizer.screenshot(path=os.environ['SALA_PARISH_SCREENSHOT'] + '.dettagli.png', full_page=True)
        organizer.locator('#parrocchia-invia').click()
        expect(organizer.get_by_role('heading', name='Richiesta inviata, in attesa di approvazione')).to_be_visible()
        page = self.login()
        page.goto('http://127.0.0.1:8765/#schede')
        page.locator('[data-vedi="' + s['id'] + '"]').click()
        expect(page.locator('#sk-risposte')).to_contain_text('un confronto finale')
        expect(page.locator('#sk-risposte')).to_contain_text('PC portatile del gruppo con HDMI')
        expect(page.locator('#sk-risposte')).to_contain_text('Tecnico prova')
        expect(page.locator('#sk-risposte')).to_contain_text('supporto per accendere')
        page.locator('[name="sk-sic"][value="compatibile"]').check()
        page.locator('#sk-approva').click()
        expect(page.locator('#dlg-scheda')).not_to_be_visible()
        b = ok(api('/rest/v1/bookings?scheda_parrocchia_id=eq.' + s['id'], service=True))[0]
        page.goto('http://127.0.0.1:8765/#evento/' + b['id'])
        expect(page.locator('#evento-programma')).to_contain_text('Platea con palco')
        expect(page.locator('#evento-programma')).to_contain_text('2 microfoni a filo')
        expect(page.locator('#evento-programma')).to_contain_text('Tre relatori')
        expect(page.locator('#evento-programma')).to_contain_text('supporto per accendere')
        organizer.reload()
        expect(organizer.get_by_role('heading', name='Richiesta parrocchiale approvata')).to_be_visible()
        expect(organizer.locator('#modulo-percorso')).to_have_text('Percorso Parrocchia')
        expect(organizer.locator('#app')).to_contain_text('Come userete gli spazi scelti?')
        expect(organizer.locator('#app')).to_contain_text('PC portatile del gruppo con HDMI')
        expect(organizer.locator('#app')).to_contain_text('2 microfoni a filo')
        expect(organizer.locator('#app')).to_contain_text('supporto per accendere')
        expect(organizer.locator('form')).to_have_count(0)


    def test_parish_detailed_fields_are_required_and_consistent(self):
        s, d = self.parish_request()
        invalid = [
            {**d, 'descrizione': ''}, {**d, 'utilizzo_spazi': ''}, {**d, 'disposizione': 'altro'},
            {**d, 'palco': 'si', 'palco_n': 1, 'palco_uso': 'Un relatore'},
            {**d, 'proiettore': True}, {**d, 'audio': True}, {**d, 'tecnico': 'nostro'},
            {**d, 'attrezzature': 'si'}, {**d, 'scenografie': 'si'}, {**d, 'conferma_esigenze': False},
            {**d, 'audio': True, 'audio_uso': 'Relatori', 'radiomic': True, 'radiomic_n': 3},
            {**d, 'tavolo': True, 'tavolo_n': 0}, {**d, 'carrozzina_n': 31}, {**d, 'luci': True}
        ]
        for data in invalid:
            result = rpc('scheda_invia', {'p_token': s['token'], 'p_dati': data, 'p_firma': 'Referente prova'})
            self.assertGreaterEqual(result[0], 400, data)
        ok(rpc('scheda_invia', {'p_token': s['token'], 'p_dati': d, 'p_firma': 'Referente prova'}))
        page = self.context.new_page()
        page.goto('http://127.0.0.1:8765/modulo/compila.html?t=' + s['token'])
        page.locator('[name="audio"]').check()
        page.locator('#p-audio_uso').fill('Voce del relatore')
        page.locator('[name="mic_filo"]').check()
        page.locator('#p-mic_filo_n').fill('2')
        page.locator('[name="audio"]').uncheck()
        expect(page.locator('#p-mic_filo_n')).to_be_disabled()
        page.locator('#parrocchia-invia').click()
        expect(page.get_by_role('heading', name='Richiesta inviata, in attesa di approvazione')).to_be_visible()
        saved = ok(api('/rest/v1/schede?id=eq.' + s['id'], service=True))[0]['dati']
        self.assertFalse(saved['audio'])
        self.assertNotIn('mic_filo_n', saved)

    def test_personal_form_identifies_external_route(self):
        s = ok(api('/rest/v1/schede', 'POST', {'stato': 'inviata'}, service=True))[0]
        self.parish_ids.append(s['id'])
        page = self.context.new_page()
        page.goto('http://127.0.0.1:8765/modulo/compila.html?t=' + s['token'] + '&v=2026-11-01.85&legacy_test=1')
        expect(page.locator('#modulo-percorso')).to_have_text('Percorso utilizzatori esterni')
        expect(page.locator('body')).to_contain_text('Versione modulo')
        expect(page.locator('#scheda')).to_be_visible()
        expect(page.locator('#parrocchia-form')).to_have_count(0)

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

    def sala_evento(self, tipo='conferenza', sezioni=None, tecnica=None):
        b = self.booking()
        ok(api('/rest/v1/bookings?id=eq.' + b['id'], 'PATCH', {'della_sala': True}, token=self.users['admin']['token']))
        body = {'p_booking': b['id'], 'p_tipo': tipo, 'p_interni': {
            'referente_interno': 'Referente interno', 'ospite_nome': 'Ospite di prova',
            'ospite_contatto': '3331234567', 'programma': 'Presentazione e dialogo con il pubblico',
            'durata_minuti': '90', 'pubblico_n': '100', 'note_interne': 'ACCORDO RISERVATO 98765',
            'descrizione_pubblica': 'Una serata aperta a tutti', 'autorizza_promozione': True},
            'p_tecnica': tecnica or {}, 'p_sezioni': sezioni or [], 'p_revisione': None}
        r = ok(api('/rest/v1/rpc/evento_sala_salva', 'POST', body, token=self.users['admin']['token']))
        return b, r, body

    def test_sala_conference_internal_browser_and_confirmation(self):
        b = self.booking()
        ok(api('/rest/v1/bookings?id=eq.' + b['id'], 'PATCH', {'della_sala': True}, service=True))
        page = self.login()
        page.goto('http://127.0.0.1:8765/#evento/' + b['id'])
        expect(page.get_by_role('button', name='Prepara informazioni e invito')).to_be_visible()
        expect(page.locator('[data-prep-voce=informazioni]')).to_contain_text('Programma e referente interno da completare')
        page.locator('[data-prep-voce=informazioni] [data-event-action=organizzazione]').click()
        dlg = page.locator('#dlg-evento-sala')
        expect(dlg).to_be_visible()
        self.assertEqual(dlg.locator('[data-delega]').count(), 3)
        self.assertEqual(dlg.locator('[data-delega="palco"], [data-delega="luci"]').count(), 0)
        for key, value in {'referente_interno': 'Anna della Sala', 'ospite_nome': 'Relatore Test',
                'ospite_contatto': '3331234567', 'programma': 'Conferenza seguita da domande del pubblico',
                'durata_minuti': '90', 'pubblico_n': '100', 'note_interne': 'Accordo interno riservato'}.items():
            dlg.locator('#es-' + key).fill(value)
        dlg.locator('#tecnica-audio_uso').fill('Due microfoni per relatore e moderatore')
        dlg.locator('#es-salva').click()
        expect(dlg).not_to_be_visible()
        panel = page.locator('#evento-sala-panel')
        expect(panel).to_contain_text('Da verificare dalla Sala')
        panel.get_by_role('button', name='Verifica e conferma esigenze').click()
        expect(panel).to_contain_text('Esigenze confermate dalla Sala')
        expect(page.locator('[data-prep-voce=informazioni]')).to_contain_text('Programma ed esigenze confermati')
        r = ok(api('/rest/v1/eventi_sala?booking_id=eq.' + b['id'], service=True))[0]
        self.assertIsNone(r['ospite_token'])
        self.assertEqual(r['tecnica_confermata']['audio_uso'], 'Due microfoni per relatore e moderatore')
        original = ok(api('/rest/v1/bookings?id=eq.' + b['id'], service=True))[0]
        self.assertEqual((original['prezzo'], original['data'], original['inizio']), (500, DAY, '18:00:00'))
        page.goto('http://127.0.0.1:8765/#serata')
        expect(page.locator('#serata-eventi-sala')).to_contain_text('Due microfoni per relatore e moderatore')
        page.set_viewport_size({'width': 390, 'height': 844})
        page.goto('http://127.0.0.1:8765/#evento/' + b['id'])
        page.get_by_role('button', name='Modifica informazioni', exact=True).click()
        self.assertLessEqual(dlg.evaluate('(el) => el.scrollWidth - el.clientWidth'), 1)
        dlg.get_by_text('Materiali autorizzati per la promozione', exact=True).click()
        dlg.locator('#es-descrizione_pubblica').fill('Descrizione autorizzata per il pubblico')
        dlg.locator('#es-nomi_pubblicabili').fill('Relatore pubblico')
        dlg.locator('#es-promozione').check()
        dlg.locator('#es-salva').click()
        expect(dlg).not_to_be_visible()
        panel.get_by_role('button', name='Verifica e conferma esigenze').click()
        panel.get_by_role('button', name='Prepara info per i social').click()
        expect(page.locator('#soc-descrizione')).to_have_value('Descrizione autorizzata per il pubblico')
        expect(page.locator('#soc-regista')).to_have_value('Relatore pubblico')
        expect(page.locator('#soc-note')).to_have_value('')
        self.assertEqual(ok(api('/rest/v1/eventi_info?chiave=eq.b:' + b['id'], service=True)), [])
        page.locator('#dlg-social').get_by_role('button', name='Chiudi', exact=True).click()
        page.goto('http://127.0.0.1:8765/#economia')
        with page.expect_download() as downloaded:
            page.locator('#btn-export').click()
        backup = json.loads(Path(downloaded.value.path()).read_text())
        own = next(row for row in backup['organizzazione_sala'] if row['booking_id']==b['id'])
        self.assertEqual(own['interni']['note_interne'], 'Accordo interno riservato')


    def test_sala_guest_scoped_browser_review_and_resubmission(self):
        b, r, body = self.sala_evento('teatro', ['palco', 'audio'])
        public = ok(rpc('ospite_evento_apri', {'p_token': r['ospite_token']}))
        self.assertEqual(set(public), {'titolo','data','inizio','fine','tipo','sezioni','dati','nome_compilatore','contatto_compilatore','stato','revisione'})
        self.assertNotIn('ACCORDO RISERVATO', json.dumps(public))

        editor = self.login()
        editor.goto('http://127.0.0.1:8765/#evento/' + b['id'])
        editor.get_by_role('button', name='Modifica informazioni', exact=True).click()
        dlg = editor.locator('#dlg-evento-sala')
        expect(dlg.locator('[data-delega="palco"]')).to_be_checked()
        expect(dlg.locator('#tecnica-disposizione_palco')).not_to_be_visible()
        dlg.locator('[data-delega="logistica"]').check()
        dlg.locator('[data-delega="logistica"]').uncheck()
        expect(dlg.locator('#tecnica-arrivo')).to_be_visible()
        dlg.locator('#es-salva').click()
        expect(dlg).not_to_be_visible()
        page = self.context.new_page()
        page.set_viewport_size({'width':390,'height':844})
        page.goto('http://127.0.0.1:8765/modulo/ospite.html?t=' + r['ospite_token'])
        expect(page.locator('#ospite-form')).to_be_visible()
        self.assertLessEqual(page.evaluate('document.documentElement.scrollWidth - innerWidth'), 1)
        self.assertEqual(page.locator('#ospite-esigenze_luci, #ospite-arrivo, #es-note_interne').count(), 0)
        page.locator('#ospite-nome').fill('Tecnico compagnia')
        page.locator('#ospite-contatto').fill('3339876543')
        page.locator('#ospite-persone_palco').fill('4')
        page.locator('#ospite-disposizione_palco').fill('Quattro sedie e un tavolo al centro')
        page.locator('#ospite-audio_uso').fill('Voci dal vivo e base musicale')
        page.locator('#ospite-invia').click()
        expect(page.get_by_role('heading', name='Informazioni inviate')).to_be_visible()
        staff = editor
        staff.goto('http://127.0.0.1:8765/#evento/' + b['id'])
        expect(staff.locator('#evento-sala-panel')).to_contain_text('Quattro sedie e un tavolo al centro')
        staff.get_by_role('button', name='Verifica e conferma esigenze').click()
        expect(staff.locator('#evento-sala-panel')).to_contain_text('Esigenze confermate dalla Sala')
        confirmed = ok(api('/rest/v1/eventi_sala?booking_id=eq.' + b['id'], service=True))[0]
        self.assertEqual(confirmed['tecnica_confermata']['persone_palco'], '4')
        page.reload()
        expect(page.locator('#ospite-form')).to_be_visible()
        page.locator('#ospite-disposizione_palco').fill('Cinque sedie e un tavolo al centro')
        page.locator('#ospite-invia').click()
        expect(page.get_by_role('heading', name='Informazioni inviate')).to_be_visible()
        updated = ok(api('/rest/v1/eventi_sala?booking_id=eq.' + b['id'], service=True))[0]
        self.assertIsNone(updated['tecnica_confermata'])
        self.assertIsNone(updated['verificata_il'])
        self.assertEqual(updated['stato_ospite'], 'da_verificare')
        self.assertEqual(updated['interni']['note_interne'], 'ACCORDO RISERVATO 98765')

    def test_sala_token_revocation_scope_permissions_and_revisions(self):
        b, r, body = self.sala_evento('teatro', ['palco'])
        guest = {'p_token': r['ospite_token'], 'p_dati': {'persone_palco':'4','disposizione_palco':'Sedie in cerchio'},
                 'p_nome':'Tecnico ospite','p_contatto':'3331234567','p_revisione':r['revisione']}
        for forbidden in ('note_interne','esigenze_luci','prezzo','referente_interno'):
            result = rpc('ospite_evento_invia', {**guest, 'p_dati': {**guest['p_dati'], forbidden:'Segreto'}})
            self.assertGreaterEqual(result[0], 400)
        self.assertGreaterEqual(rpc('ospite_evento_invia', {**guest, 'p_dati': {'persone_palco':'0','disposizione_palco':'Sedie in cerchio'}})[0],400)
        self.assertGreaterEqual(api('/rest/v1/rpc/evento_sala_conferma','POST',{'p_booking':b['id'],'p_revisione':r['revisione']},token=self.users['admin']['token'])[0],400)
        for role in ('volontario','in_attesa','bloccato'):
            token = self.users[role]['token']
            self.assertEqual(ok(api('/rest/v1/eventi_sala?booking_id=eq.' + b['id'], token=token)),[])
            self.assertGreaterEqual(api('/rest/v1/rpc/evento_sala_salva','POST',body,token=token)[0],400)
            result=api('/rest/v1/eventi_sala?booking_id=eq.' + b['id'],'PATCH',{'interni':{'note_interne':'HACK'}},token=token)
            self.assertTrue(result[0]>=400 or result[1]==[])
        self.assertEqual(ok(api('/rest/v1/eventi_sala?booking_id=eq.' + b['id'])),[])
        body.update(p_revisione=r['revisione'],p_tipo='conferenza',p_sezioni=['palco'])
        self.assertGreaterEqual(api('/rest/v1/rpc/evento_sala_salva','POST',body,token=self.users['admin']['token'])[0],400)
        body.update(p_sezioni=['audio'])
        new = ok(api('/rest/v1/rpc/evento_sala_salva','POST',body,token=self.users['segreteria']['token']))
        self.assertNotEqual(new['ospite_token'],r['ospite_token'])
        self.assertIsNone(ok(rpc('ospite_evento_apri',{'p_token':r['ospite_token']})))
        self.assertGreaterEqual(rpc('ospite_evento_invia',guest)[0],400)
        self.assertGreaterEqual(api('/rest/v1/rpc/evento_sala_salva','POST',body,token=self.users['admin']['token'])[0],400)
        self.assertEqual(new['ospite_dati'],{})
        for mutation in ({'stato':'annullata'},{'stato':'confermata','della_sala':False}):
            ok(api('/rest/v1/bookings?id=eq.'+b['id'],'PATCH',mutation,service=True))
            self.assertIsNone(ok(rpc('ospite_evento_apri',{'p_token':new['ospite_token']})))
            self.assertGreaterEqual(rpc('ospite_evento_invia',{**guest,'p_token':new['ospite_token'],'p_revisione':new['revisione'],'p_dati':{'audio_uso':'Due microfoni'}})[0],400)


    def test_sala_draft_validation_and_booking_changes_require_review(self):
        b, r, body = self.sala_evento('proiezione', ['video'])
        staff = self.users['admin']['token']
        submit = {'p_token': r['ospite_token'], 'p_dati': {'contenuti_video': 'Documentario', 'supporto_video': 'File MP4'},
                  'p_nome': 'Tecnico ospite', 'p_contatto': '3331234567', 'p_revisione': r['revisione']}
        self.assertGreaterEqual(rpc('ospite_evento_invia', {**submit, 'p_dati': {**submit['p_dati'], 'documento_tecnico_url': 'javascript:alert(1)'}})[0],400)
        ok(rpc('ospite_evento_invia', submit))
        current = ok(api('/rest/v1/eventi_sala?booking_id=eq.'+b['id'],service=True))[0]
        # A reply arriving after the editor opened cannot be overwritten.
        body['p_revisione'] = r['revisione']
        self.assertGreaterEqual(api('/rest/v1/rpc/evento_sala_salva','POST',body,token=staff)[0],400)
        confirmed = ok(api('/rest/v1/rpc/evento_sala_conferma','POST',{'p_booking':b['id'],'p_revisione':current['revisione']},token=staff))
        self.assertIsNotNone(confirmed['verificata_il'])
        ok(api('/rest/v1/bookings?id=eq.'+b['id'],'PATCH',{'inizio':'17:00'},token=staff))
        changed = ok(api('/rest/v1/eventi_sala?booking_id=eq.'+b['id'],service=True))[0]
        self.assertIsNone(changed['verificata_il'])
        self.assertIsNone(changed['tecnica_confermata'])
        self.assertNotEqual(changed['revisione'],confirmed['revisione'])
        ok(api('/rest/v1/bookings?id=eq.'+b['id'],'PATCH',{'stato':'annullata'},token=staff))
        ok(api('/rest/v1/bookings?id=eq.'+b['id'],'PATCH',{'stato':'confermata'},token=staff))
        self.assertIsNone(ok(rpc('ospite_evento_apri',{'p_token':r['ospite_token']})))
        changed = ok(api('/rest/v1/eventi_sala?booking_id=eq.'+b['id'],service=True))[0]
        body['p_revisione'] = changed['revisione']
        body['p_interni'] = {'referente_interno':'Anna'}
        draft = ok(api('/rest/v1/rpc/evento_sala_salva','POST',body,token=staff))
        self.assertFalse(draft['interni_completi'])
        self.assertNotEqual(draft['ospite_token'],r['ospite_token'])
        self.assertIsNotNone(draft['ospite_token'])
        self.assertGreaterEqual(api('/rest/v1/rpc/evento_sala_conferma','POST',{'p_booking':b['id'],'p_revisione':draft['revisione']},token=staff)[0],400)


    def group_people(self):
        records = [{'chiave': 'man:' + uuid4().hex, 'nome': name + ' ' + uuid4().hex[:6], 'telefono': phone,
                    'email': uuid4().hex + '@example.test', 'note': 'Nota personale riservata'}
                   for name, phone in [('Anna Referente','3331111111'),('Bruno Referente','3332222222')]]
        ok(api('/rest/v1/rubrica','POST',records,token=self.users['admin']['token']))
        self.contact_keys.extend(r['chiave'] for r in records)
        return records

    def group_record(self, people, **extra):
        data = {'p_id': None, 'p_nome': 'Gruppo prova ' + uuid4().hex[:8], 'p_tipo': 'parrocchia',
                'p_persone': people, 'p_referente': people[0]['chiave'] if people else None,
                'p_note': 'Nota gruppo strettamente riservata', 'p_archiviato': False, 'p_revisione': None, **extra}
        r = ok(api('/rest/v1/rpc/gruppo_salva','POST',data,token=self.users['admin']['token']))
        self.group_ids.append(r['id'])
        return r, data

    def test_groups_browser_default_override_and_history(self):
        people = self.group_people()
        bookings = [self.booking(), self.booking()]
        page = self.login()
        page.goto('http://127.0.0.1:8765/#rubrica')
        page.get_by_role('button',name='+ Nuovo gruppo',exact=True).click()
        title = 'Gruppo browser ' + uuid4().hex[:8]
        dlg = page.locator('#dlg-gruppo')
        dlg.locator('#gr-nome').fill(title)
        for p in people:
            dlg.locator('#gr-persone input[value="'+p['chiave']+'"]').check()
        dlg.locator('#gr-cerca').fill(people[0]['telefono'])
        expect(dlg.locator('#gr-persone input[value="'+people[0]['chiave']+'"]')).to_be_visible()
        expect(dlg.locator('#gr-persone input[value="'+people[1]['chiave']+'"]')).not_to_be_visible()
        dlg.locator('#gr-cerca').fill('')
        dlg.locator('#gr-referente').select_option(people[0]['chiave'])
        dlg.get_by_role('button',name='Salva gruppo',exact=True).click()
        expect(dlg).not_to_be_visible()
        g = ok(api('/rest/v1/gruppi?nome=eq.'+title.replace(' ','%20'),service=True))[0]
        self.group_ids.append(g['id'])
        for i, b in enumerate(bookings):
            page.goto('http://127.0.0.1:8765/#evento/'+b['id'])
            page.locator('[data-event-action="edit"]').first.click()
            page.locator('#b-gruppo').select_option(g['id'])
            expect(page.locator('#b-referente')).to_have_value(people[0]['nome'])
            if i:
                page.locator('#b-persona').select_option(people[1]['chiave'])
            expect(page.locator('#b-email')).to_have_value(people[i]['email'])
            page.locator('#b-submit').click()
            expect(page.locator('#dlg-booking')).not_to_be_visible()
            expect(page.locator('#evento-body')).to_contain_text(title)
        page.goto('http://127.0.0.1:8765/#rubrica')
        page.locator('[data-gr="'+g['id']+'"]').click()
        dlg.locator('#gr-referente').select_option(people[1]['chiave'])
        dlg.get_by_role('button',name='Salva gruppo',exact=True).click()
        expect(dlg).not_to_be_visible()
        for i,b in enumerate(bookings):
            current=ok(api('/rest/v1/bookings?id=eq.'+b['id'],service=True))[0]
            self.assertEqual((current['gruppo_id'],current['persona_chiave'],current['referente']), (g['id'],people[i]['chiave'],people[i]['nome']))
            self.assertEqual(current['prezzo'],500)
        page.goto('http://127.0.0.1:8765/#evento/'+bookings[0]['id'])
        page.locator('[data-event-action="edit"]').first.click()
        expect(page.locator('#b-persona')).to_have_value(people[0]['chiave'])
        page.locator('#dlg-booking').get_by_role('button',name='Chiudi',exact=True).click()
        page.set_viewport_size({'width':390,'height':844})
        page.goto('http://127.0.0.1:8765/#rubrica')
        page.locator('[data-gr="'+g['id']+'"]').click()
        self.assertLessEqual(dlg.evaluate('(el)=>el.scrollWidth-el.clientWidth'),1)
        dlg.locator('#gr-chiudi').click()
        page.locator('[data-rb="'+people[0]['chiave']+'"]').click()
        expect(page.locator('#rb-scheda')).to_contain_text(title)
        expect(page.locator('#rb-storia')).to_contain_text(bookings[0]['titolo'])
        expect(page.locator('#rb-nascondi')).to_have_text('Nascondi dalla rubrica')

    def test_groups_membership_roles_archive_and_revision(self):
        people=self.group_people()
        g,body=self.group_record(people)
        found={'chiave':'mail:'+uuid4().hex+'@example.test','nome':'Contatto trovato','telefono':'3339876543','email':uuid4().hex+'@example.test','ente':'Ente originale','categoria':'Volontario'}
        self.contact_keys.append(found['chiave'])
        other,_=self.group_record([people[0],found])
        saved=ok(api('/rest/v1/rubrica?chiave=eq.'+found['chiave'],service=True))[0]
        self.assertEqual((saved['nome'],saved['ente'],saved['categoria']),('Contatto trovato','Ente originale','Volontario'))
        self.assertEqual(len(ok(api('/rest/v1/gruppi_persone?persona_chiave=eq.'+people[0]['chiave'],service=True))),2)
        self.assertEqual(ok(api('/rest/v1/rubrica?chiave=eq.'+people[0]['chiave'],service=True))[0]['note'],'Nota personale riservata')
        for role in ('volontario','in_attesa','bloccato'):
            token=self.users[role]['token']
            for table in ('gruppi','gruppi_persone'):
                self.assertEqual(ok(api('/rest/v1/'+table,token=token)),[])
            self.assertGreaterEqual(api('/rest/v1/rpc/gruppo_salva','POST',body,token=token)[0],400)
        self.assertEqual(ok(api('/rest/v1/gruppi')),[])
        invalid={**body,'p_id':g['id'],'p_revisione':g['revisione'],'p_referente':'man:non-membro'}
        self.assertGreaterEqual(api('/rest/v1/rpc/gruppo_salva','POST',invalid,token=self.users['admin']['token'])[0],400)
        duplicate={**body,'p_nome':g['nome'].upper()}
        self.assertGreaterEqual(api('/rest/v1/rpc/gruppo_salva','POST',duplicate,token=self.users['admin']['token'])[0],400)
        b=self.booking()
        ok(api('/rest/v1/bookings?id=eq.'+b['id'],'PATCH',{'gruppo_id':g['id'],'persona_chiave':people[0]['chiave']},token=self.users['admin']['token']))
        archived=ok(api('/rest/v1/rpc/gruppo_salva','POST',{**body,'p_id':g['id'],'p_revisione':g['revisione'],'p_archiviato':True},token=self.users['segreteria']['token']))
        self.assertTrue(archived['archiviato'])
        ok(api('/rest/v1/bookings?id=eq.'+b['id'],'PATCH',{'persona_chiave':people[1]['chiave']},token=self.users['admin']['token']))
        self.assertGreaterEqual(api('/rest/v1/rpc/gruppo_salva','POST',{**body,'p_id':g['id'],'p_revisione':g['revisione']},token=self.users['admin']['token'])[0],400)
        second=self.booking()
        self.assertGreaterEqual(api('/rest/v1/bookings?id=eq.'+second['id'],'PATCH',{'gruppo_id':g['id']},token=self.users['admin']['token'])[0],400)
        ok(api('/rest/v1/bookings?id=eq.'+b['id'],'PATCH',{'note':'Lo storico resta modificabile'},token=self.users['admin']['token']))
        self.assertGreaterEqual(api('/rest/v1/rubrica?chiave=eq.'+people[0]['chiave'],'DELETE',service=True)[0],400)
        self.assertGreaterEqual(api('/rest/v1/gruppi?id=eq.'+g['id'],'DELETE',service=True)[0],400)
        self.assertGreaterEqual(api('/rest/v1/rpc/gruppo_salva','POST',body)[0],400)

    def test_groups_parish_prefill_and_approval_keep_association(self):
        people=self.group_people()
        g,_=self.group_record(people)
        page=self.login()
        page.goto('http://127.0.0.1:8765/#schede')
        page.locator('#sc-parrocchia').click()
        page.locator('#ns-gruppo').select_option(g['id'])
        expect(page.locator('#ns-dest')).to_have_value(people[0]['nome'])
        title='Richiesta gruppo '+uuid4().hex[:8]
        page.locator('#ns-titolo').fill(title)
        page.locator('#ns-form [type=submit]').click()
        expect(page.locator('#dlg-copy')).to_be_visible()
        token=re.search(r'[?&]t=([0-9a-f-]+)',page.locator('#copy-text').input_value())[1]
        s=ok(api('/rest/v1/schede?token=eq.'+token,service=True))[0]
        self.parish_ids.append(s['id'])
        public=ok(rpc('scheda_apri',{'p_token':token}))
        self.assertNotIn('strettamente riservata',json.dumps(public))
        self.assertNotIn(people[1]['email'],json.dumps(public))
        self.assertNotIn('persona_chiave',public)
        form=self.context.new_page()
        form.goto('http://127.0.0.1:8765/modulo/compila.html?t='+token)
        expect(form.locator('#p-gruppo')).to_have_value(g['nome'])
        expect(form.locator('#p-referente')).to_have_value(people[0]['nome'])
        expect(form.locator('#p-cellulare')).to_have_value(people[0]['telefono'])
        _,data=self.parish_request()
        data.update(gruppo=g['nome'],referente=people[0]['nome'],cellulare=people[0]['telefono'],email=people[0]['email'])
        ok(rpc('scheda_invia',{'p_token':token,'p_dati':data,'p_firma':data['referente']}))
        ok(self.approve_parish(s))
        bookings=ok(api('/rest/v1/bookings?scheda_parrocchia_id=eq.'+s['id'],service=True))
        self.assertEqual(len(bookings),1)
        self.assertEqual((bookings[0]['gruppo_id'],bookings[0]['persona_chiave'],bookings[0]['prezzo']),(g['id'],people[0]['chiave'],0))

    def test_groups_public_changed_identity_is_not_linked_to_wrong_person(self):
        people=self.group_people()
        g,_=self.group_record(people)
        s,data=self.parish_request()
        ok(api('/rest/v1/schede?id=eq.'+s['id'],'PATCH',{'gruppo_id':g['id'],'persona_chiave':people[0]['chiave']},token=self.users['admin']['token']))
        data.update(gruppo='Un altro gruppo',referente='Una persona differente')
        ok(rpc('scheda_invia',{'p_token':s['token'],'p_dati':data,'p_firma':data['referente']}))
        ok(self.approve_parish(s))
        b=ok(api('/rest/v1/bookings?scheda_parrocchia_id=eq.'+s['id'],service=True))[0]
        self.assertIsNone(b['gruppo_id'])
        self.assertIsNone(b['persona_chiave'])
        self.assertEqual(b['referente'],'Una persona differente')


    def import_group_rows(self, rows, token=None):
        return api('/rest/v1/rpc/gruppi_importa_collegamenti','POST',{'p_collegamenti':rows},token=token or self.users['admin']['token'])

    def test_group_import_browser_reuse_preserve_and_edit_after_import(self):
        people=self.group_people()
        g,body=self.group_record([people[0]])
        new_name='Gruppo "Musica; Teatro" '+uuid4().hex[:8]
        output=io.StringIO(newline='')
        writer=csv.writer(output,delimiter=';')
        writer.writerow(['Stato','Persona','Gruppo','Tipo gruppo','Dettagli'])
        writer.writerow(['CONFERMATO',people[1]['nome'],g['nome'],'compagnia','Una nota\ncon due righe'])
        writer.writerow(['CONFERMATO',people[1]['nome'],new_name,'compagnia',''])
        writer.writerow(['CONFERMATO',people[1]['nome'],new_name,'compagnia','Riga duplicata'])
        writer.writerow(['DA CONFERMARE',people[0]['nome'],'Non importare','associazione',''])
        writer.writerow(['GRUPPO SENZA PERSONA IDENTIFICATA','','Senza referente','altro',''])
        payload={'name':'collegamenti.csv','mimeType':'text/csv','buffer':('\ufeff'+output.getvalue()).encode()}
        page=self.login()
        page.goto('http://127.0.0.1:8765/#rubrica')
        for attempt in range(2):
            page.get_by_role('button',name='Importa collegamenti',exact=True).click()
            dlg=page.locator('#dlg-importa-gruppi')
            dlg.locator('#gi-file').set_input_files(payload)
            expect(dlg.locator('#gi-info')).to_contain_text('3 collegamenti confermati · 2 righe non confermate escluse')
            expect(dlg.locator('#gi-persona-0')).to_have_value(people[1]['chiave'])
            dlg.locator('#gi-salva').click()
            expect(dlg).not_to_be_visible()
            groups=ok(api('/rest/v1/gruppi',service=True))
            new=next(r for r in groups if r['nome']==new_name)
            if not attempt:self.group_ids.append(new['id'])
            self.assertIsNone(new['referente_chiave'])
            existing=next(r for r in groups if r['id']==g['id'])
            self.assertEqual((existing['note'],existing['referente_chiave'],existing['tipo']),(body['p_note'],people[0]['chiave'],'parrocchia'))
            self.assertEqual(len(ok(api('/rest/v1/gruppi_persone?gruppo_id=eq.'+g['id'],service=True))),2)
            self.assertEqual(len(ok(api('/rest/v1/gruppi_persone?gruppo_id=eq.'+new['id'],service=True))),1)
        page.locator('[data-gr="'+new['id']+'"]').click()
        edit=page.locator('#dlg-gruppo')
        changed='Nome corretto '+uuid4().hex[:8]
        edit.locator('#gr-nome').fill(changed)
        edit.locator('#gr-referente').select_option(people[1]['chiave'])
        edit.get_by_role('button',name='Salva gruppo',exact=True).click()
        expect(edit).not_to_be_visible()
        current=ok(api('/rest/v1/gruppi?id=eq.'+new['id'],service=True))[0]
        self.assertEqual((current['nome'],current['referente_chiave']),(changed,people[1]['chiave']))
        page.locator('[data-gr="'+g['id']+'"]').click()
        edit.locator('#gr-persone input[value="'+people[1]['chiave']+'"]').uncheck()
        edit.get_by_role('button',name='Salva gruppo',exact=True).click()
        expect(edit).not_to_be_visible()
        self.assertEqual([m['persona_chiave'] for m in ok(api('/rest/v1/gruppi_persone?gruppo_id=eq.'+g['id'],service=True))],[people[0]['chiave']])

    def test_group_import_atomic_permissions_revisions_and_archive(self):
        people=self.group_people()
        g,body=self.group_record([people[0]],p_nome='AA importazione '+uuid4().hex[:8])
        row={'gruppo':g['nome'],'tipo':'parrocchia','persona':people[1],'revisione_gruppo':g['revisione']}
        bad={'gruppo':'ZZ errore '+uuid4().hex[:8],'tipo':'altro','persona':{'chiave':'man:'+uuid4().hex,'nome':''},'revisione_gruppo':None}
        self.assertGreaterEqual(self.import_group_rows([row,bad])[0],400)
        self.assertEqual(len(ok(api('/rest/v1/gruppi_persone?gruppo_id=eq.'+g['id'],service=True))),1)
        self.assertEqual(ok(api('/rest/v1/gruppi?id=eq.'+g['id'],service=True))[0]['revisione'],g['revisione'])
        self.assertEqual(ok(api('/rest/v1/rubrica?chiave=eq.'+bad['persona']['chiave'],service=True)),[])
        for role in ('volontario','in_attesa','bloccato'):
            self.assertGreaterEqual(self.import_group_rows([row],token=self.users[role]['token'])[0],400)
        self.assertGreaterEqual(rpc('gruppi_importa_collegamenti',{'p_collegamenti':[row]})[0],400)
        saved=ok(self.import_group_rows([row],token=self.users['segreteria']['token']))
        self.assertEqual(saved,{'collegamenti_aggiunti':1,'gia_presenti':0,'gruppi_creati':0})
        self.assertGreaterEqual(self.import_group_rows([row])[0],400)
        latest=ok(api('/rest/v1/gruppi?id=eq.'+g['id'],service=True))[0]
        row['revisione_gruppo']=latest['revisione']
        self.assertEqual(ok(self.import_group_rows([row]))['gia_presenti'],1)
        self.assertEqual(ok(api('/rest/v1/gruppi?id=eq.'+g['id'],service=True))[0]['revisione'],latest['revisione'])
        ok(api('/rest/v1/rpc/gruppo_salva','POST',{**body,'p_id':g['id'],'p_persone':people,'p_archiviato':True,'p_revisione':latest['revisione']},token=self.users['admin']['token']))
        latest=ok(api('/rest/v1/gruppi?id=eq.'+g['id'],service=True))[0]
        row['revisione_gruppo']=latest['revisione']
        self.assertGreaterEqual(self.import_group_rows([row])[0],400)

    def test_group_import_csv_invalid_and_selection_can_be_corrected(self):
        people=self.group_people()
        page=self.login()
        page.goto('http://127.0.0.1:8765/#rubrica')
        page.get_by_role('button',name='Importa collegamenti',exact=True).click()
        dlg=page.locator('#dlg-importa-gruppi')
        for data in ['Stato;Persona;Gruppo;Tipo gruppo\nCONFERMATO;"Virgolette aperte',
                     'Nome;Email\nPersona;persona@example.test',
                     'Stato;Persona;Gruppo;Tipo gruppo\nDA CONFERMARE;Persona;Gruppo;altro']:
            dlg.locator('#gi-file').set_input_files({'name':'errato.csv','mimeType':'text/csv','buffer':data.encode()})
            expect(dlg.locator('#gi-error')).not_to_be_empty()
            expect(dlg.locator('#gi-salva')).to_be_disabled()
        attack='<img src=x onerror=window.csvExecuted=true>'
        group_name='Da correggere '+uuid4().hex[:8]
        output=io.StringIO(newline='');writer=csv.writer(output,delimiter=';')
        writer.writerow(['Stato','Persona','Gruppo','Tipo gruppo'])
        writer.writerow(['CONFERMATO',attack,group_name,'altro'])
        dlg.locator('#gi-file').set_input_files({'name':'correggibile.csv','mimeType':'text/csv','buffer':output.getvalue().encode()})
        expect(dlg.locator('#gi-info')).to_contain_text('1 collegamenti confermati')
        expect(dlg.locator('#gi-salva')).to_be_disabled()
        self.assertEqual(dlg.locator('img').count(),0)
        self.assertIsNone(page.evaluate('window.csvExecuted'))
        dlg.locator('#gi-persona-0').select_option(people[0]['chiave'])
        dlg.locator('[data-gi-usa]').uncheck()
        expect(dlg.locator('#gi-salva')).to_be_disabled()
        dlg.locator('[data-gi-usa]').check()
        expect(dlg.locator('#gi-salva')).to_be_enabled()
        page.set_viewport_size({'width':390,'height':844})
        self.assertLessEqual(dlg.evaluate('(el)=>el.scrollWidth-el.clientWidth'),1)
        corrected='Corretto '+uuid4().hex[:8]
        dlg.locator('#gi-gruppo-0').fill(corrected)
        dlg.locator('#gi-salva').click()
        expect(dlg).not_to_be_visible()
        records=ok(api('/rest/v1/gruppi',service=True))
        created=next(r for r in records if r['nome']==corrected)
        self.group_ids.append(created['id'])
        self.assertEqual(ok(api('/rest/v1/gruppi_persone?gruppo_id=eq.'+created['id'],service=True))[0]['persona_chiave'],people[0]['chiave'])



    def test_group_import_stale_preview_preserves_group_edits(self):
        people=self.group_people()
        g,body=self.group_record([people[0]])
        page=self.login()
        page.goto('http://127.0.0.1:8765/#rubrica')
        page.get_by_role('button',name='Importa collegamenti',exact=True).click()
        dlg=page.locator('#dlg-importa-gruppi')
        output=io.StringIO(newline='');writer=csv.writer(output,delimiter=';')
        writer.writerow(['Stato','Persona','Gruppo','Tipo gruppo'])
        writer.writerow(['CONFERMATO',people[1]['nome'],g['nome'],'parrocchia'])
        dlg.locator('#gi-file').set_input_files({'name':'confermati.csv','mimeType':'text/csv','buffer':output.getvalue().encode()})
        expect(dlg.locator('#gi-salva')).to_be_enabled()
        updated_name='Nome modificato nel frattempo '+uuid4().hex[:8]
        ok(api('/rest/v1/rpc/gruppo_salva','POST',{**body,'p_id':g['id'],'p_nome':updated_name,'p_revisione':g['revisione']},token=self.users['admin']['token']))
        dlg.locator('#gi-salva').click()
        expect(dlg.locator('#gi-error')).to_contain_text('ricarica')
        self.assertEqual(ok(api('/rest/v1/gruppi?id=eq.'+g['id'],service=True))[0]['nome'],updated_name)
        self.assertEqual(len(ok(api('/rest/v1/gruppi_persone?gruppo_id=eq.'+g['id'],service=True))),1)
        self.assertEqual(sum(r['nome']==g['nome'] for r in ok(api('/rest/v1/gruppi',service=True))),0)


    def dance_request(self):
        b=self.booking()
        s=ok(api('/rest/v1/schede','POST',{'booking_id':b['id'],'titolo':'Saggio scuola danza','stato':'inviata'},token=self.users['admin']['token']))[0]
        self.parish_ids.append(s['id'])
        d={'ente':'Scuola danza test','referente':'Referente danza','cellulare':'3331234567','titolo':'Saggio scuola danza','tipo':'danza','fascia':'platea','palco_n':10,
           'danza_versione':1,'danza_stili':'Danza classica e contemporanea','danza_ballerini_n':30,'danza_minori_n':20,'danza_eta':'8–17 anni','danza_accompagnatori_n':5,
           'danza_responsabile_minori':'Insegnante responsabile','danza_responsabile_cell':'3337654321','danza_pubblico_n':200,'danza_pavimento':'tappeto_sala','danza_calzature':'Mezze punte e piedi nudi',
           'danza_cambi':'si','danza_cambi_note':'Due gruppi di dieci ballerini con accompagnatori','danza_retro_n':8,'danza_musica':'registrata','danza_audio_supporto':'File WAV su USB con scaletta numerata',
           'danza_audio_responsabile':'Operatore audio test','danza_audio_cell':'3339876543','danza_luci':'Luce fissa e cambi tra coreografie','danza_conferma':True,
           'siae':'no','ok_regole':True,'ok_dichiarazione':True,'ok_privacy':True,'firma':'Referente danza',
           'orari':[{'data':DAY,'utilizzo':'prove','inizio':'10:00','fine':'12:00','all_da':'09:00','all_a':'09:30','porte':'','sgombero':'12:30'},
                    {'data':DAY,'utilizzo':'saggio','inizio':'18:00','fine':'20:00','all_da':'16:00','all_a':'17:00','porte':'17:30','sgombero':'21:00'}]}
        return b,s,d

    def send_dance(self,s,d):
        return rpc('scheda_invia',{'p_token':s['token'],'p_dati':d,'p_firma':d.get('firma','Referente danza')})

    def test_dance_conditional_form_draft_review_and_approved_summary(self):
        b,s,d=self.dance_request()
        page=self.context.new_page()
        page.goto('http://127.0.0.1:8765/modulo/compila.html?t='+s['token'])
        expect(page.locator('#scheda')).to_be_visible()
        expect(page.locator('#danza-dettagli')).not_to_be_visible()
        page.get_by_role('radio',name='Saggio di danza',exact=True).check()
        expect(page.locator('#danza-dettagli')).to_be_visible()
        expect(page.locator('#modulo-percorso')).to_contain_text('Saggio di danza')
        for k,v in d.items():
            if k in ('tipo','fascia','orari','danza_versione'):continue
            fields=page.locator('[name="'+k+'"]')
            if fields.count()==0:continue
            kind=fields.first.get_attribute('type')
            if kind=='radio':page.locator('[name="'+k+'"][value="'+str(v)+'"]').check()
            elif kind=='checkbox':fields.check()
            else:fields.fill(str(v))
        first=page.locator('.riga-orari').first
        first.locator('[name=o_utilizzo]').select_option('prove')
        for k,v in d['orari'][0].items():
            if k!='utilizzo':first.locator('[name="o_'+k+'"]').fill(v)
        page.get_by_role('button',name='+ Aggiungi una prova o una replica',exact=True).click()
        second=page.locator('.riga-orari').nth(1)
        for k,v in d['orari'][1].items():
            if k!='utilizzo':second.locator('[name="o_'+k+'"]').fill(v)
        page.reload()
        expect(page.locator('#danza-dettagli')).to_be_visible()
        expect(page.locator('[name=danza_responsabile_minori]')).to_have_value(d['danza_responsabile_minori'])
        expect(page.locator('[name=danza_cambi_note]')).to_have_value(d['danza_cambi_note'])
        page.set_viewport_size({'width':390,'height':844})
        self.assertLessEqual(page.evaluate('document.documentElement.scrollWidth-innerWidth'),1)
        page.locator('#btn-invia').click()
        expect(page.get_by_role('heading',name='Grazie, scheda inviata!',exact=True)).to_be_visible()
        saved=ok(api('/rest/v1/schede?id=eq.'+s['id'],service=True))[0]
        self.assertEqual(saved['dati']['danza_minori_n'],20)
        self.assertEqual([o['utilizzo'] for o in saved['dati']['orari']],['prove','saggio'])
        page.reload()
        expect(page.locator('[name=danza_luci]')).to_have_value(d['danza_luci'])
        page.locator('[name=danza_luci]').fill('Luce uniforme concordata e cambio finale')
        page.reload()
        expect(page.locator('[name=danza_luci]')).to_have_value('Luce uniforme concordata e cambio finale')
        page.locator('#btn-invia').click()
        expect(page.get_by_role('heading',name='Grazie, scheda inviata!',exact=True)).to_be_visible()
        staff=self.login()
        staff.goto('http://127.0.0.1:8765/#evento/'+b['id'])
        expect(staff.locator('#evento-programma')).to_contain_text('Due gruppi di dieci ballerini')
        staff.locator('[data-event-action=document]').first.click()
        staff.locator('[name=sk-sic][value=compatibile]').check()
        staff.locator('#sk-note').fill('Nota interna danza riservata')
        staff.locator('#sk-approva').click()
        expect(staff.locator('#sk-error')).to_contain_text('Completa le verifiche')
        for check in staff.locator('[data-danza-verifica]').all():check.check()
        staff.locator('#sk-approva').click()
        expect(staff.locator('#dlg-scheda')).not_to_be_visible()
        page.reload()
        expect(page.get_by_role('heading',name='Scheda danza approvata',exact=True)).to_be_visible()
        expect(page.locator('.danza-riepilogo')).to_contain_text('Luce uniforme concordata')
        expect(page.locator('body')).not_to_contain_text('Nota interna danza riservata')
        expect(page.locator('#scheda')).to_have_count(0)
        public=ok(rpc('scheda_apri',{'p_token':s['token']}))
        self.assertNotIn('danza_verifica',public)
        self.assertNotIn('sicurezza_note',public)
        current=ok(api('/rest/v1/bookings?id=eq.'+b['id'],service=True))[0]
        self.assertEqual((current['prezzo'],current['inizio'],current['fine']),(500,'18:00:00','22:00:00'))
        self.assertEqual(len(ok(api('/rest/v1/bookings?scheda_parrocchia_id=eq.'+s['id'],service=True))),0)

    def test_dance_server_checks_conditional_fields_times_and_capacity(self):
        b,s,d=self.dance_request()
        ok(api('/rest/v1/schede?id=eq.'+s['id'],'PATCH',{'dati':{'tipo':'danza'},'stato':'aperta'},token=self.users['admin']['token']))
        self.assertGreaterEqual(api('/rest/v1/schede?id=eq.'+s['id'],'PATCH',{'stato':'approvata','sicurezza':'compatibile'},token=self.users['admin']['token'])[0],400)

        changes=[{'danza_versione':'1'},{'danza_minori_n':31},{'palco_n':31},{'danza_pubblico_n':339},
                 {'danza_accompagnatori_n':0},{'danza_responsabile_cell':''},{'danza_pavimento':'tappeto_proprio','danza_tappeto_note':''},
                 {'danza_cambi_note':''},{'danza_audio_supporto':''},{'danza_link_tecnico':'javascript:alert(1)'},{'danza_conferma':False},{'ok_regole':False}]
        for change in changes:
            with self.subTest(change=change):self.assertGreaterEqual(self.send_dance(s,{**d,**change})[0],400)
        for key,value in [('fine','09:00'),('sgombero','11:00'),('all_a','13:00')]:
            rows=[{**d['orari'][0],key:value},d['orari'][1]]
            self.assertGreaterEqual(self.send_dance(s,{**d,'orari':rows})[0],400)
        rows=[{**d['orari'][0],'sgombero':'18:00'},d['orari'][1]]
        self.assertGreaterEqual(self.send_dance(s,{**d,'orari':rows})[0],400)
        ok(self.send_dance(s,{**d,'fascia':'tutta','danza_pubblico_n':472}))
        self.assertEqual(ok(api('/rest/v1/schede?id=eq.'+s['id'],service=True))[0]['stato'],'compilata')

    def test_dance_approval_is_staff_checked_and_resubmission_clears_checks(self):
        _,s,d=self.dance_request()
        ok(self.send_dance(s,d))
        staff=self.users['admin']['token']
        checks={k:True for k in ('programma','pavimento','retropalco','tecnica','minori')}
        target='/rest/v1/schede?id=eq.'+s['id']
        self.assertGreaterEqual(api(target,'PATCH',{'stato':'approvata','sicurezza':'compatibile'},token=staff)[0],400)
        self.assertGreaterEqual(api(target,'PATCH',{'stato':'approvata','sicurezza':'compatibile','danza_verifica':{**checks,'minori':False}},token=staff)[0],400)
        ok(api(target,'PATCH',{'danza_verifica':checks},token=staff))
        ok(self.send_dance(s,{**d,'danza_luci':'Nuova scaletta con cambi luce'}))
        self.assertEqual(ok(api(target,service=True))[0]['danza_verifica'],{})
        self.assertGreaterEqual(api(target,'PATCH',{'stato':'approvata','sicurezza':'non_compatibile','danza_verifica':checks},token=staff)[0],400)
        ok(api(target,'PATCH',{'stato':'approvata','sicurezza':'condizioni','danza_verifica':checks},token=staff))
        self.assertGreaterEqual(self.send_dance(s,d)[0],400)

    def test_dance_questions_disappear_and_other_requests_still_work(self):
        _,s,d=self.dance_request()
        page=self.context.new_page()
        page.goto('http://127.0.0.1:8765/modulo/compila.html?t='+s['token'])
        page.get_by_role('radio',name='Saggio di danza',exact=True).check()
        page.locator('[name=danza_stili]').fill('Informazione danza da non inviare')
        page.get_by_role('radio',name='conferenza / incontro',exact=True).check()
        expect(page.locator('#danza-dettagli')).not_to_be_visible()
        for k in ('ente','referente','cellulare','titolo','firma'):page.locator('[name='+k+']').fill(d[k])
        page.locator('[name=fascia][value=galleria]').check()
        page.locator('[name=siae][value=no]').check()
        for k in ('ok_regole','ok_dichiarazione','ok_privacy'):page.locator('[name='+k+']').check()
        page.locator('#btn-invia').click()
        expect(page.get_by_role('heading',name='Grazie, scheda inviata!',exact=True)).to_be_visible()
        data=ok(api('/rest/v1/schede?id=eq.'+s['id'],service=True))[0]['dati']
        self.assertEqual(data['tipo'],'conferenza')
        self.assertFalse(any(k.startswith('danza_') for k in data))
        self.assertNotIn('utilizzo',data['orari'][0])

    def test_dance_details_are_private_for_volunteers(self):
        b,s,d=self.dance_request()
        ok(self.send_dance(s,d))
        page=self.login('volontario')
        page.goto('http://127.0.0.1:8765/#evento/'+b['id'])
        expect(page.locator('#evento-titolo')).to_be_visible()
        expect(page.locator('.danza-riepilogo')).to_have_count(0)
        expect(page.locator('body')).not_to_contain_text(d['danza_responsabile_minori'])
        self.assertEqual(ok(api('/rest/v1/schede?id=eq.'+s['id'],token=self.users['volontario']['token'])),[])



    def test_dance_stale_review_does_not_approve_changed_answers(self):
        b,s,d=self.dance_request()
        ok(self.send_dance(s,d))
        page=self.login()
        page.goto('http://127.0.0.1:8765/#evento/'+b['id'])
        page.locator('[data-event-action=document]').first.click()
        page.locator('[name=sk-sic][value=compatibile]').check()
        for check in page.locator('[data-danza-verifica]').all():check.check()
        ok(self.send_dance(s,{**d,'danza_luci':'Scaletta modificata mentre la Sala verifica'}))
        page.locator('#sk-approva').click()
        expect(page.locator('#sk-error')).to_contain_text('cambiate')
        saved=ok(api('/rest/v1/schede?id=eq.'+s['id'],service=True))[0]
        self.assertEqual(saved['stato'],'compilata')
        self.assertEqual(saved['danza_verifica'],{})


    def cash_badge_volunteers(self):
        people=self.volunteers()
        for v in people:
            ok(api('/rest/v1/volontari?id=eq.'+v['id'],'PATCH',{'cassa_badge':True},token=self.users['admin']['token']))
        return people

    def cash_badge_session(self,v):
        r=ok(rpc('cassa_badge_accesso',{'p_badge':v['badge']}))
        self.assertTrue(r['ok'],r.get('errore'))
        return r['sessione']

    def cash_badge_body(self,session):
        info=ok(rpc('cassa_badge_leggi',{'p_sessione':session}))
        return {'data':info['data'],'evento':'','titolo':'Cassa prova '+uuid4().hex[:8],
                'fondo_iniziale':100,'online_n':2,'online_euro':14,'contanti_n':10,'contanti_euro':70,
                'pos_n':3,'pos_euro':21,'omaggi_n':1,'contati':None,'conteggio':{},'prelievo':0,'note':'Note cassa test'}

    def cash_badge_save(self,session,body,c=None,close=False,badge=None):
        return rpc('cassa_badge_salva',{'p_sessione':session,'p_id':c['id'] if c else None,'p_dati':body,
                   'p_chiudi':close,'p_revisione':c['aggiornato'] if c else None,'p_badge_chiusura':badge})

    def test_cash_badge_browser_without_account_counts_and_different_closer(self):
        a,b=self.cash_badge_volunteers()
        page=self.context.new_page()
        page.goto('http://127.0.0.1:8765/modulo/cassa.html')
        expect(page.locator('#cb-accesso')).to_be_visible()
        self.assertEqual(page.locator('#btn-login').count(),0)
        page.locator('#cb-badge').fill(a['badge'])
        expect(page.locator('#cb-nuova')).to_be_visible()
        self.assertEqual(page.evaluate('localStorage.length'),0)
        self.assertEqual(page.evaluate('sessionStorage.length'),0)
        page.locator('#cb-nuova').click()
        title='Cassa browser badge '+uuid4().hex[:8]
        page.locator('#cb-titolo').fill(title)
        page.get_by_text('Conta il fondo iniziale',exact=True).click()
        page.locator('[data-cb-conto=fondo][data-taglio="50"]').fill('2')
        expect(page.locator('#cb-fondo_iniziale')).to_have_value('100')
        for kind,n,e in [('online','2','14'),('contanti','10','70'),('pos','3','21')]:
            if kind=='online':
                page.locator('#cb-'+kind+'_n').fill(n)
            else:
                self.assertEqual(page.locator('#cb-'+kind+'_n').count(),0)
            page.locator('#cb-'+kind+'_euro').fill(e)
        page.locator('#cb-omaggi_n').fill('1')
        page.locator('#cb-salva').click()
        expect(page.locator('#cb-nuova')).to_be_visible()
        row=next(c for c in ok(api('/rest/v1/cassa',service=True)) if c['titolo']==title)
        self.cash_ids.append(row['id'])
        self.assertEqual((row['aperta_da_nome'],row['aperta_volontario_id'],row['creato_da']),(a['nome'],a['id'],None))
        page.locator('[data-cb-apri="'+row['id']+'"]').click()
        page.get_by_text('Conta i contanti a fine serata',exact=True).click()
        for taglio,pezzi in [('100','1'),('50','1'),('20','1')]:
            page.locator('[data-cb-conto=chiusura][data-taglio="'+taglio+'"]').fill(pezzi)
        page.locator('#cb-prelievo').fill('70')
        expect(page.locator('#cb-contati')).to_have_value('170')
        expect(page.locator('#cb-totali')).to_contain_text('Quadra')
        page.set_viewport_size({'width':390,'height':844})
        self.assertLessEqual(page.evaluate('document.documentElement.scrollWidth-innerWidth'),1)
        page.locator('#cb-chiudi').click()
        page.locator('#cb-badge-chiusura').fill(b['badge'])
        expect(page.locator('#cb-accesso')).to_be_visible()
        expect(page.locator('#cb-error')).to_contain_text('Cassa chiusa da '+b['nome'])
        row=ok(api('/rest/v1/cassa?id=eq.'+row['id'],service=True))[0]
        self.assertEqual((row['stato'],row['chiusa_da_nome'],row['chiusa_volontario_id'],row['fondo_finale']),('chiusa',b['nome'],b['id'],100))
        expect(page.locator('#cb-app')).not_to_contain_text(title)
        page.locator('#cb-badge').fill(b['badge']);page.locator('#cb-badge').press('Enter')
        page.locator('[data-cb-apri="'+row['id']+'"]').click()
        expect(page.locator('#cb-app')).to_contain_text('Fondo finale:')
        expect(page.locator('#cb-stampa')).to_be_visible()
        self.assertEqual(page.locator('#cb-salva').count(),0)
        page.get_by_role('link',name='Gestionale della Sala',exact=True).click()
        expect(page.locator('#screen-login')).to_be_visible()
        page.get_by_role('link',name='Cassa con badge · senza account',exact=True).click()
        expect(page.locator('#cb-accesso')).to_be_visible()

    def test_cash_badge_permission_revocation_rotation_expiry_and_private_data(self):
        a,b=self.volunteers()
        self.assertFalse(ok(rpc('cassa_badge_accesso',{'p_badge':a['badge']}))['ok'])
        ok(api('/rest/v1/volontari?id=eq.'+a['id'],'PATCH',{'cassa_badge':True},token=self.users['admin']['token']))
        session=self.cash_badge_session(a)
        data=ok(rpc('cassa_badge_leggi',{'p_sessione':session}))
        self.assertNotIn('cellulare',data)
        self.assertNotIn('data_nascita',data)
        for table in ('cassa','cassa_badge_sessioni','cassa_badge_limiti'):
            self.assertEqual(ok(api('/rest/v1/'+table)),[])
        self.assertGreaterEqual(rpc('cassa_badge_controlla',{'p_sessione':session})[0],400)
        self.assertGreaterEqual(rpc('cassa_badge_leggi',{'p_sessione':str(uuid4())})[0],400)
        ok(api('/rest/v1/volontari?id=eq.'+a['id'],'PATCH',{'cassa_badge':False},service=True))
        self.assertGreaterEqual(rpc('cassa_badge_leggi',{'p_sessione':session})[0],400)
        ok(api('/rest/v1/volontari?id=eq.'+a['id'],'PATCH',{'cassa_badge':True},service=True))
        self.assertGreaterEqual(rpc('cassa_badge_leggi',{'p_sessione':session})[0],400)
        session=self.cash_badge_session(a)
        new_badge=ok(api('/rest/v1/rpc/volontario_badge_nuovo','POST',{'p_volontario':a['id']},token=self.users['admin']['token']))
        self.assertFalse(ok(rpc('cassa_badge_accesso',{'p_badge':a['badge']}))['ok'])
        self.assertGreaterEqual(rpc('cassa_badge_leggi',{'p_sessione':session})[0],400)
        a['badge']=new_badge;session=self.cash_badge_session(a)
        ok(api('/rest/v1/cassa_badge_sessioni?volontario_id=eq.'+a['id'],'PATCH',{'scade':'2000-01-01T00:00:00Z'},service=True))
        self.assertGreaterEqual(rpc('cassa_badge_leggi',{'p_sessione':session})[0],400)
        session=self.cash_badge_session(a)
        ok(rpc('cassa_badge_esci',{'p_sessione':session}))
        self.assertGreaterEqual(rpc('cassa_badge_leggi',{'p_sessione':session})[0],400)
        result=api('/rest/v1/volontari?id=eq.'+b['id'],'PATCH',{'cassa_badge':True},token=self.users['volontario']['token'])
        self.assertTrue(result[0]>=400 or result[1]==[])
        self.assertFalse(ok(api('/rest/v1/volontari?id=eq.'+b['id'],service=True))[0]['cassa_badge'])

    def test_cash_badge_server_money_revision_dates_closing_and_concurrency(self):
        a,b=self.cash_badge_volunteers()
        session=self.cash_badge_session(a);other=self.cash_badge_session(b)
        body=self.cash_badge_body(session)
        future={**body,'data':DAY}
        self.assertGreaterEqual(self.cash_badge_save(session,future)[0],400)
        self.assertGreaterEqual(self.cash_badge_save(session,{**body,'fondo_finale':99999})[0],400)
        self.assertGreaterEqual(self.cash_badge_save(session,{**body,'online_n':-1})[0],400)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(lambda token:self.cash_badge_save(token,body),[session,other]))
        self.assertEqual(sum(r[0]<300 and r[1].get('ok') for r in results),1)
        created=next(r[1]['cassa'] for r in results if r[0]<300 and r[1].get('ok'))
        self.cash_ids.append(created['id'])
        self.assertEqual(created['fondo_finale'],170)
        changed=ok(self.cash_badge_save(session,{**body,'contanti_n':11,'contanti_euro':77},created))['cassa']
        self.assertGreaterEqual(self.cash_badge_save(other,body,created)[0],400)
        self.assertGreaterEqual(self.cash_badge_save(session,body,changed,True,b['badge'])[0],400)
        result=ok(self.cash_badge_save(session,{**body,'contati':170},changed,True,'NONVALIDO'))
        self.assertFalse(result['ok'])
        counted={**body,'fondo_iniziale':0,'contati':999,'prelievo':70,'conteggio':{'_fondo':{'50':2},'100':1,'50':1,'20':1}}
        closed=ok(self.cash_badge_save(session,counted,changed,True,b['badge']))['cassa']
        self.assertEqual((closed['fondo_iniziale'],closed['contati'],closed['fondo_finale']),(100,170,100))
        self.assertGreaterEqual(self.cash_badge_save(session,counted,closed)[0],400)
        tamper=api('/rest/v1/cassa?id=eq.'+closed['id'],'PATCH',{'contanti_euro':999})
        self.assertTrue(tamper[0]>=400 or tamper[1]==[])
        self.assertEqual(ok(api('/rest/v1/cassa?id=eq.'+closed['id'],service=True))[0]['contanti_euro'],70)

    def test_cash_badge_admin_enable_and_public_entry_link(self):
        a,b=self.volunteers()
        page=self.login()
        page.goto('http://127.0.0.1:8765/#volontari')
        page.locator('[data-vedit="'+a['id']+'"]').first.click()
        page.locator('#v-cassa-badge').check()
        page.locator('#volontario-form [type=submit]').click()
        expect(page.locator('#dlg-volontario')).not_to_be_visible()
        self.assertTrue(ok(api('/rest/v1/volontari?id=eq.'+a['id'],service=True))[0]['cassa_badge'])
        self.assertTrue(ok(rpc('cassa_badge_accesso',{'p_badge':a['badge']}))['ok'])
        page.goto('http://127.0.0.1:8765/#economia')
        with page.expect_download() as exported:
            page.locator('#btn-export').click()
        backup=json.loads(Path(exported.value.path()).read_text())
        record=next(v for v in backup['volontari'] if v['id']==a['id'])
        self.assertTrue(record['cassa_badge'])
        self.assertTrue({'badge','token','cf_impronta'}.isdisjoint(record))




    def test_cash_badge_rate_limit_commits_on_bad_codes(self):
        a,_=self.cash_badge_volunteers()
        ok(api('/rest/v1/cassa_badge_limiti?id=eq.1','DELETE',service=True))
        try:
            for _ in range(120):
                r=ok(rpc('cassa_badge_accesso',{'p_badge':'NONVALIDO'}))
                self.assertFalse(r['ok'])
            blocked=ok(rpc('cassa_badge_accesso',{'p_badge':a['badge']}))
            self.assertFalse(blocked['ok'])
            self.assertIn('Troppi tentativi',blocked['errore'])
        finally:ok(api('/rest/v1/cassa_badge_limiti?id=eq.1','DELETE',service=True))



    def test_cash_badge_today_projection_booking_scope_and_idle_expiry(self):
        a,_=self.cash_badge_volunteers()
        session=self.cash_badge_session(a)
        body=self.cash_badge_body(session)
        film=ok(api('/rest/v1/films','POST',{'titolo':'Film cassa '+uuid4().hex[:8],'note':'Nota film privata'},token=self.users['admin']['token']))[0]
        self.cash_film_ids.append(film['id'])
        projection=ok(api('/rest/v1/proiezioni','POST',{'film_id':film['id'],'data':body['data'],'ora':'20:30'},token=self.users['admin']['token']))[0]
        data=ok(rpc('cassa_badge_leggi',{'p_sessione':session}))
        event=next(e for e in data['eventi'] if e['valore']=='p:'+projection['id'])
        self.assertEqual(set(event),{'valore','titolo','ora'})
        self.assertNotIn('Nota film privata',str(data))
        saved=ok(self.cash_badge_save(session,{**body,'evento':event['valore']}))['cassa']
        self.cash_ids.append(saved['id'])
        self.assertEqual(saved['proiezione_id'],projection['id'])
        self.assertEqual(saved['titolo'],film['titolo']+' · 20:30')
        b=self.booking()
        self.assertGreaterEqual(self.cash_badge_save(session,{**body,'evento':'b:'+b['id']})[0],400)
        ok(api('/rest/v1/bookings?id=eq.'+b['id'],'PATCH',{'data':body['data']},token=self.users['admin']['token']))
        booked=ok(self.cash_badge_save(session,{**body,'evento':'b:'+b['id']}))['cassa']
        self.cash_ids.append(booked['id'])
        self.assertEqual(booked['booking_id'],b['id'])
        self.assertGreaterEqual(self.cash_badge_save(session,{**body,'evento':'b:'+b['id']},saved)[0],400)
        self.assertGreaterEqual(rpc('cassa_badge_leggi',{'p_sessione':session,'p_data':DAY})[0],400)
        ok(api('/rest/v1/cassa_badge_sessioni?volontario_id=eq.'+a['id'],'PATCH',{'ultimo_uso':'2000-01-01T00:00:00Z'},service=True))
        self.assertGreaterEqual(rpc('cassa_badge_leggi',{'p_sessione':session})[0],400)


    def prep_body(self, b, **changes):
        return {'p_booking': b['id'], 'p_proiezione': None, 'p_compito': 'chiavi',
                'p_stato': 'pronto', 'p_responsabile': 'Ada apertura', 'p_note': 'Nota interna riservata',
                'p_data': b['data'], 'p_ora': b['inizio'], 'p_revisione': None, **changes}

    def prep_save(self, body, role='admin'):
        return api('/rest/v1/rpc/preparazione_salva', 'POST', body, token=self.users[role]['token'])

    def test_preparazione_permissions_conflicts_and_reschedule(self):
        b = self.booking()
        body = self.prep_body(b)
        row = ok(self.prep_save(body))
        self.assertEqual((row['booking_id'], row['stato'], row['responsabile']), (b['id'], 'pronto', 'Ada apertura'))
        self.assertEqual(ok(api('/rest/v1/evento_preparazione', token=self.users['volontario']['token'])), [])
        public = ok(api('/rest/v1/preparazione_operativa?booking_id=eq.'+b['id'], token=self.users['volontario']['token']))[0]
        self.assertEqual(public['responsabile'], 'Ada apertura')
        self.assertTrue({'note','aggiornato_da','revisione'}.isdisjoint(public))
        self.assertGreaterEqual(rpc('preparazione_salva', body)[0], 400)
        self.assertGreaterEqual(api('/rest/v1/preparazione_operativa')[0], 400)
        for role in ('volontario','in_attesa','bloccato'):
            self.assertGreaterEqual(self.prep_save(body,role)[0],400)
            if role != 'volontario':
                self.assertEqual(ok(api('/rest/v1/preparazione_operativa',token=self.users[role]['token'])),[])
        for role in ('coordinatore','segreteria'):
            row = ok(self.prep_save({**body,'p_revisione':row['revisione'],'p_stato':'in_corso'},role))
        self.assertGreaterEqual(api('/rest/v1/evento_preparazione?id=eq.'+row['id'],'PATCH',{'stato':'pronto'},token=self.users['admin']['token'])[0],400)
        current = {**body,'p_revisione':row['revisione']}
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(self.prep_save,[current,current]))
        self.assertEqual(sum(code<300 for code,_ in results),1)
        for change in ({'p_responsabile':''},{'p_stato':'inventato'},{'p_compito':'conferma'},{'p_note':'x'*2001},{'p_data':'2000-01-01'}):
            self.assertGreaterEqual(self.prep_save({**body,**change})[0],400)
        row = ok(api('/rest/v1/evento_preparazione?id=eq.'+row['id'],service=True))[0]
        ok(api('/rest/v1/bookings?id=eq.'+b['id'],'PATCH',{'inizio':'17:00'},service=True))
        self.assertGreaterEqual(self.prep_save({**body,'p_revisione':row['revisione']})[0],400)
        ok(api('/rest/v1/bookings?id=eq.'+b['id'],'PATCH',{'stato':'annullata'},service=True))
        self.assertGreaterEqual(self.prep_save({**body,'p_ora':'17:00','p_revisione':row['revisione']})[0],400)
        self.assertEqual(ok(api('/rest/v1/preparazione_operativa?booking_id=eq.'+b['id'],token=self.users['volontario']['token'])),[])
        ok(api('/rest/v1/bookings?id=eq.'+b['id'],'DELETE',service=True))
        self.assertEqual(ok(api('/rest/v1/evento_preparazione?id=eq.'+row['id'],service=True)),[])

    def test_preparazione_today_browser_staff_and_volunteer(self):
        b = self.booking()
        today = date.today().isoformat()
        ok(api('/rest/v1/bookings?id=eq.'+b['id'],'PATCH',{'data':today,'referente':'Referente privato','note':'Dettaglio privato'},service=True))
        tomorrow = self.booking()
        ok(api('/rest/v1/bookings?id=eq.'+tomorrow['id'],'PATCH',{'data':(date.today()+timedelta(days=1)).isoformat()},service=True))
        cancelled = self.booking()
        ok(api('/rest/v1/bookings?id=eq.'+cancelled['id'],'PATCH',{'data':today,'stato':'annullata'},service=True))
        ok(api('/rest/v1/signups','POST',{'booking_id':b['id'],'slot_id':'porta','nome':'Ada turno','user_id':self.users['volontario']['id']},service=True))
        page = self.login()
        expect(page.locator('#view-oggi')).to_be_visible()
        card = page.locator('[data-oggi-evento="b:'+b['id']+'"]')
        expect(card).to_contain_text('Ada turno')
        expect(card).to_contain_text('Referente privato')
        expect(card).to_contain_text('Volontari')
        expect(page.locator('[data-oggi-evento="b:'+cancelled['id']+'"]')).to_have_count(0)
        expect(page.locator('[data-oggi-evento="b:'+tomorrow['id']+'"]')).to_have_count(0)
        page.locator('[data-oggi-periodo="domani"]').click()
        expect(page.locator('[data-oggi-evento="b:'+tomorrow['id']+'"]')).to_be_visible()
        page.locator('[data-oggi-periodo="oggi"]').click()
        card.get_by_role('link',name='Apri scheda evento').click()
        expect(page.locator('[data-prep-voce="turni"]')).to_contain_text('1 posto da coprire')
        page.locator('[data-prep-voce=conferma] [data-event-action=edit]').click()
        expect(page.locator('#dlg-booking')).to_be_visible()
        page.locator('#dlg-booking [data-close]').first.click()
        page.locator('[data-prep-compito="chiavi"]').click()
        page.locator('#prep-stato').select_option('pronto')
        page.locator('#prep-responsabile').fill('Ada apertura')
        page.locator('#prep-note').fill('Nota interna riservata <script>')
        page.get_by_role('button',name='Salva preparazione',exact=True).click()
        expect(page.locator('#dlg-preparazione')).not_to_be_visible()
        expect(page.locator('[data-prep-voce="chiavi"]')).to_contain_text('Pronto')
        expect(page.locator('[data-prep-voce="chiavi"]')).to_contain_text('Ada apertura')
        page.reload()
        expect(page.locator('[data-prep-voce="chiavi"]')).to_contain_text('Nota interna riservata <script>')
        # Complete manual tasks cannot approve a request or fill empty volunteer places.
        for compito in ('tecnico','allestimento','cassa'):
            ok(self.prep_save(self.prep_body({**b,'data':today},p_compito=compito,p_stato='non_serve')))
        page.reload()
        expect(page.locator('#evento-preparazione')).not_to_contain_text('Preparazione completa')
        page.goto('http://127.0.0.1:8765/#oggi')
        page.set_viewport_size({'width':390,'height':844})
        expect(card).to_be_visible()
        self.assertLessEqual(page.evaluate('document.documentElement.scrollWidth-innerWidth'),1)
        if os.environ.get('SALA_TODAY_SCREENSHOT'):
            page.locator('#sipario').wait_for(state='detached',timeout=10000)
            page.screenshot(path=os.environ['SALA_TODAY_SCREENSHOT'],full_page=True)
        ok(api('/rest/v1/signups','POST',{'booking_id':b['id'],'slot_id':'porta','nome':'Bruno turno','user_id':self.users['admin']['id']},service=True))
        ok(api('/rest/v1/schede','POST',{'booking_id':b['id'],'titolo':b['titolo'],'stato':'non_serve'},service=True))
        page.reload()
        expect(card).to_contain_text('Preparazione completa')
        ok(api('/rest/v1/bookings?id=eq.'+b['id'],'PATCH',{'inizio':'17:00'},service=True))
        page.goto('http://127.0.0.1:8765/#evento/'+b['id'])
        page.reload()
        expect(page.locator('[data-prep-voce="chiavi"]')).to_contain_text('Evento spostato: ricontrollare')
        page.locator('#app [data-logout]').click()
        expect(page.locator('#screen-login')).to_be_visible()
        volunteer = self.login('volontario')
        vcard = volunteer.locator('[data-oggi-evento="b:'+b['id']+'"]')
        expect(vcard).to_contain_text('Ada turno')
        expect(vcard).not_to_contain_text('Referente privato')
        vcard.get_by_role('link',name='Apri scheda evento').click()
        expect(volunteer.locator('[data-prep-voce="chiavi"]')).to_contain_text('Ada apertura')
        expect(volunteer.locator('#evento-preparazione')).not_to_contain_text('Nota interna riservata')
        expect(volunteer.locator('[data-prep-compito]')).to_have_count(0)

    def test_preparazione_unavailable_services_stay_unknown(self):
        b = self.booking()
        for table in ('evento_preparazione','schede','signups'):
            self.context.route('**/rest/v1/'+table+'*',lambda route: route.fulfill(status=503,content_type='application/json',body='{"message":"Servizio non disponibile"}'))
        page = self.login()
        page.goto('http://127.0.0.1:8765/#evento/'+b['id'])
        expect(page.locator('#evento-preparazione')).to_contain_text('Preparazione non disponibile',timeout=30000)
        for key in ('informazioni','turni','chiavi'):
            expect(page.locator('[data-prep-voce="'+key+'"]')).to_contain_text('Dati non disponibili')
        expect(page.locator('#evento-preparazione')).not_to_contain_text('Preparazione completa')
        expect(page.locator('[data-prep-compito="chiavi"]')).to_be_disabled()
        expect(page.locator('#dlg-preparazione')).not_to_be_visible()

    def test_preparazione_projection_browser_and_problem(self):
        film = ok(api('/rest/v1/films','POST',{'titolo':'Film preparazione '+uuid4().hex[:8],'supporto':'file','acquisizione':'disponibile','provato_il':date.today().isoformat(),'prova_esito':'ok'},service=True))[0]
        self.cash_film_ids.append(film['id'])
        projection = ok(api('/rest/v1/proiezioni','POST',{'film_id':film['id'],'data':date.today().isoformat(),'ora':'20:30'},service=True))[0]
        for compito in ('volontari','tecnico','chiavi','allestimento','cassa'):
            ok(self.prep_save(self.prep_body({'id':None,'data':projection['data'],'inizio':projection['ora']},p_proiezione=projection['id'],p_compito=compito)))
        page = self.login()
        card = page.locator('[data-oggi-evento="p:'+projection['id']+'"]')
        expect(card).to_contain_text('Preparazione completa')
        card.get_by_role('button',name='Preparazione',exact=True).click()
        expect(page.locator('#dlg-preparazione')).to_contain_text('Supporto disponibile e prova riuscita')
        page.locator('#dlg-preparazione [data-prep-compito="tecnico"]').click()
        page.locator('#prep-stato').select_option('problema')
        page.locator('#prep-note').fill('Cavo da sostituire')
        page.get_by_role('button',name='Salva preparazione',exact=True).click()
        expect(page.locator('#dlg-preparazione')).not_to_be_visible()
        expect(card).to_contain_text('Problemi da risolvere')
        card.get_by_role('button',name='Preparazione',exact=True).click()
        page.locator('#dlg-preparazione').get_by_role('link',name='Apri cinema',exact=True).first.click()
        expect(page.locator('#dlg-preparazione')).not_to_be_visible()
        expect(page.locator('#view-cinema')).to_be_visible()
        self.assertEqual(ok(api('/rest/v1/cassa?proiezione_id=eq.'+projection['id'],service=True)),[])


if __name__ == '__main__':
    unittest.main(verbosity=2)
