import importlib.util
import io
import json
import unittest
import sys
import tempfile
from types import SimpleNamespace
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('bench', Path(__file__).with_name('bench.py'))
bench = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bench)


def stream(events):
    return io.BytesIO(('\n'.join('data: ' + (e if isinstance(e, str) else json.dumps(e)) for e in events) + '\n').encode())


class BenchTest(unittest.TestCase):
    def test_ttft_ignores_role_and_usage_and_uses_backend_token_count(self):
        events = [{'choices': [{'delta': {'role': 'assistant'}}]},
                  {'choices': [{'delta': {'content': 'Hi'}}]},
                  {'choices': [{'delta': {'content': '!'}}]},
                  {'choices': [], 'usage': {'prompt_tokens': 54, 'completion_tokens': 5}}, '[DONE]']
        with patch.object(bench.urllib.request, 'urlopen', return_value=stream(events)):
            result = bench.stream_request('http://fake/v1/chat/completions', 'fake', [], 64, clock=iter([0, 1, 3, 4]).__next__)
        self.assertEqual(result['ttft_ms'], 1000)
        self.assertEqual(result['decode_tokens_s'], 2)
        self.assertEqual(result['completion_tokens'], 5)

    def test_ttft_percentiles_use_actual_samples_and_nearest_rank(self):
        requests = [{'ttft_ms': n} for n in reversed(range(1, 21))]
        summary = bench.ttft_summary(requests)
        self.assertEqual(summary['sample_count'], 20)
        self.assertEqual(summary['p50_ttft_ms'], 10.5)
        self.assertEqual(summary['p95_ttft_ms'], 19)
        self.assertEqual(bench.ttft_summary([{'ttft_ms': 7}])['p95_ttft_ms'], 7)
        with self.assertRaises(ValueError):
            bench.ttft_summary([])

    def test_llama_prompt_cache_is_disabled_explicitly_and_omitted_by_default(self):
        events = [{'choices': [{'delta': {'content': 'Hi'}}]}, '[DONE]']
        for option, expected in [(None, None), (False, False)]:
            with patch.object(bench.urllib.request, 'urlopen', return_value=stream(events)) as call:
                bench.stream_request('http://fake/v1/chat/completions', 'fake', [], 64, cache_prompt=option)
                body = json.loads(call.call_args.args[0].data)
                if expected is None:
                    self.assertNotIn('cache_prompt', body)
                else:
                    self.assertIs(body['cache_prompt'], False)

    def test_prompt_length_counts_ids_instead_of_transformers5_batch_encoding_keys(self):
        class Tokenizer:
            def apply_chat_template(self, messages, **options):
                ids = list(range(20 + messages[0]['content'].count('ticket ')))
                return ids if options.get('return_dict') is False else {'input_ids': ids, 'attention_mask': ids}
        messages, count = bench.fit_prompt(Tokenizer(), 54)
        self.assertEqual(count, 54)
        self.assertEqual(messages[0]['content'].count('ticket '), 34)

    def test_complete_client_runs_sequential_parallel_and_long_phases(self):
        class Tokenizer:
            chat_template = 'fixture'
            def apply_chat_template(self, messages, **options):
                ids = list(range(20 + messages[0]['content'].count('ticket ')))
                return ids if options.get('return_dict') is False else {'input_ids': ids}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            metadata = root / 'metadata.json'
            keys = ['model', 'revision', 'base_model', 'base_revision', 'format', 'backend', 'backend_version', 'image_digest', 'startup_args', 'hardware', 'weights_sha256']
            metadata.write_text(json.dumps({key: 'fixture' for key in keys}))
            output = root / 'result.json'
            argv = ['bench', '--endpoint', 'http://fake/v1/chat/completions', '--model', 'fake', '--tokenizer', 'fake', '--metadata', str(metadata), '--output', str(output), '--long-tokens', '150']
            transformers = SimpleNamespace(AutoTokenizer=SimpleNamespace(from_pretrained=lambda *a, **k: Tokenizer()))
            item = {'ttft_ms': 2, 'completion_tokens': 64}
            with patch.object(sys, 'argv', argv), patch.dict(sys.modules, {'transformers': transformers}), patch.object(bench, 'stream_request', return_value=item) as request, patch.object(bench, 'MemorySampler') as sampler:
                sampler.return_value.finish.return_value = {'peak_mib': None}
                with self.assertRaises(SystemExit) as exit:
                    bench.main()
            self.assertEqual(exit.exception.code, 0)
            self.assertEqual(request.call_count, 7)
            result = json.loads(output.read_text())
            self.assertEqual([p['name'] for p in result['phases']], ['sequential', 'concurrency2', 'long'])
            self.assertTrue(result['ok'])
            self.assertEqual(result['phases'][0]['sample_count'], 3)

    def test_guard_unknown_label_and_timeout_fail_without_becoming_safe(self):
        class Tokenizer:
            chat_template = 'fixture'
        for response in [{'ttft_ms': 2, 'completion_tokens': 1, 'text': 'Safety'}, TimeoutError('fixture timeout')]:
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                metadata = root / 'metadata.json'
                keys = ['model', 'revision', 'base_model', 'base_revision', 'format', 'backend', 'backend_version', 'image_digest', 'startup_args', 'hardware', 'weights_sha256']
                metadata.write_text(json.dumps({key: 'fixture' for key in keys}))
                output = root / 'result.json'
                argv = ['bench', '--endpoint', 'http://fake/v1/chat/completions', '--model', 'fake', '--tokenizer', 'fake', '--metadata', str(metadata), '--output', str(output), '--guard']
                transformers = SimpleNamespace(AutoTokenizer=SimpleNamespace(from_pretrained=lambda *a, **k: Tokenizer()))
                options = {'side_effect': response} if isinstance(response, Exception) else {'return_value': response}
                with patch.object(sys, 'argv', argv), patch.dict(sys.modules, {'transformers': transformers}), patch.object(bench, 'stream_request', **options), patch.object(bench, 'MemorySampler') as sampler:
                    sampler.return_value.finish.return_value = {'peak_mib': None}
                    with self.assertRaises(SystemExit) as exit:
                        bench.main()
                self.assertEqual(exit.exception.code, 1)
                result = json.loads(output.read_text())
                self.assertFalse(result['ok'])
                self.assertTrue(result['errors'])
                self.assertTrue(all(p['requests'][0]['label'] is None for p in result['phases']))

    def test_native_bos_is_included_in_fitting_and_explicit_request_option(self):
        class Tokenizer:
            def apply_chat_template(self, messages, **options):
                self.render_options = options
                return messages[0]['content']
            def encode(self, text, add_special_tokens):
                return list(range(20 + text.count('ticket ') + int(add_special_tokens)))
        tokenizer = Tokenizer()
        messages, count = bench.fit_prompt(tokenizer, 54, add_special_tokens=True)
        self.assertEqual(count, 54)
        self.assertEqual(messages[0]['content'].count('ticket '), 33)
        self.assertIs(tokenizer.render_options['tokenize'], False)
        events = [{'choices': [{'delta': {'content': 'Hi'}}]}, '[DONE]']
        with patch.object(bench.urllib.request, 'urlopen', return_value=stream(events)) as call:
            bench.stream_request('http://fake/v1/chat/completions', 'fake', messages, 64, add_special_tokens=True)
            self.assertIs(json.loads(call.call_args.args[0].data)['add_special_tokens'], True)

    def test_completion_stream_uses_explicit_ids_and_content_text(self):
        events = [{'choices': [{'text': ''}]}, {'choices': [{'text': 'Hi'}]},
                  {'choices': [{'text': '!'}]}, {'choices': [], 'usage': {'prompt_tokens': 2, 'completion_tokens': 5}}, '[DONE]']
        with patch.object(bench.urllib.request, 'urlopen', return_value=stream(events)) as call:
            result = bench.stream_request('http://fake/v1/completions', 'fake', None, 64,
                                          prompt=[1, 7], clock=iter([0, 1, 3, 4]).__next__)
            body = json.loads(call.call_args.args[0].data)
        self.assertEqual(body['prompt'], [1, 7])
        self.assertNotIn('messages', body)
        self.assertNotIn('add_special_tokens', body)
        self.assertEqual(result['ttft_ms'], 1000)
        self.assertEqual(result['decode_tokens_s'], 2)

    def test_complete_token_id_protocol_fits_and_hashes_identical_inputs(self):
        class Tokenizer:
            chat_template = 'fixture'
            def apply_chat_template(self, messages, **options):
                return messages[0]['content']
            def encode(self, text, add_special_tokens):
                return list(range(21 + text.count('ticket ')))
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            metadata = root / 'metadata.json'
            keys = ['model', 'revision', 'base_model', 'base_revision', 'format', 'backend', 'backend_version', 'image_digest', 'startup_args', 'hardware', 'weights_sha256']
            metadata.write_text(json.dumps({key: 'fixture' for key in keys}))
            output = root / 'result.json'
            argv = ['bench', '--endpoint', 'http://fake/v1/completions', '--model', 'fake', '--tokenizer', 'fake', '--metadata', str(metadata), '--output', str(output), '--long-tokens', '150', '--completion-token-ids']
            transformers = SimpleNamespace(AutoTokenizer=SimpleNamespace(from_pretrained=lambda *a, **k: Tokenizer()))
            with patch.object(sys, 'argv', argv), patch.dict(sys.modules, {'transformers': transformers}), patch.object(bench, 'stream_request', return_value={'ttft_ms': 2, 'completion_tokens': 64}) as request, patch.object(bench, 'MemorySampler') as sampler:
                sampler.return_value.finish.return_value = {'peak_mib': None}
                with self.assertRaises(SystemExit) as exit:
                    bench.main()
            self.assertEqual(exit.exception.code, 0)
            self.assertEqual(request.call_count, 7)
            self.assertTrue(all(c.kwargs['prompt'] == list(range(54)) for c in request.call_args_list[:6]))
            self.assertEqual(request.call_args_list[-1].kwargs['prompt'], list(range(150)))
            result = json.loads(output.read_text())
            self.assertEqual(result['input_mode'], 'completion_token_ids')
            self.assertEqual(len(result['prompt_ids_sha256']['short']), 64)

    def test_missing_usage_does_not_invent_tokens_or_decode_speed(self):
        events = [{'choices': [{'delta': {'content': 'Hi'}}]}, '[DONE]']
        with patch.object(bench.urllib.request, 'urlopen', return_value=stream(events)):
            result = bench.stream_request('http://fake/v1/chat/completions', 'fake', [], 64, clock=iter([0, 1, 2]).__next__)
        self.assertIsNone(result['completion_tokens'])
        self.assertIsNone(result['decode_tokens_s'])

    def test_stream_error_empty_or_truncated_is_failure(self):
        for events in [[{'error': 'failed'}], [{'choices': [{'delta': {'role': 'assistant'}}]}, '[DONE]'],
                       [{'choices': [{'delta': {'content': 'Hi'}}]}]]:
            with patch.object(bench.urllib.request, 'urlopen', return_value=stream(events)):
                with self.assertRaises(RuntimeError):
                    bench.stream_request('http://fake/v1/chat/completions', 'fake', [], 64)


if __name__ == '__main__':
    unittest.main()
