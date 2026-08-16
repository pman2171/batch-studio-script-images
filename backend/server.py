from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
import os
import base64
import logging
from pathlib import Path
from pydantic import BaseModel, Field
import httpx


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# xAI Grok image generation config
XAI_API_KEY = os.environ.get('XAI_API_KEY', '')
XAI_URL = "https://api.x.ai/v1/images/generations"
XAI_MODEL = os.environ.get('XAI_MODEL', 'grok-imagine-image-2.0')

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class GenerateRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=4000)


@api_router.get("/")
async def root():
    return {"message": "Batch image generator running"}


@api_router.get("/config")
async def config():
    """Report whether the API key is configured, so the UI can warn early."""
    return {"api_key_configured": bool(XAI_API_KEY), "model": XAI_MODEL}


@api_router.post("/generate")
async def generate_image(req: GenerateRequest):
    if not XAI_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="XAI_API_KEY is not configured on the server.",
        )

    payload = {
        "model": XAI_MODEL,
        "prompt": req.prompt,
        "n": 1,
        "response_format": "b64_json",
    }
    headers = {
        "Authorization": f"Bearer {XAI_API_KEY}",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=180) as client:
            response = await client.post(XAI_URL, headers=headers, json=payload)
    except httpx.RequestError as e:
        logger.error(f"xAI request error: {e}")
        raise HTTPException(status_code=502, detail="Could not reach the image API.")

    if response.status_code >= 400:
        detail = response.text[:400]
        logger.warning(f"xAI failed {response.status_code}: {detail}")
        raise HTTPException(
            status_code=response.status_code,
            detail=f"Image API error: {detail}",
        )

    body = response.json()
    try:
        item = body["data"][0]
        encoded = item.get("b64_json")
        if encoded:
            base64.b64decode(encoded, validate=True)
            image_b64 = encoded
        else:
            # Fallback: some responses return a temporary URL
            url = item["url"]
            async with httpx.AsyncClient(timeout=180) as client:
                img_res = await client.get(url)
            image_b64 = base64.b64encode(img_res.content).decode("ascii")
    except (KeyError, IndexError, ValueError) as e:
        logger.error(f"Unexpected xAI response: {e}")
        raise HTTPException(status_code=502, detail="Image API returned no valid image.")

    return {"image": f"data:image/png;base64,{image_b64}"}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)
