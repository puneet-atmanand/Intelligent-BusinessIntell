"""Pagination Engine for Multi-Page API Ingestion."""
import asyncio
import logging
import re
from typing import Any, Callable, Dict, List, Optional, Tuple

from app.services.api_connect.client import ApiConnectClient, ApiResponse
from app.services.api_connect.normalizer import navigate_path

logger = logging.getLogger(__name__)


def extract_link_header_next(link_header: Optional[str]) -> Optional[str]:
    """Parse RFC 5988 Link header to extract rel="next" URL."""
    if not link_header:
        return None
    matches = re.findall(r'<([^>]+)>;\s*rel="([^"]+)"', link_header)
    for url, rel in matches:
        if rel.lower() == "next":
            return url
    return None


class ApiPaginator:
    """Orchestrates paginated requests across various API pagination strategies."""

    def __init__(
        self,
        client: ApiConnectClient,
        pagination_config: Optional[Dict[str, Any]] = None,
        max_pages: int = 50,
        max_records: int = 50000,
    ):
        self.client = client
        self.config = pagination_config or {}
        self.strategy = self.config.get("strategy", "none").lower()
        self.max_pages = min(int(self.config.get("max_pages", max_pages)), 100)
        self.max_records = int(self.config.get("max_records", max_records))
        self.rate_limit_delay = float(self.config.get("rate_limit_delay_seconds", 0.05))

    async def fetch_all_pages(
        self,
        path_or_url: str,
        method: str = "GET",
        headers: Optional[Dict[str, str]] = None,
        query_params: Optional[Dict[str, Any]] = None,
        body: Optional[Any] = None,
        response_path: Optional[str] = None,
        progress_callback: Optional[Callable[[int, int], None]] = None,
    ) -> Tuple[List[Any], List[ApiResponse]]:
        """Fetch all pages according to the configured pagination strategy.

        Returns:
            (all_raw_records, list_of_api_responses)
        """
        all_records: List[Any] = []
        responses: List[ApiResponse] = []
        params = dict(query_params) if query_params else {}
        current_url = path_or_url

        page_param = self.config.get("page_param", "page")
        size_param = self.config.get("size_param", "limit")
        page_size = int(self.config.get("page_size", 50))
        current_page = int(self.config.get("initial_page", 1))
        current_offset = int(self.config.get("initial_offset", 0))
        cursor_param = self.config.get("cursor_param", "cursor")
        cursor_path = self.config.get("cursor_path", "next_cursor")
        current_cursor: Optional[str] = None

        for page_num in range(1, self.max_pages + 1):
            if self.strategy == "page":
                params[page_param] = current_page
                params[size_param] = page_size
            elif self.strategy == "offset":
                params["offset"] = current_offset
                params[size_param] = page_size
            elif self.strategy == "cursor":
                if current_cursor:
                    params[cursor_param] = current_cursor

            resp = await self.client.request(
                path_or_url=current_url,
                method=method,
                headers=headers,
                query_params=params,
                body=body,
            )
            responses.append(resp)

            if resp.status_code >= 400:
                logger.warning(
                    f"Pagination stopped at page {page_num} due to HTTP error: {resp.status_code}"
                )
                break

            if response_path:
                extracted = navigate_path(resp.data, response_path)
            else:
                extracted = resp.data

            if extracted is None:
                page_records = []
            elif isinstance(extracted, list):
                page_records = extracted
            elif isinstance(extracted, dict):
                page_records = [extracted]
            else:
                page_records = [{"value": extracted}]

            if not page_records:
                return all_records, responses

            all_records.extend(page_records)

            if progress_callback:
                progress_callback(page_num, len(all_records))

            if len(all_records) >= self.max_records:
                all_records = all_records[: self.max_records]
                return all_records, responses

            if self.strategy in ("none", "", None):
                return all_records, responses

            if self.strategy == "page":
                current_page += 1
                if len(page_records) < page_size:
                    return all_records, responses
            elif self.strategy == "offset":
                current_offset += len(page_records)
                if len(page_records) < page_size:
                    return all_records, responses
            elif self.strategy == "cursor":
                next_cur = navigate_path(resp.data, cursor_path)
                if not next_cur or next_cur == current_cursor:
                    return all_records, responses
                current_cursor = str(next_cur)
            elif self.strategy == "link_header":
                link_header = resp.headers.get("link")
                next_url = extract_link_header_next(link_header)
                if not next_url:
                    return all_records, responses
                current_url = next_url
                params = {}

            if self.rate_limit_delay > 0:
                await asyncio.sleep(self.rate_limit_delay)

        return all_records, responses
