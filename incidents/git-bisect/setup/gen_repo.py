"""Генератор репозитория для инцидента git-bisect: модуль цен корзины и ~55 коммитов за три недели.

Один коммит («style: …») тихо меняет округление денег с ROUND_HALF_UP на ROUND_HALF_EVEN — с него тесты
падают. Раньше него — блок WIP-коммитов, на которых пакет не импортируется (сборка сломана, тесты не
запускаются): наивный `git bisect run make test` укажет на первый из них. Положение блока и поломки,
порядок и число остальных коммитов случайны, поэтому ответ нельзя запомнить.

Запуск: python3 gen_repo.py /srv/pricing
"""

import os
import random
import subprocess
import sys
import textwrap
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO = Path(sys.argv[1])
rnd = random.Random()

AUTHORS = [
    ("Анна Смирнова", "a.smirnova@shop.example.test"),
    ("Игорь Ковалёв", "i.kovalev@shop.example.test"),
    ("Мария Белова", "m.belova@shop.example.test"),
    ("Олег Никитин", "o.nikitin@shop.example.test"),
    ("Дина Ахметова", "d.akhmetova@shop.example.test"),
]


def dedent(text: str) -> str:
    return textwrap.dedent(text).lstrip("\n")


# ── исходные файлы ──────────────────────────────────────────────────────────
MONEY = dedent('''
    """Деньги: суммы в рублях с копейками (Decimal)."""

    from decimal import ROUND_HALF_UP, Decimal


    def to_money(value) -> Decimal:
        """Сумма до копеек: половина копейки округляется вверх, как в кассовом чеке."""
        return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
''')

# Поломка: «единый формат» модуля — вместе с оформлением поменялся режим округления
MONEY_BROKEN = dedent('''
    """Деньги: суммы в рублях с копейками."""

    from decimal import ROUND_HALF_EVEN, Decimal

    CENT = Decimal("0.01")


    def to_money(value: Decimal | int | float | str) -> Decimal:
        """Сумма в рублях, округлённая до копеек."""
        return Decimal(str(value)).quantize(CENT, rounding=ROUND_HALF_EVEN)
''')

DISCOUNTS = dedent('''
    """Скидки."""

    from decimal import Decimal

    from .money import to_money


    def percent_discount(amount: Decimal, percent: int) -> Decimal:
        """Сумма после скидки в процентах."""
        if not 0 <= percent <= 100:
            raise ValueError("скидка должна быть от 0 до 100%")
        return to_money(amount * (100 - percent) / 100)
''')

TAX = dedent('''
    """НДС в том числе."""

    from decimal import Decimal

    from .money import to_money

    VAT_RATE = 20


    def vat_included(amount: Decimal, rate: int = VAT_RATE) -> Decimal:
        """НДС, который уже входит в сумму: amount * rate / (100 + rate)."""
        return to_money(Decimal(amount) * rate / (100 + rate))
''')

CART = dedent('''
    """Корзина: позиции, сумма, скидка."""

    from dataclasses import dataclass, field
    from decimal import Decimal

    from .discounts import percent_discount
    from .money import to_money


    @dataclass
    class Cart:
        items: list[tuple[str, Decimal, int]] = field(default_factory=list)
        discount_percent: int = 0

        def add(self, sku: str, price: str, qty: int = 1) -> None:
            self.items.append((sku, Decimal(price), qty))

        def subtotal(self) -> Decimal:
            return to_money(sum((price * qty for _, price, qty in self.items), Decimal("0")))

        def total(self) -> Decimal:
            return percent_discount(self.subtotal(), self.discount_percent)
''')

INIT = dedent('''
    """Расчёт цены корзины интернет-магазина: скидки, НДС, округление до копеек."""

    from .cart import Cart

    __all__ = ["Cart"]
''')

TEST_MONEY = dedent('''
    import unittest
    from decimal import Decimal

    from pricing.money import to_money


    class MoneyTest(unittest.TestCase):
        def test_rounds_to_cents(self):
            self.assertEqual(to_money("10"), Decimal("10.00"))
            self.assertEqual(to_money("1.234"), Decimal("1.23"))

        def test_half_cent_rounds_up_like_a_receipt(self):
            self.assertEqual(to_money("0.125"), Decimal("0.13"))
            self.assertEqual(to_money("2.665"), Decimal("2.67"))
''')

TEST_CART = dedent('''
    import unittest
    from decimal import Decimal

    from pricing import Cart


    class CartTest(unittest.TestCase):
        def test_total_without_discount(self):
            cart = Cart()
            cart.add("tea", "350.00", 2)
            self.assertEqual(cart.total(), Decimal("700.00"))

        def test_discount_rounds_half_cent_up(self):
            cart = Cart(discount_percent=10)
            cart.add("mug", "8.75", 3)
            self.assertEqual(cart.total(), Decimal("23.63"))
''')

TEST_TAX = dedent('''
    import unittest
    from decimal import Decimal

    from pricing.tax import vat_included


    class TaxTest(unittest.TestCase):
        def test_vat_included(self):
            self.assertEqual(vat_included(Decimal("120")), Decimal("20.00"))

        def test_vat_half_cent(self):
            self.assertEqual(vat_included(Decimal("1.47")), Decimal("0.25"))
''')

TEST_DISCOUNTS = dedent('''
    import unittest
    from decimal import Decimal

    from pricing.discounts import percent_discount


    class DiscountTest(unittest.TestCase):
        def test_percent(self):
            self.assertEqual(percent_discount(Decimal("200"), 15), Decimal("170.00"))

        def test_bounds(self):
            with self.assertRaises(ValueError):
                percent_discount(Decimal("10"), 120)
''')

MAKEFILE = (
    ".PHONY: build test\n\n"
    "# сборка: пакет компилируется, все его модули импортируются\n"
    "build:\n\tpython3 -m compileall -q pricing\n"
    "\tpython3 -c \"import importlib, pkgutil, pricing; [importlib.import_module(m.name) for m in pkgutil.iter_modules(pricing.__path__, 'pricing.')]\"\n\n"
    "test: build\n\tpython3 -m unittest discover -s tests -t . -q\n"
)

GITLAB_CI = dedent('''
    stages: [build, test]

    build:
      stage: build
      image: python:3.12-slim
      script: [make build]

    nightly-tests:
      stage: test
      image: python:3.12-slim
      rules:
        - if: $CI_PIPELINE_SOURCE == "schedule"
      script: [make test]
''')

README = dedent('''
    # pricing

    Расчёт цены корзины интернет-магазина: скидки, НДС, доставка, промокоды. Суммы — Decimal до копеек,
    половина копейки округляется вверх, как в кассовом чеке.

    Сборка: `make build`. Тесты: `make test` (в CI — ночной запуск по расписанию).
''')

# ── фичи: отдельный модуль и его тесты; суммы в тестах не попадают на половину копейки ──
FEATURES = [
    ("feat: стоимость доставки, бесплатно от 3000 ₽", "delivery", '''
        """Доставка: бесплатно от порога, иначе фиксированная цена."""

        from decimal import Decimal

        FREE_FROM = Decimal("3000")
        PRICE = Decimal("299.00")


        def delivery_cost(subtotal: Decimal) -> Decimal:
            return Decimal("0.00") if subtotal >= FREE_FROM else PRICE
    ''', '''
        def test_free_from_threshold(self):
            self.assertEqual(delivery_cost(Decimal("3000")), Decimal("0.00"))

        def test_paid_below_threshold(self):
            self.assertEqual(delivery_cost(Decimal("2999.99")), Decimal("299.00"))
    ''', "from pricing.delivery import delivery_cost"),
    ("feat: промокоды WELCOME10 и AUTUMN15", "promo", '''
        """Промокоды: процент скидки по коду, регистр не важен."""

        PROMO = {"WELCOME10": 10, "AUTUMN15": 15}


        def promo_percent(code: str) -> int:
            return PROMO.get(code.strip().upper(), 0)
    ''', '''
        def test_known_codes(self):
            self.assertEqual(promo_percent("welcome10"), 10)
            self.assertEqual(promo_percent(" AUTUMN15 "), 15)

        def test_unknown_code(self):
            self.assertEqual(promo_percent("FREE"), 0)
    ''', "from pricing.promo import promo_percent"),
    ("feat: баллы лояльности — 5 за каждые 100 ₽", "loyalty", '''
        """Баллы лояльности."""

        from decimal import Decimal


        def points_for(total: Decimal) -> int:
            return int(total // 100) * 5
    ''', '''
        def test_points(self):
            self.assertEqual(points_for(Decimal("1999.99")), 95)
            self.assertEqual(points_for(Decimal("99")), 0)
    ''', "from decimal import Decimal\nfrom pricing.loyalty import points_for"),
    ("feat: подарочная упаковка", "gift_wrap", '''
        """Подарочная упаковка: первая — 149 ₽, каждая следующая — 99 ₽."""

        from decimal import Decimal


        def gift_wrap_price(count: int) -> Decimal:
            if count <= 0:
                return Decimal("0.00")
            return Decimal("149.00") + Decimal("99.00") * (count - 1)
    ''', '''
        def test_wrap(self):
            self.assertEqual(gift_wrap_price(0), Decimal("0.00"))
            self.assertEqual(gift_wrap_price(3), Decimal("347.00"))
    ''', "from decimal import Decimal\nfrom pricing.gift_wrap import gift_wrap_price"),
    ("feat: формат суммы для чека — «1 234,50 ₽»", "fmt", '''
        """Формат суммы для чека и писем."""

        from decimal import Decimal


        def format_rub(amount: Decimal) -> str:
            rub, kop = f"{amount:.2f}".split(".")
            groups = f"{int(rub):,}".replace(",", " ")
            return f"{groups},{kop} ₽"
    ''', '''
        def test_format(self):
            self.assertEqual(format_rub(Decimal("1234.5")), "1 234,50 ₽")
            self.assertEqual(format_rub(Decimal("7")), "7,00 ₽")
    ''', "from decimal import Decimal\nfrom pricing.fmt import format_rub"),
    ("feat: лимит количества одной позиции", "limits", '''
        """Ограничения корзины."""

        MAX_QTY = 99


        def check_quantity(qty: int) -> int:
            if not 1 <= qty <= MAX_QTY:
                raise ValueError(f"количество должно быть от 1 до {MAX_QTY}")
            return qty
    ''', '''
        def test_limits(self):
            self.assertEqual(check_quantity(99), 99)
            with self.assertRaises(ValueError):
                check_quantity(100)
    ''', "from pricing.limits import check_quantity"),
    ("feat: рассрочка — равные платежи, остаток в последнем", "installments", '''
        """Рассрочка без переплаты."""

        from decimal import ROUND_DOWN, Decimal


        def installment_plan(total: Decimal, months: int) -> list[Decimal]:
            part = (total / months).quantize(Decimal("0.01"), rounding=ROUND_DOWN)
            return [part] * (months - 1) + [total - part * (months - 1)]
    ''', '''
        def test_plan(self):
            self.assertEqual(installment_plan(Decimal("1000.00"), 3), [Decimal("333.33"), Decimal("333.33"), Decimal("333.34")])
    ''', "from decimal import Decimal\nfrom pricing.installments import installment_plan"),
    ("feat: вес отправления для службы доставки", "weight", '''
        """Вес отправления."""


        def shipping_weight_kg(grams: list[int]) -> str:
            return f"{sum(grams) / 1000:.3f}"
    ''', '''
        def test_weight(self):
            self.assertEqual(shipping_weight_kg([250, 1200, 75]), "1.525")
    ''', "from pricing.weight import shipping_weight_kg"),
    ("feat: комплект «3 по цене 2»", "bundles", '''
        """Комплекты: самый дешёвый товар из трёх — в подарок."""

        from decimal import Decimal


        def three_for_two(prices: list[Decimal]) -> Decimal:
            if len(prices) < 3:
                return sum(prices, Decimal("0"))
            return sum(prices, Decimal("0")) - min(prices)
    ''', '''
        def test_bundle(self):
            self.assertEqual(three_for_two([Decimal("100"), Decimal("250"), Decimal("80")]), Decimal("350"))
            self.assertEqual(three_for_two([Decimal("100")]), Decimal("100"))
    ''', "from decimal import Decimal\nfrom pricing.bundles import three_for_two"),
    ("feat: срок действия купона", "coupons", '''
        """Купоны со сроком действия."""

        from datetime import date


        def is_expired(valid_until: date, today: date) -> bool:
            return today > valid_until
    ''', '''
        def test_expiry(self):
            self.assertFalse(is_expired(date(2026, 10, 9), date(2026, 10, 9)))
            self.assertTrue(is_expired(date(2026, 10, 9), date(2026, 10, 10)))
    ''', "from datetime import date\nfrom pricing.coupons import is_expired"),
    ("feat: сумма возврата за часть заказа", "refunds", '''
        """Возвраты."""

        from decimal import Decimal


        def refund_amount(paid: Decimal, returned: Decimal, ordered: Decimal) -> Decimal:
            return (paid * returned / ordered).quantize(Decimal("0.01"))
    ''', '''
        def test_refund(self):
            self.assertEqual(refund_amount(Decimal("900.00"), Decimal("1"), Decimal("3")), Decimal("300.00"))
    ''', "from decimal import Decimal\nfrom pricing.refunds import refund_amount"),
    ("feat: бесплатный самовывоз из пунктов выдачи", "pickup", '''
        """Самовывоз."""

        PICKUP_POINTS = {"MSK-01": "Москва, Тверская 7", "SPB-03": "Санкт-Петербург, Невский 28"}


        def pickup_address(code: str) -> str:
            return PICKUP_POINTS[code]
    ''', '''
        def test_pickup(self):
            self.assertEqual(pickup_address("SPB-03"), "Санкт-Петербург, Невский 28")
    ''', "from pricing.pickup import pickup_address"),
]

CHANGELOG_NOTES = [
    "уточнён порог бесплатной доставки в README", "описан ночной запуск тестов", "обновлены примеры промокодов",
    "добавлен раздел о возвратах", "поправлены опечатки в описании скидок", "пример расчёта НДС в документации",
    "пояснение про копейки в чеке", "список пунктов самовывоза", "раздел «Как добавить промокод»",
    "договорённость о формате сумм в письмах", "описание лимитов корзины", "ссылки на макеты чека",
    "уточнены сроки действия купонов", "пример рассрочки на три месяца", "описан расчёт баллов лояльности",
    "правила подарочной упаковки", "контакты дежурных в README", "ограничения на вес отправления",
]
DOC_PAGES = [
    ("docs/oncall.md", "# Дежурство\n\nНочные тесты падают — смотрим job nightly-tests и последний зелёный коммит.\n"),
    ("docs/release.md", "# Релиз\n\nТег vX.Y.Z на main после зелёных ночных тестов.\n"),
    ("docs/promo.md", "# Промокоды\n\nНовый код добавляется в pricing/promo.py и покрывается тестом.\n"),
    ("docs/money.md", "# Деньги\n\nВсе суммы — Decimal. Половина копейки — вверх (так считает касса).\n"),
    ("docs/delivery.md", "# Доставка\n\nПорог бесплатной доставки согласован с маркетингом на квартал.\n"),
    ("docs/refunds.md", "# Возвраты\n\nСумма возврата пропорциональна возвращённой части заказа.\n"),
    ("docs/loyalty.md", "# Лояльность\n\n5 баллов за каждые полные 100 ₽ итоговой суммы.\n"),
]
CI_TWEAKS = [
    ("ci: кэш pip между запусками", "\ncache:\n  paths: [.cache/pip]\n"),
    ("ci: переменная PIP_CACHE_DIR", "\nvariables:\n  PIP_CACHE_DIR: .cache/pip\n"),
    ("ci: таймаут ночных тестов 10 минут", "\ndefault:\n  timeout: 10m\n"),
]


class Repo:
    def __init__(self, path: Path):
        self.path = path
        self.files: dict[str, str] = {}
        self.when = datetime.now(timezone.utc).replace(microsecond=0) - timedelta(days=21)

    def git(self, *args: str, env: dict | None = None) -> str:
        return subprocess.run(["git", *args], cwd=self.path, check=True, capture_output=True, text=True, env={**os.environ, **(env or {})}).stdout.strip()

    def commit(self, message: str, changes: dict[str, str], author: tuple[str, str] | None = None) -> str:
        for rel, content in changes.items():
            target = self.path / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding="utf-8")
            self.files[rel] = content
        self.git("add", "-A")
        self.when += timedelta(minutes=rnd.randint(50, 420))
        name, email = author or rnd.choice(AUTHORS)
        stamp = self.when.isoformat()
        env = {"GIT_AUTHOR_NAME": name, "GIT_AUTHOR_EMAIL": email, "GIT_COMMITTER_NAME": name, "GIT_COMMITTER_EMAIL": email, "GIT_AUTHOR_DATE": stamp, "GIT_COMMITTER_DATE": stamp}
        self.git("commit", "-q", "-m", message, env=env)
        return self.git("rev-parse", "HEAD")


def feature_step(repo: Repo, message: str, module: str, code: str, tests: str, imports: str) -> None:
    cls = "".join(part.capitalize() for part in module.split("_")) + "Test"
    test_body = "\n".join("    " + line if line.strip() else "" for line in dedent(tests).splitlines())
    test = f"import unittest\n{imports}\n\n\nclass {cls}(unittest.TestCase):\n{test_body}\n"
    if "Decimal" in tests and "Decimal" not in imports:
        test = test.replace("import unittest\n", "import unittest\nfrom decimal import Decimal\n", 1)
    repo.commit(message, {f"pricing/{module}.py": dedent(code), f"tests/test_{module}.py": test})


def main() -> None:
    REPO.mkdir(parents=True, exist_ok=True)
    repo = Repo(REPO)
    repo.git("init", "-q", "-b", "main")
    lead = AUTHORS[0]
    repo.commit("init: корзина и округление денег", {".gitignore": "__pycache__/\n*.pyc\n", "Makefile": MAKEFILE, "pricing/__init__.py": INIT, "pricing/money.py": MONEY, "pricing/cart.py": CART, "pricing/discounts.py": DISCOUNTS, "tests/__init__.py": "", "tests/test_money.py": TEST_MONEY, "tests/test_cart.py": TEST_CART}, lead)
    repo.commit("test: скидки в процентах", {"tests/test_discounts.py": TEST_DISCOUNTS}, lead)
    repo.commit("feat: НДС в том числе", {"pricing/tax.py": TAX, "tests/test_tax.py": TEST_TAX}, AUTHORS[1])
    repo.commit("ci: сборка в каждом MR, тесты — ночью", {".gitlab-ci.yml": GITLAB_CI}, AUTHORS[3])
    repo.commit("docs: README", {"README.md": README, "CHANGELOG.md": "# Изменения\n"}, lead)

    # Остальные шаги в случайном порядке; WIP-блок и поломка встают в случайные места
    steps: list[tuple[str, object]] = [("feature", f) for f in FEATURES]
    notes = rnd.sample(CHANGELOG_NOTES, k=rnd.randint(14, len(CHANGELOG_NOTES)))
    steps += [("note", n) for n in notes]
    steps += [("doc", d) for d in DOC_PAGES]
    steps += [("ci", c) for c in CI_TWEAKS]
    # Положение блоков. После тега v1.3.0 идут R коммитов (шаги + 4 WIP-коммита + поломка). Первым шагом bisect
    # проверяет середину этого отрезка — туда ставится WIP-блок: наивный `bisect run make test` отметит его как bad
    # и назовёт первый WIP-коммит, а скрипт с кодом 125 для несобирающихся коммитов найдёт настоящую поломку.
    while True:
        rnd.shuffle(steps)
        release_at = rnd.randint(2, 6)
        after_tag = len(steps) - release_at + 5
        wip_at = release_at + after_tag // 2 - 2
        culprit_at = rnd.randint(wip_at + 3, len(steps) - 4)
        if sum(1 for kind, _ in steps[culprit_at:] if kind == "feature") >= 3:  # после поломки — фичи с тестами
            break

    def run_step(kind: str, payload) -> None:
        if kind == "feature":
            feature_step(repo, *payload)
        elif kind == "note":
            repo.commit(f"docs: {payload}", {"CHANGELOG.md": repo.files["CHANGELOG.md"] + f"- {payload}\n"})
        elif kind == "doc":
            path, text = payload
            repo.commit(f"docs: {Path(path).stem} — заметки команды", {path: text})
        elif kind == "ci":
            message, extra = payload
            repo.commit(message, {".gitlab-ci.yml": repo.files[".gitlab-ci.yml"] + extra})

    for i, (kind, payload) in enumerate(steps):
        if i == release_at:
            # последний релиз: ночные тесты на нём были зелёными
            repo.git("tag", "-a", "v1.3.0", "-m", "Релиз 1.3.0: ночные тесты зелёные", env={"GIT_COMMITTER_NAME": lead[0], "GIT_COMMITTER_EMAIL": lead[1], "GIT_COMMITTER_DATE": repo.when.isoformat()})
        if i == wip_at:
            author = rnd.choice(AUTHORS)
            tax_wip = repo.files["pricing/tax.py"].replace("from .money import to_money\n", "from .config import load_rates\nfrom .money import to_money\n").replace("VAT_RATE = 20\n", "VAT_RATE = load_rates().get(\"vat\", 20)\n")
            repo.commit("WIP: ставка НДС из конфига", {"pricing/tax.py": tax_wip}, author)
            repo.commit("WIP: README про переменную PRICING_VAT", {"README.md": repo.files["README.md"] + "\nСтавку НДС можно переопределить переменной PRICING_VAT.\n"}, author)
            repo.commit("docs: заметка о ставках в CHANGELOG", {"CHANGELOG.md": repo.files["CHANGELOG.md"] + "- ставка НДС настраивается\n"})
            config = dedent('''
                """Ставки налогов: по умолчанию из кода, можно переопределить переменной окружения."""

                import os


                def load_rates() -> dict[str, int]:
                    return {"vat": int(os.environ.get("PRICING_VAT", "20"))}
            ''')
            repo.commit("config: модуль ставок налогов", {"pricing/config.py": config}, author)
        if i == culprit_at:
            discounts = repo.files["pricing/discounts.py"].replace('"""Скидки."""', '"""Скидки на корзину."""').replace('"""Сумма после скидки в процентах."""', '"""Сумма после скидки percent процентов, до копеек."""')
            tax = repo.files["pricing/tax.py"].replace('"""НДС в том числе."""', '"""НДС, включённый в сумму."""')
            repo.commit("style: единый формат денежных функций", {"pricing/money.py": MONEY_BROKEN, "pricing/discounts.py": discounts, "pricing/tax.py": tax})
        run_step(kind, payload)


if __name__ == "__main__":
    main()
