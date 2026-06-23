PROVIDER_CATALOG = {
    "openai": {
        "id": "openai",
        "label": "ChatGPT (OpenAI)",
        "defaultBaseUrl": "https://api.openai.com/v1",
        "defaultModel": "gpt-4o",
        "models": ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "o3-mini"],
        "supportsAgent": True,
    },
    "grok": {
        "id": "grok",
        "label": "Grok (xAI)",
        "defaultBaseUrl": "https://api.x.ai/v1",
        "defaultModel": "grok-2-latest",
        "models": ["grok-2-latest", "grok-2", "grok-beta"],
        "supportsAgent": True,
    },
    "cloud_ai": {
        "id": "cloud_ai",
        "label": "Cloud AI (Gemini)",
        "defaultBaseUrl": "https://generativelanguage.googleapis.com/v1beta",
        "defaultModel": "gemini-2.0-flash",
        "models": ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"],
        "supportsAgent": True,
    },
    "cursor": {
        "id": "cursor",
        "label": "Cursor SDK",
        "defaultBaseUrl": None,
        "defaultModel": "composer-2.5",
        "models": ["composer-2.5"],
        "supportsAgent": True,
    },
}

PROVIDER_IDS = list(PROVIDER_CATALOG.keys())
