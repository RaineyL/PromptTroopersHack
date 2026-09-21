"""Behaviour tests for the SI versus draft BL comparison stage."""

import unittest

from fastapi.testclient import TestClient

from app.main import app
from app.services.comparison import compare_documents, compare_pair
from app.services.comparison.labels import read_labelled_lines
from app.services.comparison.normalize import container_count, gross_weight_kg, party, port

SI_TEXT = (
    'SHIPPING INSTRUCTION\n'
    'Shipper: APRIL FAR EAST (M) SDN BHD\n'
    '  TOWER 2, AVENUE 5; 59200 KUALA LUMPUR, MALAYSIA\n'
    'Consignee (Non-Negotiable): EAST BRIGHT FZ-LLC\n'
    '  RAKEZ AMENITY CENTER; RAK, UAE\n'
    'Notify: EAST BRIGHT FZ-LLC\n'
    'Port of Loading (POL): NANTONG, CHINA (CNNTG)\n'
    'POD: KARACHI, PAKISTAN (PKKHI)\n'
    "Total Containers: 6 x 40'HC\n"
    'Gross Wt (kgs): 131,058 KG\n'
)

BL_TEXT = SI_TEXT.replace('SHIPPING INSTRUCTION', 'BILL OF LADING (DRAFT)')


def document(name: str, text: str, **overrides) -> dict:
    record = {'file': name, 'status': 'ok', 'flag_reason': None, 'raw_text': text, 'fields': {}}
    record.update(overrides)
    return record


class NormalisationTests(unittest.TestCase):
    def test_party_compares_the_name_not_the_address(self):
        # Two different companies sharing a consignee address must not be
        # pulled together by the address text they have in common.
        left = party('EAST BRIGHT FZ-LLC RAKEZ AMENITY CENTER; RAK, UAE', name_line='EAST BRIGHT FZ-LLC')
        right = party('UAB NOVAKOPA RAKEZ AMENITY CENTER; RAK, UAE', name_line='UAB NOVAKOPA')
        self.assertNotEqual(left.comparable, right.comparable)

    def test_party_splits_a_spreadsheet_address_off_the_name_line(self):
        value = party('x', name_line='APRIL FINE PAPER TRADING | 77 ROBINSON ROAD; SINGAPORE')
        self.assertEqual(value.comparable, 'APRIL FINE PAPER TRADING')

    def test_port_ignores_a_missing_locode_and_punctuation(self):
        self.assertEqual(port('NANTONG, CHINA (CNNTG)').comparable, port('NANTONG. CHINA').comparable)

    def test_port_keeps_the_city_so_a_reused_locode_cannot_hide_a_defect(self):
        self.assertNotEqual(port('NEW YORK, US (USNYC)').comparable,
                            port('KLAIPEDA, LITHUANIA (USNYC)').comparable)

    def test_container_count_reads_the_quantity_not_the_box_size(self):
        self.assertEqual(container_count("6 x 40'HC").comparable, 6)

    def test_container_count_survives_a_lost_separator(self):
        self.assertEqual(container_count('120FCL').comparable, 1)

    def test_weight_converts_units_and_strips_separators(self):
        self.assertEqual(gross_weight_kg('131,058 KG').comparable, 131058.0)
        self.assertEqual(gross_weight_kg('22.8 MT').comparable, 22800.0)

    def test_placeholders_are_absent_not_values(self):
        for text in ('____MT', 'TBA', 'N/A', '   '):
            self.assertFalse(gross_weight_kg(text).present, text)
            self.assertFalse(port(text).present, text)


class LabelTests(unittest.TestCase):
    def test_notify_party_is_not_filed_as_consignee(self):
        found = read_labelled_lines('Notify Party/Intermediate Consignee: ACME LTD\n')
        self.assertIn('notify_party', found)
        self.assertNotIn('consignee', found)

    def test_net_weight_is_not_the_gross_weight(self):
        self.assertNotIn('gross_weight_kg', read_labelled_lines('NET WEIGHT: _______ MTS\n'))

    def test_a_blank_label_line_is_recorded_as_blank(self):
        self.assertEqual(read_labelled_lines('SHIPPER: \n')['shipper'], ('SHIPPER', ''))

    def test_pdf_layout_with_the_value_under_the_label(self):
        found = read_labelled_lines('Load Port\nBUATAN, INDONESIA\nPort of Discharge\nFREMANTLE, AUSTRALIA\n')
        self.assertEqual(found['port_of_loading'][1], 'BUATAN, INDONESIA')
        self.assertEqual(found['port_of_discharge'][1], 'FREMANTLE, AUSTRALIA')


class ComparisonTests(unittest.TestCase):
    def test_identical_documents_report_no_mismatch(self):
        result = compare_pair('email_001', document('email_001_SI.txt', SI_TEXT),
                              document('email_001_BL.txt', BL_TEXT))
        self.assertEqual(result['status'], 'OK')
        self.assertEqual(result['defect_fields'], [])

    def test_a_changed_consignee_is_reported_with_both_labels(self):
        changed = BL_TEXT.replace('Consignee (Non-Negotiable): EAST BRIGHT FZ-LLC',
                                  'To the Order of: UAB NOVAKOPA')
        result = compare_pair('email_002', document('email_002_SI.txt', SI_TEXT),
                              document('email_002_BL.txt', changed))
        self.assertEqual(result['status'], 'MISMATCH')
        self.assertIn('consignee', result['defect_fields'])
        row = next(item for item in result['fields'] if item['field'] == 'consignee')
        self.assertEqual(row['si_label'], 'Consignee (Non-Negotiable)')
        self.assertEqual(row['bl_label'], 'To the Order of')

    def test_a_missing_bl_is_review_not_a_clean_result(self):
        result = compare_pair('email_507', document('email_507_SI.txt', SI_TEXT), None)
        self.assertEqual(result['status'], 'NEEDS_REVIEW')
        self.assertEqual(result['review_reason'], 'missing_attachment')
        self.assertEqual(result['fields'], [])

    def test_the_wrong_document_is_review_not_a_clean_result(self):
        invoice = document('email_501_BL.txt', 'COMMERCIAL INVOICE\n', status='flagged',
                           flag_reason="Document appears to be 'Commercial Invoice', not a BL or SI")
        result = compare_pair('email_501', document('email_501_SI.txt', SI_TEXT), invoice)
        self.assertEqual(result['status'], 'NEEDS_REVIEW')
        self.assertEqual(result['review_reason'], 'wrong_doc_type')

    def test_an_unreadable_scan_is_review(self):
        scan = document('email_512_BL.pdf', '', status='flagged',
                        flag_reason='PDF text layer is empty or too short (0 chars) — likely image-only')
        result = compare_pair('email_512', document('email_512_SI.txt', SI_TEXT), scan)
        self.assertEqual(result['review_reason'], 'unreadable')

    def test_a_placeholder_value_is_review_for_that_field_only(self):
        blank = BL_TEXT.replace('Gross Wt (kgs): 131,058 KG', 'Gross Wt (kgs): N/A')
        result = compare_pair('email_516', document('email_516_SI.txt', SI_TEXT),
                              document('email_516_BL.txt', blank))
        self.assertEqual(result['status'], 'NEEDS_REVIEW')
        self.assertEqual(result['review_reason'], 'missing_value')
        self.assertEqual(result['review_fields'], ['gross_weight_kg'])

    def test_a_close_call_is_escalated_rather_than_guessed(self):
        close = BL_TEXT.replace('Notify: EAST BRIGHT FZ-LLC', 'Notify: EAST BRIGHT HOLDINGS')
        result = compare_pair('email_900', document('email_900_SI.txt', SI_TEXT),
                              document('email_900_BL.txt', close))
        row = next(item for item in result['fields'] if item['field'] == 'notify_party')
        self.assertIn(row['status'], {'review', 'mismatch'})

    def test_a_confirmed_defect_outranks_an_unclear_field(self):
        changed = (BL_TEXT.replace("Total Containers: 6 x 40'HC", "Total Containers: 5 x 40'HC")
                   .replace('Gross Wt (kgs): 131,058 KG', 'Gross Wt (kgs): TBA'))
        result = compare_pair('email_901', document('email_901_SI.txt', SI_TEXT),
                              document('email_901_BL.txt', changed))
        self.assertEqual(result['status'], 'MISMATCH')
        self.assertEqual(result['defect_fields'], ['container_count'])
        self.assertEqual(result['review_fields'], [])

    def test_documents_are_paired_by_email_id(self):
        outcome = compare_documents([
            document('email_001_SI.txt', SI_TEXT), document('email_001_BL.txt', BL_TEXT),
            document('email_002_SI.txt', SI_TEXT), document('email_002_BL.txt', BL_TEXT),
        ])
        self.assertEqual(outcome['summary']['emails'], 2)
        self.assertEqual(outcome['summary']['ok'], 2)

    def test_an_unrecognised_filename_is_reported_not_silently_dropped(self):
        outcome = compare_documents([document('notes.txt', SI_TEXT)])
        self.assertEqual(outcome['summary']['unpaired_files'], ['notes.txt'])


class CompareEndpointTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_compare_returns_a_result_for_each_email(self):
        response = self.client.post('/api/v1/compare', json={'documents': [
            document('email_001_SI.txt', SI_TEXT), document('email_001_BL.txt', BL_TEXT)]})
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body['summary']['emails'], 1)
        self.assertEqual(body['results'][0]['status'], 'OK')
        self.assertEqual(len(body['results'][0]['fields']), 7)

    def test_an_empty_request_is_rejected(self):
        self.assertEqual(self.client.post('/api/v1/compare', json={'documents': []}).status_code, 422)


class ExtractionContractTests(unittest.TestCase):
    def setUp(self):
        from app.schemas.classification import Email
        from app.schemas.extraction import DocumentExtraction, ExtractionResponse
        from app.services.extraction.fields import extract_fields
        fields, warnings = extract_fields(SI_TEXT)
        self.assertEqual(warnings, [])
        self.payload = ExtractionResponse(
            email=Email(email_id='email_001', body='Compare SI and BL'),
            si=DocumentExtraction(document_type='SI', attachments=['folder/instructions.txt'], status='extracted', fields=fields),
            bl=DocumentExtraction(document_type='BL', attachments=['draft.pdf'], status='extracted', fields=fields),
        ).model_dump(by_alias=True)
        self.client = TestClient(app)

    def compare(self):
        response = self.client.post('/api/v1/compare', json=self.payload)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()['results'][0]

    def test_exact_extraction_output_and_arbitrary_attachment_names(self):
        result = self.compare()
        self.assertEqual(result['status'], 'OK')
        self.assertEqual(result['si_document'], 'folder/instructions.txt')
        self.assertEqual(len(result['fields']), 7)

    def test_extracted_values_are_authoritative_over_source_text(self):
        self.payload['bl']['source_text'] = BL_TEXT
        self.payload['bl']['fields']['container_count']['value'] = '5'
        self.assertEqual(self.compare()['defect_fields'], ['container_count'])

    def test_canonical_decimal_kg_is_not_reinterpreted_as_thousands(self):
        self.payload['si']['fields']['gross_weight_kg']['value'] = '22.825'
        self.payload['bl']['fields']['gross_weight_kg']['value'] = '22825'
        self.assertEqual(self.compare()['defect_fields'], ['gross_weight_kg'])

    def test_extraction_problems_never_become_clean_results(self):
        import copy
        for changes in [
            {'status': 'needs_review', 'warnings': ['Conflicting shipper values']},
            {'status': 'error', 'error': 'Unreadable PDF'},
            {'attachments': []},
            {'attachments': ['a.txt', 'b.txt']},
            {'document_type': 'SI'},
            {'fields': None},
        ]:
            with self.subTest(changes=changes):
                original = copy.deepcopy(self.payload['bl'])
                self.payload['bl'].update(changes)
                result = self.compare()
                self.assertEqual(result['status'], 'NEEDS_REVIEW')
                self.assertEqual(result['fields'], [])
                self.payload['bl'] = original

    def test_missing_field_requires_review(self):
        self.payload['bl']['fields']['shipper']['value'] = None
        self.assertEqual(self.compare()['status'], 'NEEDS_REVIEW')

    def test_batch_and_duplicate_validation(self):
        response = self.client.post('/api/v1/compare', json={'extractions': [self.payload]})
        self.assertEqual(response.status_code, 200)
        for values in [[], [self.payload, self.payload]]:
            self.assertEqual(self.client.post('/api/v1/compare', json={'extractions': values}).status_code, 422)

    def test_malformed_extraction_is_rejected(self):
        self.payload['bl']['fields']['shipper'] = {'value': {'unexpected': 'object'}, 'evidence': None}
        self.assertEqual(self.client.post('/api/v1/compare', json=self.payload).status_code, 422)


if __name__ == '__main__':
    unittest.main()
