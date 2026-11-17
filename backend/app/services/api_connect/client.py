"""Async HTTP Client for API Connect with Auth Injection, SSRF Guard, and Retries."""
import asyncio
import base64
import json
import logging
import time
from dataclasses import dataclass
from typing import Any, Dict, Optional, Tuple
from urllib.parse import urljoin

import httpx

from app.core.security import decrypt_secret
from app.services.api_connect.ssrf_guard import validate_url_safe

logger = logging.getLogger(__name__)


@dataclass
class ApiResponse:
    """Standardized response wrapper from API Connect HTTP execution."""
    status_code: int
    headers: Dict[str, str]
    data: Any
    text: str
    duration_ms: int
    content_type: str
    success: bool
    error_message: Optional[str] = None


class ApiConnectClient:
    """Executes outbound HTTP requests for API Connect data ingestion and exploration."""

    def __init__(
        self,
        base_url: str = "",
        auth_type: str = "none",
        auth_config: Optional[Dict[str, Any]] = None,
        encrypted_secret: Optional[str] = None,
        plain_secret: Optional[str] = None,
        default_headers: Optional[Dict[str, str]] = None,
        timeout_seconds: int = 30,
        max_retries: int = 3,
        verify_ssl: bool = True,
        allow_local: bool = False,
    ):
        self.base_url = (base_url or "").rstrip("/")
        self.auth_type = (auth_type or "none").lower()
        self.auth_config = auth_config or {}
        self.default_headers = default_headers or {}
        self.timeout_seconds = timeout_seconds
        self.max_retries = max(0, min(max_retries, 5))
        self.verify_ssl = verify_ssl
        self.allow_local = allow_local

        if plain_secret:
            self.secret = plain_secret
        elif encrypted_secret:
            try:
                self.secret = decrypt_secret(encrypted_secret)
            except Exception as e:
                logger.warning(f"Could not decrypt secret: {e}")
                self.secret = ""
        else:
            self.secret = ""

    def resolve_url(self, path_or_url: str) -> str:
        """Resolve full target URL."""
        if not path_or_url:
            return self.base_url
        path_or_url = path_or_url.strip()
        if path_or_url.startswith("http://") or path_or_url.startswith("https://"):
            return path_or_url
        if not self.base_url:
            return path_or_url
        clean_path = path_or_url.lstrip("/")
        return f"{self.base_url}/{clean_path}" if clean_path else self.base_url

    async def _resolve_oauth2_token(self, client: httpx.AsyncClient) -> Optional[str]:
        """Fetch OAuth2 bearer token via client_credentials flow."""
        token_url = self.auth_config.get("token_url")
        client_id = self.auth_config.get("client_id")
        client_secret = self.secret or self.auth_config.get("client_secret", "")
        scope = self.auth_config.get("scope", "")

        if not token_url or not client_id or not client_secret:
            return None

        validate_url_safe(token_url, allow_local=self.allow_local)
        payload = {
            "grant_type": "client_credentials",
            "client_id": client_id,
            "client_secret": client_secret,
        }
        if scope:
            payload["scope"] = scope

        res = await client.post(token_url, data=payload, timeout=self.timeout_seconds)
        if res.is_success:
            json_body = res.json()
            return json_body.get("access_token")
        return None

    async def _build_auth(
        self,
        headers: Dict[str, str],
        params: Dict[str, Any],
        client: httpx.AsyncClient,
    ) -> Tuple[Dict[str, str], Dict[str, Any]]:
        """Inject authentication parameters into headers or query params."""
        headers = dict(headers)
        params = dict(params)

        if self.auth_type == "bearer":
            token = self.secret or self.auth_config.get("token", "")
            if token:
                headers["Authorization"] = f"Bearer {token}"
        elif self.auth_type == "api_key":
            key_name = self.auth_config.get("key_name", "X-API-Key")
            in_loc = self.auth_config.get("in", "header")
            key_val = self.secret or self.auth_config.get("key_value", "")
            if in_loc == "query":
                params[key_name] = key_val
            else:
                headers[key_name] = key_val
        elif self.auth_type == "basic":
            username = self.auth_config.get("username", "")
            password = self.secret or self.auth_config.get("password", "")
            creds = f"{username}:{password}".encode("utf-8")
            b64_creds = base64.b64encode(creds).decode("utf-8")
            headers["Authorization"] = f"Basic {b64_creds}"
        elif self.auth_type == "oauth2":
            token = await self._resolve_oauth2_token(client)
            if token:
                headers["Authorization"] = f"Bearer {token}"

        return headers, params

    async def execute(
        self,
        path_or_url: str = "",
        method: str = "GET",
        headers: Optional[Dict[str, str]] = None,
        query_params: Optional[Dict[str, Any]] = None,
        body: Optional[Any] = None,
    ) -> ApiResponse:
        """Execute HTTP request with SSRF validation, auth injection, and retries."""
        full_url = self.resolve_url(path_or_url)
        safe_url = validate_url_safe(full_url, allow_local=self.allow_local)

        merged_headers = {**self.default_headers, **(headers or {})}
        if not any(k.lower() == "user-agent" for k in merged_headers.keys()):
            merged_headers["User-Agent"] = "IntelligentBI-ApiConnect/1.0 (compatible; httpx/0.28)"
        merged_params = dict(query_params or {})

        start_time = time.time()
        timeout = httpx.Timeout(self.timeout_seconds, connect=10.0)

        json_payload = None
        data_payload = None
        if body is not None:
            if isinstance(body, (dict, list)):
                json_payload = body
            elif isinstance(body, str):
                try:
                    json_payload = json.loads(body)
                except Exception:
                    data_payload = body.encode("utf-8")
            else:
                data_payload = str(body).encode("utf-8")

        last_error: Optional[Exception] = None

        async def _on_request(request: httpx.Request) -> None:
            validate_url_safe(str(request.url), allow_local=self.allow_local)

        async with httpx.AsyncClient(
            verify=self.verify_ssl,
            timeout=timeout,
            follow_redirects=True,
            event_hooks={"request": [_on_request]},
        ) as client:
            final_headers, final_params = await self._build_auth(merged_headers, merged_params, client)

            for attempt in range(self.max_retries + 1):
                try:
                    req_kwargs: Dict[str, Any] = {
                        "headers": final_headers,
                        "params": final_params,
                    }
                    if json_payload is not None:
                        req_kwargs["json"] = json_payload
                    elif data_payload is not None:
                        req_kwargs["content"] = data_payload

                    response = await client.request(method, safe_url, **req_kwargs)
                    duration_ms = int((time.time() - start_time) * 1000)
                    content_type = response.headers.get("content-type", "")

                    if response.status_code in (429, 502, 503, 504) and attempt < self.max_retries:
                        retry_after = response.headers.get("retry-after")
                        if retry_after and retry_after.isdigit():
                            backoff = float(retry_after)
                        else:
                            backoff = 0.5 * (2 ** attempt)
                        await asyncio.sleep(min(backoff, 10.0))
                        continue

                    parsed_data = None
                    text_content = response.text
                    if "application/json" in content_type or text_content.strip().startswith(("{", "[")):
                        try:
                            parsed_data = response.json()
                        except Exception:
                            parsed_data = text_content
                    else:
                        parsed_data = text_content

                    is_resp_success = response.is_success or response.status_code == 304
                    return ApiResponse(
                        status_code=response.status_code,
                        headers=dict(response.headers),
                        data=parsed_data,
                        text=text_content,
                        duration_ms=duration_ms,
                        content_type=content_type,
                        success=is_resp_success,
                        error_message=None if is_resp_success else f"HTTP {response.status_code}: {response.reason_phrase}",
                    )

                except (httpx.ConnectError, httpx.TimeoutException, httpx.NetworkError) as exc:
                    last_error = exc
                    if attempt < self.max_retries:
                        await asyncio.sleep(0.5 * (2 ** attempt))
                        continue
                except Exception as exc:
                    last_error = exc
                    break

        duration_ms = int((time.time() - start_time) * 1000)
        return ApiResponse(
            status_code=0,
            headers={},
            data=None,
            text="",
            duration_ms=duration_ms,
            content_type="",
            success=False,
            error_message=f"Request failed: {str(last_error)}",
        )

    # Alias for execute
    request = execute
