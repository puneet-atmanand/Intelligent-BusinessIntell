"""LLM Provider Factory configured for Groq, Gemini, and OpenAI."""
import os
from typing import Optional
from app.ai.providers.base import BaseLLMProvider
from app.ai.providers.gemini import GeminiProvider
from app.ai.providers.groq import GroqProvider
from app.ai.providers.mock import MockProvider
from app.core.config import settings


def get_llm_provider(
    provider_name: Optional[str] = None,
    model_name: Optional[str] = None,
) -> BaseLLMProvider:
    """Instantiate configured LLM provider."""
    provider = (provider_name or os.getenv("LLM_PROVIDER") or settings.LLM_PROVIDER or "groq").lower()
    model = model_name or os.getenv("LLM_MODEL") or settings.LLM_MODEL
    groq_key = os.getenv("GROQ_API_KEY") or settings.GROQ_API_KEY
    gemini_key = os.getenv("GEMINI_API_KEY") or settings.GEMINI_API_KEY

    if provider == "gemini":
        if gemini_key:
            return GeminiProvider(model=model or "gemini-flash-lite-latest", api_key=gemini_key)
        return MockProvider(model="mock-analyst")

    if provider == "groq":
        if groq_key:
            return GroqProvider(model=model or "openai/gpt-oss-120b", api_key=groq_key)
        return MockProvider(model="mock-analyst")

    if groq_key:
        return GroqProvider(model=model or "openai/gpt-oss-120b", api_key=groq_key)

    return MockProvider(model="mock-analyst")
