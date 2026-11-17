"""SSRF Guard for External HTTP Requests.

Prevents Server-Side Request Forgery by validating destination URLs,
resolving hostnames to IP addresses, and blocking private, loopback,
link-local, cloud metadata, and multicast addresses.
"""
import ipaddress
import socket
from urllib.parse import urlparse
from app.core.errors import ValidationError

BLOCKED_NETWORKS = [
    ipaddress.ip_network("0.0.0.0/8"),
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("100.64.0.0/10"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.0.0.0/24"),
    ipaddress.ip_network("192.0.2.0/24"),
    ipaddress.ip_network("192.88.99.0/24"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("198.18.0.0/15"),
    ipaddress.ip_network("198.51.100.0/24"),
    ipaddress.ip_network("203.0.113.0/24"),
    ipaddress.ip_network("224.0.0.0/4"),
    ipaddress.ip_network("240.0.0.0/4"),
    ipaddress.ip_network("255.255.255.255/32"),
    ipaddress.ip_network("::/128"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
    ipaddress.ip_network("fe80::/10"),
    ipaddress.ip_network("ff00::/8"),
]

BLOCKED_HOSTNAMES = frozenset({
    "169.254.169.254",
    "metadata.google.internal",
    "instance-data",
    "localhost",
    "metadata.internal",
})


def is_ip_blocked(ip_str: str) -> bool:
    """Check if an IP address string falls inside any blocked subnet."""
    try:
        ip = ipaddress.ip_address(ip_str)
        return any(ip in net for net in BLOCKED_NETWORKS)
    except ValueError:
        return True


def validate_url_safe(url: str, allow_local: bool = False) -> str:
    """Validate URL for scheme and destination IP safety.

    Args:
        url: The absolute target URL to validate.
        allow_local: If True, bypass private/loopback check (for tests only).

    Returns:
        The validated URL.

    Raises:
        ValidationError: If scheme is unsupported or destination resolves to a forbidden IP.
    """
    if not url or not isinstance(url, str):
        raise ValidationError("URL must be a non-empty string.")

    cleaned_url = url.strip()
    parsed = urlparse(cleaned_url)

    if parsed.scheme.lower() not in ("http", "https"):
        raise ValidationError(f"Invalid URL scheme '{parsed.scheme}'. Only HTTP and HTTPS are permitted.")

    hostname = parsed.hostname
    if not hostname:
        raise ValidationError("URL does not contain a valid hostname.")

    if hostname.lower() in BLOCKED_HOSTNAMES and not allow_local:
        raise ValidationError(f"Access to hostname '{hostname}' is restricted for security (SSRF protection).")

    if allow_local:
        return cleaned_url

    port = parsed.port if parsed.port is not None else (443 if parsed.scheme.lower() == "https" else 80)

    try:
        addr_info = socket.getaddrinfo(hostname, port, proto=socket.IPPROTO_TCP)
        ip_addresses = [info[4][0] for info in addr_info]
        if not ip_addresses:
            raise ValidationError(f"Could not resolve an IP address for hostname '{hostname}'.")

        for resolved_ip in ip_addresses:
            if is_ip_blocked(resolved_ip):
                raise ValidationError(f"Access to '{hostname}' (resolving to {resolved_ip}) is blocked by SSRF security policy.")

        return cleaned_url
    except socket.gaierror as e:
        raise ValidationError(f"Failed to resolve hostname '{hostname}': {str(e)}")
