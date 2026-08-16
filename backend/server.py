from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
import os
import io
import uuid
import base64
import asyncio
import logging
from pathlib import Path
from pydantic import BaseModel, Field
import httpx
from PIL import Image


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

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

# In-memory job store (single-user personal tool, no DB by design).
JOBS = {}


class GenerateRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=4000)


async def _call_xai(prompt: str) -> str:
    """Call xAI, return a true-PNG data URL. Raises on failure."""
    payload = {
        "model": XAI_MODEL,
        "prompt": prompt,
        "n": 1,
        "response_format": "b64_json",
    }
    headers = {
        "Authorization": f"Bearer {XAI_API_KEY}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=240) as client:
        response = await client.post(XAI_URL, headers=headers, json=payload)

    if response.status_code >= 400:
        detail = response.text[:400]
        raise RuntimeError(f"Image API error ({response.status_code}): {detail}")

    body = response.json()
    item = body["data"][0]
    encoded = item.get("b64_json")
    if encoded:
        raw = base64.b64decode(encoded, validate=True)
    else:
        url = item["url"]
        async with httpx.AsyncClient(timeout=240) as client:
            img_res = await client.get(url)
        raw = img_res.content

    # Convert whatever format xAI returns (usually JPEG) into a real PNG.
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    out = io.BytesIO()
    img.save(out, format="PNG")
    png_b64 = base64.b64encode(out.getvalue()).decode("ascii")
    return f"data:image/png;base64,{png_b64}"


async def _run_job(job_id: str, prompt: str):
    JOBS[job_id]["status"] = "running"
    try:
        image = await _call_xai(prompt)
        JOBS[job_id].update(status="done", image=image)
    except Exception as e:
        logger.warning(f"Job {job_id} failed: {e}")
        JOBS[job_id].update(status="failed", error=str(e)[:400])


@api_router.get("/")
async def root():
    return {"message": "Batch image generator running"}


@api_router.get("/config")
async def config():
    return {"api_key_configured": bool(XAI_API_KEY), "model": XAI_MODEL}


@api_router.post("/jobs")
async def create_job(req: GenerateRequest):
    if not XAI_API_KEY:
        raise HTTPException(status_code=503, detail="XAI_API_KEY is not configured on the server.")
    job_id = str(uuid.uuid4())
    JOBS[job_id] = {"status": "pending", "image": None, "error": None, "prompt": req.prompt}
    asyncio.create_task(_run_job(job_id, req.prompt))
    return {"job_id": job_id, "status": "pending"}


@api_router.get("/jobs/{job_id}")
async def get_job(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return {
        "job_id": job_id,
        "status": job["status"],
        "image": job["image"] if job["status"] == "done" else None,
        "error": job["error"],
    }


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)
