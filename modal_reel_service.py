"""Nitro Outreach pay-per-render Reel worker.

Deploy with:
  modal secret create nitro-reel-secrets MODAL_SHARED_SECRET=... NITRO_CALLBACK_SECRET=...
  modal deploy modal_reel_service.py

Set the resulting web URL as MODAL_RENDER_URL in Vercel and use the same
MODAL_SHARED_SECRET in both services.
"""
import hashlib
import hmac
import os
import shutil
import subprocess
import tempfile
import textwrap
from pathlib import Path

import modal

app = modal.App("nitro-reel-renderer")
volume = modal.Volume.from_name("nitro-reel-outputs", create_if_missing=True)
image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg", "fonts-dejavu-core")
    .pip_install("fastapi[standard]", "python-multipart", "httpx")
)


def signature(secret: str, value: str) -> str:
    return hmac.new(secret.encode(), value.encode(), hashlib.sha256).hexdigest()


@app.function(
    image=image,
    cpu=2,
    memory=4096,
    timeout=900,
    volumes={"/outputs": volume},
    secrets=[modal.Secret.from_name("nitro-reel-secrets")],
)
def render_video(input_bytes: bytes, payload: dict):
    import httpx

    job_id = payload["jobId"]
    callback = payload["callbackUrl"]
    title = str(payload.get("title") or "Built with Nitro Outreach")[:80]
    subtitle = str(payload.get("subtitle") or "Automate your outreach. Grow faster.")[:120]
    secret = os.environ["MODAL_SHARED_SECRET"]
    output_path = Path("/outputs") / f"{job_id}.mp4"
    temp_dir = Path(tempfile.mkdtemp(prefix="nitro-"))
    source = temp_dir / "source.mp4"
    source.write_bytes(input_bytes)

    def escape_text(value: str) -> str:
        return value.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")

    try:
        title_lines = textwrap.wrap(title, width=34)[:2] or ["Built with Nitro Outreach"]
        title_text = escape_text("\n".join(title_lines))
        subtitle_text = escape_text(subtitle)
        title_size = 52 if max(map(len, title_lines)) <= 28 else 44
        font = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
        # A vertical ad treatment: blurred full-frame ambience, floating product
        # screen, gentle cinematic motion, title/CTA, normalized audio and H.264.
        filters = (
            "[0:v]split=2[bgsrc][fgsrc];"
            "[bgsrc]scale=1080:1920:force_original_aspect_ratio=increase,"
            "crop=1080:1920,boxblur=30:12,eq=brightness=-0.25:saturation=1.15[bg];"
            "[fgsrc]scale=980:1100:force_original_aspect_ratio=decrease,"
            "pad=980:1100:(ow-iw)/2:(oh-ih)/2:color=0x0b0b0b,"
            "zoompan=z='min(zoom+0.00045,1.055)':x='iw/2-(iw/zoom/2)':"
            "y='ih/2-(ih/zoom/2)':d=1:s=980x1100:fps=30[screen];"
            "[bg][screen]overlay=x='(W-w)/2+8*sin(t*1.2)':y='(H-h)/2+35+6*sin(t*1.8)',"
            "drawbox=x=45:y=105:w=990:h=210:color=black@0.55:t=fill,"
            f"drawtext=fontfile={font}:text='{title_text}':fontcolor=white:fontsize={title_size}:"
            "line_spacing=8:x=(w-text_w)/2:y=130:enable='between(t,0,6)',"
            f"drawtext=fontfile={font}:text='{subtitle_text}':fontcolor=0xff8a33:fontsize=29:"
            "x=(w-text_w)/2:y=265:enable='between(t,0,6)',"
            "drawbox=x=160:y=1715:w=760:h=92:color=0xff6b00@0.94:t=fill:"
            "enable='gte(t,5)',"
            f"drawtext=fontfile={font}:text='TRY NITRO OUTREACH':fontcolor=white:fontsize=38:"
            "x=(w-text_w)/2:y=1740:enable='gte(t,5)',"
            "format=yuv420p[outv]"
        )
        cmd = [
            "ffmpeg", "-y", "-i", str(source), "-filter_complex", filters,
            "-map", "[outv]", "-map", "0:a?",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
            "-c:a", "aac", "-b:a", "160k", "-af", "loudnorm=I=-14:TP=-1.5:LRA=11",
            "-movflags", "+faststart", "-r", "30", "-t", "90", str(output_path),
        ]
        subprocess.run(cmd, check=True, capture_output=True, text=True)
        volume.commit()
        base_url = str(payload.get("downloadBase") or "").rstrip("/")
        output_url = f"{base_url}/download/{job_id}"
        status = "completed"
        body = {
            "jobId": job_id,
            "status": status,
            "outputUrl": output_url,
            "signature": signature(secret, f"{job_id}:{status}:{output_url}"),
        }
        httpx.post(callback, json=body, timeout=30).raise_for_status()
    except Exception as exc:
        status = "failed"
        output_url = ""
        body = {
            "jobId": job_id,
            "status": status,
            "outputUrl": output_url,
            "error": str(exc)[-500:],
            "signature": signature(secret, f"{job_id}:{status}:{output_url}"),
        }
        try:
            httpx.post(callback, json=body, timeout=30)
        finally:
            if output_path.exists():
                output_path.unlink()
                volume.commit()
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


@app.function(
    image=image,
    cpu=0.25,
    memory=512,
    timeout=120,
    volumes={"/outputs": volume},
    secrets=[modal.Secret.from_name("nitro-reel-secrets")],
)
@modal.asgi_app()
def web():
    from fastapi import FastAPI, File, Form, HTTPException, UploadFile
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import FileResponse

    api = FastAPI()
    api.add_middleware(
        CORSMiddleware,
        allow_origins=["https://nitrooutreach.com", "http://localhost:3000"],
        allow_methods=["POST", "GET"],
        allow_headers=["*"],
    )

    @api.post("/render", status_code=202)
    async def render(
        video: UploadFile = File(...),
        jobId: str = Form(...),
        customerId: str = Form(...),
        token: str = Form(...),
        callbackUrl: str = Form(...),
        title: str = Form("Built with Nitro Outreach"),
        subtitle: str = Form("Automate your outreach. Grow faster."),
        style: str = Form("clean"),
        downloadBase: str = Form(...),
    ):
        secret = os.environ["MODAL_SHARED_SECRET"]
        expected = signature(secret, f"{jobId}:{customerId}")
        if not hmac.compare_digest(token, expected):
            raise HTTPException(403, "Invalid render token")
        data = await video.read()
        if not data or len(data) > 250 * 1024 * 1024:
            raise HTTPException(400, "Use a video under 250 MB")
        await render_video.spawn.aio(data, {
            "jobId": jobId, "customerId": customerId, "callbackUrl": callbackUrl,
            "title": title, "subtitle": subtitle, "style": style, "downloadBase": downloadBase,
        })
        return {"ok": True, "jobId": jobId}

    @api.get("/download/{job_id}")
    async def download(job_id: str):
        path = Path("/outputs") / f"{job_id}.mp4"
        if not path.exists():
            raise HTTPException(404, "Video expired or was not found")
        return FileResponse(path, media_type="video/mp4", filename="nitro-reel.mp4")

    return api
