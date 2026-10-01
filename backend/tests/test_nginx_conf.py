"""deploy/nginx.conf regressiya testi: tunnel klient IP himoyasi (TIBEX_TUNNEL_REALIP_v1).

nginx'ni ishga tushirmasdan, konfiguratsiya matnini tekshiradi: yangi `location`
qo'shilganda tunnel belgisi yoki XFF qayta yozilishi esdan chiqib qolmasin.
"""
from __future__ import annotations

import re
from ipaddress import ip_address, ip_network
from pathlib import Path

CONF = (Path(__file__).resolve().parent.parent / "deploy" / "nginx.conf").read_text(encoding="utf-8")
LINES = [ln for ln in CONF.splitlines()]


def _active(lines):
    return [ln.strip() for ln in lines if ln.strip() and not ln.strip().startswith("#")]


def _proxy_locations() -> dict[str, list[str]]:
    """{location sarlavhasi: ichidagi faol qatorlar} — faqat proxy_pass borlari."""
    out: dict[str, list[str]] = {}
    cur, body = None, []
    for ln in LINES:
        if cur is None:
            if re.match(r"^    location\s", ln) and ln.rstrip().endswith("{"):
                cur, body = ln.strip(), []
        elif ln.rstrip() == "    }":
            if any("proxy_pass" in b for b in body):
                out[cur] = _active(body)
            cur = None
        else:
            body.append(ln)
    return out


def test_proxy_locations_found():
    assert len(_proxy_locations()) == 5


def test_every_proxy_location_sets_safe_headers():
    for name, body in _proxy_locations().items():
        assert "proxy_set_header X-Forwarded-For $remote_addr;" in body, name
        assert 'proxy_set_header Cf-Connecting-Ip "";' in body, name
        assert 'proxy_set_header True-Client-IP "";' in body, name
        assert "proxy_set_header X-Tibex-Tunnel $tibex_via_tunnel;" in body, name


def test_xff_is_never_appended_from_client():
    assert "$proxy_add_x_forwarded_for" not in CONF


def test_realip_directives_present():
    active = _active(LINES)
    assert "real_ip_header CF-Connecting-IP;" in active
    assert "real_ip_recursive off;" in active
    assert any(ln.startswith("set_real_ip_from ") for ln in active)


def test_set_real_ip_from_is_never_a_lan_or_wide_range():
    """LAN yoki keng diapazon bo'lsa, LAN'dagi har kim Cf-Connecting-Ip soxtalashtira oladi."""
    for ln in _active(LINES):
        m = re.match(r"set_real_ip_from\s+(\S+?);", ln)
        if not m:
            continue
        net = ip_network(m.group(1), strict=False)
        assert net.num_addresses == 1, f"{m.group(1)}: faqat bitta aniq manzil bo'lishi kerak"
        addr = ip_address(net.network_address)
        assert not addr.is_unspecified
        if not addr.is_loopback:
            # docker konteyner manzili ruxsat, lekin LAN gateway/keng subnet emas
            assert addr.is_private, m.group(1)


def test_tunnel_flag_map_uses_original_cf_header():
    active = " ".join(_active(LINES))
    assert "map $http_cf_connecting_ip $tibex_via_tunnel" in active
    assert re.search(r'default 1;\s*""\s+0;', active)
