import os
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError

from fastapi.testclient import TestClient
from app.main import app
from app.schemas.classification import ClassifyRequest
from app.services.classification.engine import DeepSeekClient, split_message, attachment_metadata
from app.services.classification.pipeline import classify_email
from app.services.classification.evaluate import calculate_metrics, make_submission

EMAIL = {'email_id': 'test_1', 'from': 'shipping@example.com', 'subject': 'Draft BL',
         'body': 'Please check the BL against SI.', 'attachments': ['test_SI.txt', 'test_BL.txt']}


def prediction(**overrides):
    return dict(category='BL_COMPARISON', needs_human_review=False,
                rationale='An explicit comparison request.', evidence=[{'source': 'body', 'signal': 'Check the BL'}],
                **overrides)


class ClassificationTests(unittest.TestCase):
    def setUp(self):
        self.api = TestClient(app)
        self.model = Mock()
        self.model.classify.return_value = prediction()
        self.model.audit.return_value = {'recommended_category': 'GENERAL', 'needs_human_review': False,
                                        'reason': 'A bulk reminder.', 'question_for_user': None}

    def test_default_api_uses_deepseek_without_rules(self):
        with patch('app.services.classification.pipeline.get_model_client', return_value=self.model):
            response = self.api.post('/api/v1/classify', json={'email': EMAIL})
        self.assertEqual(response.status_code, 200)
        self.assertNotIn('mode', response.json())
        self.assertNotIn('confidence', response.json()['classification'])
        self.assertEqual(response.json()['classification']['category'], 'BL_COMPARISON')
        self.assertNotIn('next_step', response.json())
        self.assertNotIn('rule_result', response.json())
        self.assertNotIn('rule_engine_advisory', self.model.classify.call_args.args[1])
        self.model.audit.assert_not_called()

    def test_obsolete_mode_field_is_rejected(self):
        for mode in ('rules', 'hybrid', 'deepseek_only'):
            self.assertEqual(self.api.post('/api/v1/classify', json={'email': EMAIL, 'mode': mode}).status_code, 422)

    def test_openapi_has_no_mode_in_classification_payloads(self):
        schemas = self.api.get('/openapi.json').json()['components']['schemas']
        self.assertEqual(set(schemas['ClassifyRequest']['properties']), {'email'})
        self.assertNotIn('mode', schemas['ClassifyResponse']['properties'])
        self.assertNotIn('next_step', schemas['ClassifyResponse']['properties'])
        self.assertNotIn('confidence', schemas['Classification']['properties'])

    def test_legacy_provider_confidence_is_not_exposed(self):
        self.model.classify.return_value = {**prediction(), 'confidence': .95}
        result = classify_email(ClassifyRequest(email=EMAIL), self.model)
        self.assertNotIn('confidence', result.classification.model_dump())

    def test_pure_mode_has_no_rules_and_general_stops(self):
        self.model.classify.return_value = {**prediction(), 'category': 'GENERAL'}
        result = classify_email(ClassifyRequest(email=EMAIL), self.model)
        self.assertNotIn('rule_engine_advisory', self.model.classify.call_args.args[1])
        self.assertEqual(result.classification.category, 'GENERAL')
        self.assertNotIn('next_step', result.model_dump())

    def test_risk_audit_disagreement_requires_review_without_overwriting(self):
        email = {**EMAIL, 'body': 'Reminder for all pending shipments: send SI.'}
        result = classify_email(ClassifyRequest(email=email), self.model)
        self.assertTrue(result.classification.needs_human_review)
        self.assertEqual(result.classification.category, 'BL_COMPARISON')
        self.assertEqual(result.classification.competing_category, 'GENERAL')
        self.assertTrue(result.classification.question_for_user)
        self.assertIn('bulk_workflow_reminder', result.audit_risk_flags)

    def test_ambiguity_remains_review_even_if_audit_accepts(self):
        self.model.classify.return_value = {**prediction(), 'needs_human_review': True}
        self.model.audit.return_value['recommended_category'] = 'BL_COMPARISON'
        result = classify_email(ClassifyRequest(email=EMAIL), self.model)
        self.assertTrue(result.classification.needs_human_review)
        self.model.audit.assert_called_once()

    def test_missing_key_is_actionable(self):
        with patch.dict(os.environ, {}, clear=True):
            response = self.api.post('/api/v1/classify', json={'email': EMAIL})
        self.assertEqual(response.status_code, 503)
        self.assertIn('DEEPSEEK_API_KEY', response.json()['detail'])

    def test_provider_failure_is_sanitized(self):
        with patch('app.services.classification.pipeline.get_model_client', return_value=self.model):
            self.model.classify.side_effect = RuntimeError('private provider payload and secret')
            response = self.api.post('/api/v1/classify', json={'email': EMAIL})
        self.assertEqual(response.status_code, 502)
        self.assertNotIn('secret', response.text)

    def test_audit_failure_does_not_return_unaudited_success(self):
        self.model.classify.return_value = {**prediction(), 'needs_human_review': True}
        self.model.audit.side_effect = RuntimeError('audit failed')
        with patch('app.services.classification.pipeline.get_model_client', return_value=self.model):
            response = self.api.post('/api/v1/classify', json={'email': EMAIL})
        self.assertEqual(response.status_code, 502)

    def test_invalid_provider_json_is_rejected(self):
        self.model.classify.return_value = {**prediction(), 'category': 'OTHER'}
        with patch('app.services.classification.pipeline.get_model_client', return_value=self.model):
            response = self.api.post('/api/v1/classify', json={'email': EMAIL})
        self.assertEqual(response.status_code, 502)

    def test_request_boundaries(self):
        for email in ({**EMAIL, 'body': ''}, {**EMAIL, 'body': 'x' * 100001},
                      {**EMAIL, 'attachments': ['file'] * 101}, {**EMAIL, 'attachments': ['x' * 2001]},
                      {**EMAIL, 'email_id': ''}):
            with self.subTest(email_id=email['email_id']):
                self.assertEqual(self.api.post('/api/v1/classify', json={'email': email}).status_code, 422)
        self.assertEqual(self.api.post('/api/v1/classify', json={'email': EMAIL, 'mode': 'invalid'}).status_code, 422)

    def test_history_and_metadata(self):
        self.assertEqual(split_message('Current\n______________\nOld'), ('Current', 'Old'))
        self.assertEqual(attachment_metadata(['x_SI.txt', 'x_BL.pdf'])[1]['detected_document_type'], 'BL')

    def test_metrics_exclude_review_and_report_coverage(self):
        truth = {'a': {'category': 'GENERAL'}, 'b': {'category': 'SPAM'}}
        predictions = {'a': {'classification': {'category': 'GENERAL', 'needs_human_review': True}},
                       'b': {'classification': {'category': 'SPAM', 'needs_human_review': False}}}
        metrics = calculate_metrics(truth, predictions)
        self.assertEqual(metrics['excluded_human_review'], 1)
        self.assertEqual(metrics['automatic_decision_coverage'], .5)
        self.assertEqual(metrics['accuracy_excluding_human_review'], 1)

    def test_submission_never_claims_comparison_complete(self):
        predictions = {'a': {'classification': prediction()}}
        self.assertEqual(make_submission(predictions)['a']['status'], 'NEEDS_REVIEW')

    def test_auth_error_not_retried(self):
        with patch('urllib.request.urlopen', side_effect=HTTPError('https://test', 401, 'Denied', {}, None)) as call:
            with self.assertRaises(RuntimeError):
                DeepSeekClient('fake', 'https://test', 'test').classify('system', 'user')
        self.assertEqual(call.call_count, 1)

    def test_timeout_retries_are_bounded(self):
        with patch('urllib.request.urlopen', side_effect=TimeoutError), patch('time.sleep') as sleep:
            with self.assertRaises(RuntimeError):
                DeepSeekClient('fake', 'https://test', 'test', retries=2).classify('system', 'user')
        sleep.assert_called_once()


if __name__ == '__main__':
    unittest.main()
