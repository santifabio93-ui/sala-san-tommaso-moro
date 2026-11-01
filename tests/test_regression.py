"""Real local Supabase API + browser regression tests. No production access."""
import concurrent.futures
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
        page.get_by_role('button', name='Prepara informazioni e invito').click()
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


if __name__ == '__main__':
    unittest.main(verbosity=2)
