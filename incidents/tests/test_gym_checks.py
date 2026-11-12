"""Залы: сломанное, частично и полностью выполненное состояние без настоящего кластера."""
import copy
import importlib.util
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "_tools"))
import incident_kit as kit


def load(gym):
    source = Path(os.environ.get("GYM_TEST_ROOT", ROOT)) / gym / "checks.py"
    kit.CHECKS.clear()
    spec = importlib.util.spec_from_file_location(gym.replace("-", "_"), source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def deployment(replicas=2, version=None, revision=1):
    container = {"name": "api", "image": "python:3.12-alpine", "command": ["python", "-m", "http.server", "8080"]}
    if version is not None:
        container["env"] = [{"name": "VERSION", "value": version}]
    return {
        "metadata": {"generation": 1, "annotations": {"deployment.kubernetes.io/revision": str(revision)}},
        "spec": {"replicas": replicas, "template": {"metadata": {"labels": {"app": "api"}}, "spec": {"containers": [container]}}},
        "status": {"observedGeneration": 1, "updatedReplicas": replicas, "availableReplicas": replicas, "replicas": replicas},
    }


SERVICE = {"spec": {"selector": {"app": "api"}, "ports": [{"port": 80, "targetPort": 8080}]}}


class DeploymentGymTest(unittest.TestCase):
    def setUp(self):
        self.gym = load("gym-k8s-deployments")
        self.d = deployment()
        self.svc = copy.deepcopy(SERVICE)
        self.endpoints = ["10.0.0.1", "10.0.0.2"]
        self.get = patch.object(self.gym, "get", side_effect=lambda kind, *_: self.d if kind == "deployment" else self.svc)
        self.ep = patch.object(self.gym, "ready_endpoints", side_effect=lambda *_: self.endpoints)
        self.get.start()
        self.ep.start()
        self.addCleanup(self.get.stop)
        self.addCleanup(self.ep.stop)

    def test_broken_state_has_no_deployment(self):
        self.d = None
        for fn in [self.gym.create, self.gym.expose, self.gym.scale, self.gym.update, self.gym.undo]:
            with self.subTest(fn=fn.__name__), self.assertRaises(kit.CheckFailed):
                fn()

    def test_expose_requires_the_previous_workload(self):
        self.d["spec"]["template"]["spec"]["containers"][0]["image"] = "wrong:1"
        with self.assertRaises(kit.CheckFailed):
            self.gym.expose()

    def test_scale_requires_the_service(self):
        self.d = deployment(4)
        self.svc = None
        with self.assertRaisesRegex(kit.CheckFailed, "Service api"):
            self.gym.scale()

    def test_update_requires_four_replicas(self):
        self.d = deployment(2, "2", 2)
        with self.assertRaises(kit.CheckFailed):
            self.gym.update()

    def test_undo_requires_the_service_to_remain_available(self):
        self.d = deployment(4, revision=3)
        self.endpoints = []
        with self.assertRaises(kit.CheckFailed):
            self.gym.undo()

    def test_service_must_select_this_deployment(self):
        self.svc["spec"]["selector"] = {"app": "other"}
        with self.assertRaises(kit.CheckFailed):
            self.gym.expose()

    def test_fully_completed_stages_pass_without_modifying_state(self):
        self.gym.create()
        self.gym.expose()
        self.d = deployment(4)
        self.gym.scale()
        self.d = deployment(4, "2", 2)
        self.gym.update()
        self.d = deployment(4, revision=3)
        before = copy.deepcopy((self.d, self.svc))
        self.gym.undo()
        self.assertEqual((self.d, self.svc), before)


class DebugGymTest(unittest.TestCase):
    def test_later_correct_answers_cannot_pass_before_the_first_one(self):
        gym = load("gym-k8s-debug")
        spec = importlib.util.spec_from_file_location("verify_test_runner", ROOT / "_tools" / "verify.py")
        verify = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(verify)
        answers = {"exit-code": "0", "hog-reason": "OOMKilled", "pending-resource": "cpu", "web-ips": "10.0.0.1", "most-restarts": "crasher"}
        crasher = {"metadata": {"name": "crasher"}, "status": {"containerStatuses": [{"restartCount": 3, "lastState": {"terminated": {"exitCode": 42}}}]}}
        hog = {"metadata": {"name": "hog"}, "status": {"containerStatuses": [{"restartCount": 2, "lastState": {"terminated": {"reason": "OOMKilled"}}}]}}
        web = {"metadata": {"name": "web"}, "status": {"podIP": "10.0.0.1"}}
        def pods(_ns, selector):
            return {"app=crasher": [crasher], "app=hog": [hog], "app=web": [web], "app": [crasher, hog, web]}[selector]
        with patch.object(gym, "answer", side_effect=lambda name: answers[name]), patch.object(gym, "pods", side_effect=pods):
            self.assertTrue(all(not c["ok"] for c in verify.run_checks(live=True)))
            answers["exit-code"] = "42"
            self.assertTrue(all(c["ok"] for c in verify.run_checks(live=True)))



def config_deployment(env=None, env_from=None, volumes=None, mounts=None):
    c = {"name": "api", "image": "python:3.12-alpine", "env": env or [], "envFrom": env_from or [], "volumeMounts": mounts or []}
    return {"kind": "Deployment", "metadata": {"name": "api"}, "spec": {"template": {"spec": {"containers": [c], "volumes": volumes or []}}}}


class ConfigGymTest(unittest.TestCase):
    def setUp(self):
        self.gym = load("gym-k8s-config")
        self.cm = {"data": {"MODE": "prod", "LOG_LEVEL": "info"}}
        self.secret = {"data": {"password": "czNjcjN0"}}  # s3cr3t
        self.d = config_deployment()
        self.env = {"MODE": "prod", "LOG_LEVEL": "info", "DB_PASSWORD": "s3cr3t"}
        self.files = {"/etc/app/MODE": "prod"}
        self.answers = {"db-password": "s3cr3t"}
        objects = lambda kind, *_: {"configmap": self.cm, "secret": self.secret, "deployment": self.d}[kind]
        def in_pod(*cmd):
            return self.env.get(cmd[1]) if cmd[0] == "printenv" else self.files.get(cmd[1])
        for name, fn in [("get", objects), ("in_pod", in_pod), ("answer", lambda n: self.answers[n]), ("deployment_status", lambda *_: (True, "ok"))]:
            p = patch.object(self.gym, name, side_effect=fn)
            p.start()
            self.addCleanup(p.stop)

    def wire_env(self, by_key=False):
        secret_ref = {"name": "DB_PASSWORD", "valueFrom": {"secretKeyRef": {"name": "db-creds", "key": "password"}}}
        if by_key:
            keys = [{"name": k, "valueFrom": {"configMapKeyRef": {"name": "app-config", "key": k}}} for k in ("MODE", "LOG_LEVEL")]
            self.d = config_deployment(env=[*keys, secret_ref])
        else:
            self.d = config_deployment(env=[secret_ref], env_from=[{"configMapRef": {"name": "app-config"}}])

    def test_configmap_needs_both_keys(self):
        self.cm = {"data": {"MODE": "prod"}}
        with self.assertRaisesRegex(kit.CheckFailed, "LOG_LEVEL"):
            self.gym.configmap()
        self.cm = None
        with self.assertRaisesRegex(kit.CheckFailed, "пока нет"):
            self.gym.configmap()

    def test_secret_answer_must_be_decoded(self):
        self.answers["db-password"] = "czNjcjN0"
        with self.assertRaisesRegex(kit.CheckFailed, "base64"):
            self.gym.secret_read()
        self.answers["db-password"] = "s3cr3t"
        self.gym.secret_read()

    def test_env_accepts_env_from_or_a_variable_per_key(self):
        with self.assertRaises(kit.CheckFailed):
            self.gym.env()
        for by_key in (False, True):
            with self.subTest(by_key=by_key):
                self.wire_env(by_key)
                self.gym.env()

    def test_volume_must_be_mounted_in_etc_app(self):
        self.wire_env()
        vol = [{"name": "cfg", "configMap": {"name": "app-config"}}]
        self.d = config_deployment(env=self.d["spec"]["template"]["spec"]["containers"][0]["env"], env_from=[{"configMapRef": {"name": "app-config"}}], volumes=vol, mounts=[{"name": "cfg", "mountPath": "/config"}])
        with self.assertRaisesRegex(kit.CheckFailed, "/etc/app"):
            self.gym.volume()
        self.d["spec"]["template"]["spec"]["containers"][0]["volumeMounts"] = [{"name": "cfg", "mountPath": "/etc/app/"}]
        self.gym.volume()

    def test_reload_requires_the_running_pod_to_see_debug(self):
        self.cm["data"]["LOG_LEVEL"] = "debug"
        with self.assertRaisesRegex(kit.CheckFailed, "уже debug"):
            self.gym.reload()
        self.env["LOG_LEVEL"] = "debug"
        self.gym.reload()
        # первый подход остаётся засчитанным после смены уровня
        self.gym.configmap()


class RbacGymTest(unittest.TestCase):
    def setUp(self):
        self.gym = load("gym-k8s-rbac")
        self.role = {"rules": [{"apiGroups": [""], "resources": ["pods"], "verbs": ["get", "list", "watch"]}]}
        self.bindings = [{"roleRef": {"kind": "Role", "name": "pod-reader"}, "subjects": [{"kind": "ServiceAccount", "name": "reporter", "namespace": "gym-rbac"}]}]
        self.perms = {("gym-rbac/reporter", "list", "pods"): True, ("gym-rbac/reporter", "delete", "pods"): False, ("gym-rbac/deployer", "delete", "deployments"): False}
        self.answers = {"deployer-delete": "no"}
        self.logs = False
        def get(kind, name=None, ns=None, **_):
            return {"serviceaccount": {"metadata": {}}, "role": self.role, "rolebinding": self.bindings}[kind]
        for name, fn in [("get", get), ("can_i", lambda sa, verb, res, ns=None: self.perms[(sa, verb, res)]), ("answer", lambda n: self.answers[n]), ("can_read_logs", lambda sa: self.logs)]:
            p = patch.object(self.gym, name, side_effect=fn)
            p.start()
            self.addCleanup(p.stop)

    def test_role_must_be_read_only(self):
        self.gym.role()
        self.role["rules"][0]["verbs"].append("delete")
        with self.assertRaisesRegex(kit.CheckFailed, "изменение"):
            self.gym.role()

    def test_binding_needs_the_subject_and_no_extra_rights(self):
        self.gym.binding()
        self.bindings[0]["subjects"][0]["name"] = "default"
        with self.assertRaisesRegex(kit.CheckFailed, "RoleBinding"):
            self.gym.binding()

    def test_can_i_answer_follows_the_api_server(self):
        self.gym.can_i_answer()
        self.perms[("gym-rbac/deployer", "delete", "deployments")] = True
        with self.assertRaisesRegex(kit.CheckFailed, "иначе"):
            self.gym.can_i_answer()
        self.answers["deployer-delete"] = "YES"
        self.gym.can_i_answer()

    def test_logs_need_the_subresource(self):
        with self.assertRaises(kit.CheckFailed):
            self.gym.logs()
        self.logs = True
        self.gym.logs()


class SchedulingGymTest(unittest.TestCase):
    NODES = [{"metadata": {"name": "homeops-control-plane", "labels": {"node-role.kubernetes.io/control-plane": ""}}}, {"metadata": {"name": "homeops-worker", "labels": {}}}]

    def setUp(self):
        self.gym = load("gym-k8s-scheduling")
        self.web = {"kind": "Deployment", "metadata": {"name": "web"}, "spec": {"replicas": 2, "selector": {"matchLabels": {"app": "web"}}, "template": {"spec": {"nodeSelector": {"kubernetes.io/hostname": "homeops-worker"}, "containers": [{"name": "python"}]}}}}
        self.web_pods = [{"metadata": {"name": f"web-{i}"}, "spec": {"nodeName": "homeops-worker"}} for i in range(2)]
        self.quotas = []
        def get(kind, name=None, ns=None, **_):
            return {"nodes": self.NODES, "deployment": self.web, "resourcequota": self.quotas}[kind]
        for name, fn in [("get", get), ("pods", lambda *_: self.web_pods), ("deployment_status", lambda *_: (True, "ok"))]:
            p = patch.object(self.gym, name, side_effect=fn)
            p.start()
            self.addCleanup(p.stop)

    def test_web_must_be_pinned_by_selector_or_affinity(self):
        self.gym.node_selector()
        spec = self.web["spec"]["template"]["spec"]
        del spec["nodeSelector"]
        with self.assertRaisesRegex(kit.CheckFailed, "не привязаны"):
            self.gym.node_selector()
        spec["affinity"] = {"nodeAffinity": {"requiredDuringSchedulingIgnoredDuringExecution": {"nodeSelectorTerms": [{"matchExpressions": [{"key": "kubernetes.io/hostname", "operator": "In", "values": ["homeops-worker"]}]}]}}}
        self.gym.node_selector()

    def test_requests_compare_quantities_not_strings(self):
        with self.assertRaisesRegex(kit.CheckFailed, "не задан"):
            self.gym.requests()
        self.web["spec"]["template"]["spec"]["containers"][0]["resources"] = {"requests": {"cpu": "0.05", "memory": "32Mi"}, "limits": {"memory": "64Mi"}}
        self.gym.requests()

    def test_quota_needs_both_limits(self):
        with self.assertRaisesRegex(kit.CheckFailed, "нет ResourceQuota"):
            self.gym.quota()
        self.quotas = [{"metadata": {"name": "compute"}, "spec": {"hard": {"pods": "10", "requests.cpu": "500m"}}}]
        with self.assertRaisesRegex(kit.CheckFailed, "pods=10"):
            self.gym.quota()
        self.quotas[0]["spec"]["hard"] = {"pods": "8", "requests.cpu": "0.5"}
        self.gym.quota()


class LinuxGymTest(unittest.TestCase):
    def setUp(self):
        self.gym = load("gym-linux-diag")
        self.answers = {"port-8081": "metrics-agent.service", "failed-unit": "report-sync", "missing-file": "/etc/report-sync/token", "big-dir": "exports", "holder-pid": "108"}
        self.failed = "report-sync.service loaded failed failed Синхронизация\n"
        self.holders = {108: "/var/log/shipper/buffer.log"}
        self.tmp = Path(self.enterContext(__import__("tempfile").TemporaryDirectory()))
        for name, size in (("cache", 1), ("exports", 40), ("tmp", 2)):
            (self.tmp / name).mkdir()
            (self.tmp / name / "data.bin").write_bytes(b"x" * size * 4096)
        for name, fn in [("answer", lambda n: self.answers[n]), ("listener_pid", lambda port: 106), ("unit_of", lambda pid: "metrics-agent"),
                         ("run", lambda *args: self.failed), ("deleted_holders", lambda: self.holders)]:
            p = patch.object(self.gym, name, side_effect=fn)
            p.start()
            self.addCleanup(p.stop)
        p = patch.object(self.gym, "APP_DATA", self.tmp)
        p.start()
        self.addCleanup(p.stop)

    def test_all_answers_pass_and_suffixes_are_optional(self):
        for fn in (self.gym.port, self.gym.failed_unit, self.gym.missing_file, self.gym.big_dir, self.gym.holder_pid):
            with self.subTest(fn=fn.__name__):
                fn()
        self.answers["big-dir"] = f"{self.tmp}/exports/"
        self.gym.big_dir()

    def test_wrong_answers_and_changed_state_fail(self):
        self.answers["port-8081"] = "web-preview"
        with self.assertRaisesRegex(kit.CheckFailed, "8081"):
            self.gym.port()
        self.failed = ""
        with self.assertRaisesRegex(kit.CheckFailed, "сессию заново"):
            self.gym.failed_unit()
        self.answers["big-dir"] = "tmp"
        with self.assertRaisesRegex(kit.CheckFailed, "не самый большой"):
            self.gym.big_dir()
        self.answers["holder-pid"] = "1"
        with self.assertRaisesRegex(kit.CheckFailed, "не держит"):
            self.gym.holder_pid()



class NetworkGymTest(unittest.TestCase):
    def setUp(self):
        self.gym = load("gym-k8s-network")
        port = {"port": 80, "targetPort": 8080}
        self.services = {"web": {"metadata": {"name": "web"}, "spec": {"selector": {"app": "web"}, "ports": [dict(port)]}},
                         "web-np": {"metadata": {"name": "web-np"}, "spec": {"type": "NodePort", "selector": {"app": "web"}, "ports": [dict(port, nodePort=30880)]}}}
        self.policies = []
        self.answers = {"web-fqdn": "web.gym-net.svc.cluster.local."}
        self.reachable = {"frontend": True, "intruder": True}
        def get(kind, name=None, ns=None, **_):
            return self.services.get(name) if kind == "service" else self.policies
        def probe(ns, selector, kind, target, timeout=3.0):
            who = "frontend" if selector == "role=frontend" else "intruder"
            return {"result": "ok", "status": 200} if self.reachable[who] else {"result": "timeout"}
        for name, fn in [("get", get), ("ready_endpoints", lambda *_: ["10.0.0.1"]), ("answer", lambda n: self.answers[n]), ("pod_probe", probe)]:
            p = patch.object(self.gym, name, side_effect=fn)
            p.start()
            self.addCleanup(p.stop)
        self.gym._reach.clear()

    def test_service_and_names(self):
        self.gym.service_rep()
        self.gym.dns_name()
        self.answers["web-fqdn"] = "web.gym-net"
        with self.assertRaisesRegex(kit.CheckFailed, "полное"):
            self.gym.dns_name()

    def test_nodeport_needs_the_fixed_port(self):
        self.gym.nodeport()
        self.services["web-np"]["spec"]["ports"][0]["nodePort"] = 31000
        with self.assertRaisesRegex(kit.CheckFailed, "30880"):
            self.gym.nodeport()

    def test_policies_are_judged_by_real_traffic(self):
        with self.assertRaisesRegex(kit.CheckFailed, "нет политики"):
            self.gym.deny()
        self.policies = [{"spec": {"podSelector": {}, "policyTypes": ["Ingress"]}}]
        with self.assertRaisesRegex(kit.CheckFailed, "intruder"):
            self.gym.deny()  # политика есть, но трафик открыт (например, разрешение для всех подов)
        self.gym._reach.clear()
        self.reachable = {"frontend": False, "intruder": False}
        self.gym.deny()
        with self.assertRaisesRegex(kit.CheckFailed, "frontend"):
            self.gym.allow()
        self.gym._reach.clear()
        self.reachable["frontend"] = True
        self.gym.allow()



def storage_pod(name, claim="data", path="/data", phase="Running"):
    return {"metadata": {"name": name}, "status": {"phase": phase},
            "spec": {"volumes": [{"name": "v", "persistentVolumeClaim": {"claimName": claim}}], "containers": [{"volumeMounts": [{"name": "v", "mountPath": path}]}]}}


class StorageGymTest(unittest.TestCase):
    def setUp(self):
        self.gym = load("gym-k8s-storage")
        self.claims = {"data": {"spec": {"accessModes": ["ReadWriteOnce"], "resources": {"requests": {"storage": "128Mi"}}}, "status": {"phase": "Pending"}}}
        self.pods = {}
        self.files = {}
        self.pv = None
        def get(kind, name=None, ns=None, **_):
            if kind == "pvc":
                return self.claims.get(name)
            if kind == "pods":
                return list(self.pods.values())
            if kind == "pod":
                return self.pods.get(name)
            if kind == "pv":
                return self.pv
            return None
        def kubectl(*args, **_):
            pod = args[3]
            if pod not in self.files:
                raise self.gym.KubectlError("no file")
            return self.files[pod]
        for name, fn in [("get", get), ("kubectl", kubectl)]:
            p = patch.object(self.gym, name, side_effect=fn)
            p.start()
            self.addCleanup(p.stop)

    def test_pvc_may_wait_for_first_consumer_but_mount_needs_a_bound_claim(self):
        self.gym.pvc_rep()
        with self.assertRaisesRegex(kit.CheckFailed, "не привязан"):
            self.gym.mount()
        self.claims["data"]["status"]["phase"] = "Bound"
        self.pods["writer"] = storage_pod("writer")
        self.files["writer"] = "hello\n"
        self.gym.mount()

    def test_data_must_survive_the_writer(self):
        self.claims["data"]["status"]["phase"] = "Bound"
        self.pods["writer"] = storage_pod("writer")
        with self.assertRaisesRegex(kit.CheckFailed, "writer ещё есть"):
            self.gym.persist()
        del self.pods["writer"]
        self.pods["reader"] = storage_pod("reader")
        self.files["reader"] = "hello"
        self.gym.persist()
        self.gym.mount()  # второй подход остаётся засчитанным, когда writer уже удалён

    def test_static_pv_is_bound_by_storage_class(self):
        self.pv = {"spec": {"storageClassName": "manual"}}
        self.claims["manual-claim"] = {"spec": {"volumeName": "pvc-123"}, "status": {"phase": "Bound"}}
        with self.assertRaisesRegex(kit.CheckFailed, "не привязан к gym-storage-pv"):
            self.gym.static_pv()
        self.claims["manual-claim"]["spec"]["volumeName"] = "gym-storage-pv"
        self.gym.static_pv()



class HelmGymTest(unittest.TestCase):
    def setUp(self):
        self.gym = load("gym-k8s-helm")
        self.releases = [{"name": "web", "chart": "web-0.3.1", "status": "deployed"}]
        self.history = [{"revision": 1, "description": "Install complete"}]
        self.values = {1: {}}
        self.deploy = {"spec": {"replicas": 2, "template": {"spec": {"containers": [{"image": "python:3.12-alpine"}]}}}, "status": {"availableReplicas": 2}}
        self.answers = {"default-memory": "96Mi"}
        def helm(*args):
            if args[0] == "list":
                return self.releases
            if args[0] == "history":
                return self.history
            rev = int(args[args.index("--revision") + 1]) if "--revision" in args else self.history[-1]["revision"]
            return self.values.get(rev, {})
        for name, fn in [("helm", helm), ("get", lambda *a, **k: self.deploy), ("answer", lambda n: self.answers[n]), ("deployment_status", lambda *_: (True, "ok"))]:
            p = patch.object(self.gym, name, side_effect=fn)
            p.start()
            self.addCleanup(p.stop)

    def upgraded(self):
        self.history.append({"revision": 2, "description": "Upgrade complete"})
        self.values[2] = {"replicaCount": 3}
        self.deploy["spec"]["replicas"] = 3
        self.deploy["status"]["availableReplicas"] = 3

    def test_values_come_from_the_release_not_kubectl_scale(self):
        self.gym.install()
        self.deploy["spec"]["replicas"] = 3
        self.deploy["status"]["availableReplicas"] = 3
        with self.assertRaisesRegex(kit.CheckFailed, "replicaCount"):
            self.gym.values()
        self.upgraded()
        self.gym.values()

    def test_earlier_reps_hold_while_the_broken_version_rolls_out(self):
        self.upgraded()
        self.history.append({"revision": 3, "description": "Upgrade complete"})
        self.values[3] = {"replicaCount": 3, "image": {"tag": "broken"}}
        self.gym.install()
        self.gym.values()
        with self.assertRaisesRegex(kit.CheckFailed, "не откат"):
            self.gym.rollback()
        self.history.append({"revision": 4, "description": "Rollback to 2"})
        self.values[4] = {"replicaCount": 3}
        self.gym.rollback()

    def test_rollback_requires_the_broken_version_in_history(self):
        self.upgraded()
        self.history.append({"revision": 3, "description": "Rollback to 1"})
        with self.assertRaisesRegex(kit.CheckFailed, "broken"):
            self.gym.rollback()


if __name__ == "__main__":
    unittest.main()
