"""OpenAPI 3.0/3.1 and Swagger 2.0 Importer and Parser."""
import json
import logging
from typing import Any, Dict, List, Optional, Tuple

import yaml

from app.core.errors import ValidationError
from app.services.api_connect.client import ApiConnectClient

logger = logging.getLogger(__name__)


def parse_openapi_content(content_str: str) -> Dict[str, Any]:
    """Parse JSON or YAML OpenAPI specification string."""
    content_str = content_str.strip()
    try:
        if content_str.startswith("{"):
            data = json.loads(content_str)
        else:
            data = yaml.safe_load(content_str)
    except Exception as e:
        raise ValidationError(f"Invalid OpenAPI content (failed to parse as JSON or YAML): {str(e)}")

    if not isinstance(data, dict):
        raise ValidationError("OpenAPI specification must be a valid JSON or YAML document object.")
    return data


class OpenApiParser:
    """Parses OpenAPI / Swagger documents to discover endpoints, schemas, and configurations."""

    @classmethod
    async def load_from_url(cls, spec_url: str, allow_local: bool = False) -> Dict[str, Any]:
        """Fetch specification from remote URL safely."""
        client = ApiConnectClient(timeout_seconds=30, allow_local=allow_local)
        resp = await client.execute(spec_url, method="GET")
        if not resp.success:
            raise ValidationError(f"Failed to fetch OpenAPI spec from {spec_url}: {resp.error_message}")
        if isinstance(resp.data, dict):
            return resp.data
        return parse_openapi_content(resp.text)

    @classmethod
    def parse_specification(cls, spec: Dict[str, Any]) -> Dict[str, Any]:
        """Parse OpenAPI specification into normalized metadata and endpoint list."""
        if not isinstance(spec, dict):
            raise ValidationError("Specification must be a dictionary.")

        is_swagger_2 = str(spec.get("swagger", "")).startswith("2")
        is_openapi_3 = str(spec.get("openapi", "")).startswith("3")

        if not is_swagger_2 and not is_openapi_3:
            raise ValidationError("Document is not a recognized Swagger 2.0 or OpenAPI 3.x specification.")

        info = spec.get("info") or {}
        title = info.get("title", "Imported API")
        description = info.get("description", "")
        version = info.get("version", "1.0.0")

        base_url = ""
        if is_openapi_3:
            servers = spec.get("servers")
            if servers and isinstance(servers, list):
                base_url = servers[0].get("url", "")
        else:
            host = spec.get("host", "")
            base_path = spec.get("basePath", "")
            schemes = spec.get("schemes", ["https"])
            scheme = schemes[0] if schemes else "https"
            if host:
                base_url = f"{scheme}://{host}{base_path.rstrip('/')}"

        paths = spec.get("paths") or {}
        endpoints: List[Dict[str, Any]] = []

        for path_str, path_item in paths.items():
            if not isinstance(path_item, dict):
                continue
            common_params = path_item.get("parameters") or []

            for method, op_data in path_item.items():
                if method.lower() not in ("get", "post", "put", "patch", "delete"):
                    continue
                if not isinstance(op_data, dict):
                    continue

                operation_id = op_data.get("operationId", "")
                summary = op_data.get("summary", "")
                op_desc = op_data.get("description", "")
                tags = op_data.get("tags") or []

                all_params = list(common_params) + list(op_data.get("parameters") or [])
                query_params: Dict[str, Any] = {}
                header_params: Dict[str, str] = {}

                for p in all_params:
                    if not isinstance(p, dict):
                        continue
                    p_name = p.get("name")
                    p_in = p.get("in")
                    default_val = p.get("default", "")
                    if p_in == "query" and p_name:
                        query_params[p_name] = default_val
                    elif p_in == "header" and p_name:
                        header_params[p_name] = str(default_val)

                name = summary or operation_id or f"{method.upper()} {path_str}"

                endpoints.append({
                    "name": name,
                    "path": path_str,
                    "method": method.upper(),
                    "summary": summary,
                    "description": op_desc,
                    "operation_id": operation_id,
                    "tags": tags,
                    "query_params": query_params,
                    "headers": header_params,
                })

        return {
            "title": title,
            "description": description,
            "version": version,
            "base_url": base_url,
            "endpoints": endpoints,
        }
