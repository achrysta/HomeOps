"""Контракт GPU-проверок без NVIDIA, сети и запуска моделей.

Физические broken/partial/fixed/bypass остаются отдельным Windows-прогоном.
"""
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

READ_TEXT = Path.read_text
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '_tools'))
sys.path.insert(0, str(ROOT / '_shared/gpu'))
import incident_kit as kit
import checks_common as common


def response(body, status=200):
    return kit.Response(status, {}, json.dumps(body).encode(), 0.01)


class GpuChecksTest(unittest.TestCase):
    def setUp(self):
        self.config = json.loads((ROOT / 'gpu-lora/config/runtime.json').read_text())
        self.config.update(max_lora_rank=32, adapter='correct')
        self.policy = json.loads((ROOT / 'gpu-lora/.original/policy.json').read_text())
        self.state = {'cuda': True, 'compute_ok': True, 'nvml': True, 'exit_code': None,
                      'config': self.config, 'adapter': {'rank': 32, 'base': self.config['model'], 'revision': self.config['revision']}}
        self.stack = []
        self.use(patch.object(common, 'runtime', lambda: self.state))
        self.use(patch.object(common, 'wait_for', lambda fn, **_kwargs: fn()))
        self.use(patch.object(common.Path, 'read_text', lambda _p: json.dumps(self.policy)))

    def use(self, mock):
        self.stack.append(mock)
        return mock.start()

    def tearDown(self):
        for mock in reversed(self.stack):
            mock.stop()

    def test_broken_nvml_and_partial_compute_are_different(self):
        self.state.update(nvml=False, cuda=False, compute_ok=False, exit_code=1)
        with self.assertRaisesRegex(kit.CheckFailed, 'NVML'):
            common.visible()
        self.state['nvml'] = True
        common.visible()
        with self.assertRaisesRegex(kit.CheckFailed, 'CPU fallback'):
            common.gpu()
        self.state.update(cuda=True, compute_ok=True, exit_code=None)
        common.gpu()

    def test_cuda_available_without_successful_operation_is_not_a_pass(self):
        self.state['compute_ok'] = False
        with self.assertRaisesRegex(kit.CheckFailed, 'CUDA compute'):
            common.gpu()

    def test_exit_before_readiness_is_reported(self):
        self.state['exit_code'] = 1
        with self.assertRaisesRegex(kit.CheckFailed, 'code=1'):
            common.ready()

    def test_real_wait_for_reports_exit_without_sleeping_or_health_request(self):
        self.state['exit_code'] = 137
        with patch.object(common, 'wait_for', kit.wait_for), \
             patch.object(common, 'get') as get, patch.object(kit.time, 'sleep') as sleep:
            with self.assertRaisesRegex(kit.CheckFailed, 'code=137'):
                common.ready()
            get.assert_not_called()
            sleep.assert_not_called()

    def test_exit_during_real_readiness_poll_preserves_code(self):
        stopped = {**self.state, 'exit_code': 17}
        with patch.object(common, 'wait_for', kit.wait_for), \
             patch.object(common, 'runtime', side_effect=[self.state, stopped]), \
             patch.object(common, 'get', return_value=response({}, 503)) as get, \
             patch.object(kit.time, 'sleep') as sleep:
            with self.assertRaisesRegex(kit.CheckFailed, 'code=17'):
                common.ready()
            self.assertEqual(get.call_count, 1)
            sleep.assert_called_once_with(3)

    def test_live_readiness_does_one_attempt_without_sleep_or_inference(self):
        with patch.object(kit, 'LIVE', True), patch.object(common, 'wait_for', kit.wait_for), \
             patch.object(common, 'get', return_value=response({}, 503)) as get, \
             patch.object(common, 'post') as post, patch.object(kit.time, 'sleep') as sleep:
            with self.assertRaisesRegex(kit.CheckFailed, 'пока не ready'):
                common.ready()
            self.assertEqual(get.call_count, 1)
            post.assert_not_called()
            sleep.assert_not_called()

    def test_rank_then_wrong_base_then_fixed(self):
        self.config['max_lora_rank'] = 16
        with self.assertRaisesRegex(kit.CheckFailed, 'Rank'):
            common.rank()
        self.config['max_lora_rank'] = 32
        common.rank()
        self.state['adapter']['base'] = 'Qwen/Qwen2.5-3B-Instruct'
        with self.assertRaisesRegex(kit.CheckFailed, 'идентичности'):
            common.adapter()
        self.state['adapter']['base'] = self.config['model']
        self.use(patch.object(common, 'post', lambda *_a, **_k: response({'model': 'tickets-adapter', 'choices': [{'message': {'content': 'Hi'}}]})))
        common.adapter()
        common.constraints()

    def test_base_fallback_or_empty_adapter_answer_does_not_pass(self):
        for body in [{'model': 'tickets-base', 'choices': [{'message': {'content': 'Hi'}}]},
                     {'model': 'tickets-adapter', 'choices': []},
                     {'model': 'tickets-adapter', 'choices': [{'message': {'content': ''}}]}]:
            with patch.object(common, 'post', return_value=response(body)):
                with self.assertRaisesRegex(kit.CheckFailed, 'адаптера'):
                    common.adapter()

    def test_gateway_error_or_empty_content_is_not_a_pass(self):
        for body, status in [({}, 404), ({'choices': []}, 200), ({'choices': [{'message': {'content': ' '}}]}, 200)]:
            with patch.object(common, 'post', return_value=response(body, status)):
                with self.assertRaises(kit.CheckFailed):
                    common.inference()
        with patch.object(common, 'post', return_value=response({'choices': [{'message': {'content': 'Hi'}}]})):
            common.inference()

    def test_every_constraint_bypass_fails_even_with_healthy_compute(self):
        for key, value in [('model', 'Qwen/Qwen2.5-3B-Instruct'), ('revision', '0' * 40),
                           ('max_model_len', 2048), ('max_num_seqs', 1),
                           ('gpu_memory_utilization', 0.90), ('enable_lora', False), ('adapter', 'none')]:
            with self.subTest(key=key):
                before = self.config[key]
                self.config[key] = value
                with self.assertRaises(kit.CheckFailed):
                    common.constraints()
                self.config[key] = before

    def test_registered_ids_and_needs_match_stands(self):
        for stand, ids in [('gpu-vllm-budget', ['gpu', 'ready', 'request', 'constraints']),
                           ('gpu-kv-cache', ['gpu', 'ready', 'request', 'constraints']),
                           ('gpu-container', ['visible', 'gpu', 'ready', 'request', 'constraints']),
                           ('gpu-lora', ['gpu', 'rank', 'ready', 'adapter', 'constraints'])]:
            kit.CHECKS.clear()
            exec(compile(READ_TEXT(ROOT / stand / 'checks.py'), stand, 'exec'), {})
            self.assertEqual([c.id for c in kit.CHECKS], ids)
            self.assertEqual([c.id for c in kit.CHECKS if not c.live], ['adapter'] if stand == 'gpu-lora' else ['request'])
            self.assertEqual(next(c for c in kit.CHECKS if c.id == 'ready').needs, ['gpu'])
        kit.CHECKS.clear()


class RuntimeTest(unittest.TestCase):
    def test_old_green_runtime_cannot_confirm_new_config(self):
        desired = {'max_model_len': 8192}
        with patch.object(common.Path, 'read_text', return_value=json.dumps(desired)), \
             patch.object(common, 'get', side_effect=[response({'config': {'max_model_len': 2048}}), response({'config': desired})]) as get, \
             patch.object(common, 'wait_for', side_effect=lambda fn, **_kw: fn() or fn()):
            self.assertEqual(common.runtime()['config'], desired)
            self.assertEqual(get.call_count, 2)

    def test_wrong_config_or_missing_diagnostic_endpoint_fails(self):
        for out in [response({'config': {}}), response({}, 503)]:
            with patch.object(common.Path, 'read_text', return_value='{"max_model_len":8192}'), \
                 patch.object(common, 'get', return_value=out), \
                 patch.object(common, 'wait_for', side_effect=lambda fn, **_kw: fn()):
                with self.assertRaisesRegex(kit.CheckFailed, 'прежнее состояние'):
                    common.runtime()

    def test_invalid_configuration_cannot_spawn_a_process(self):
        spec = importlib.util.spec_from_file_location('gpu_controller', ROOT / '_shared/gpu/serve.py')
        controller = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(controller)
        original = json.loads((ROOT / 'gpu-lora/config/runtime.json').read_text())
        with tempfile.TemporaryDirectory() as folder:
            controller.CONFIG = Path(folder) / 'runtime.json'
            for key, value in [('model', ';arbitrary'), ('revision', 'main'), ('adapter', '../../x'),
                               ('max_model_len', True), ('gpu_memory_utilization', '0.85'), ('enable_lora', 'false')]:
                with self.subTest(key=key):
                    controller.CONFIG.write_text(json.dumps({**original, key: value}))
                    with patch.object(controller.subprocess, 'run') as run, patch.object(controller.subprocess, 'Popen') as spawn:
                        self.assertIsNone(controller.launch())
                        self.assertEqual(controller.STATE['exit_code'], 1)
                        run.assert_not_called()
                        spawn.assert_not_called()


if __name__ == '__main__':
    unittest.main()
