"""Nitro Outreach prompt-to-Reel worker."""
import hashlib
import hmac
import json
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


def safe_color(value: str) -> str:
    raw = str(value or "").strip().lstrip("#")
    return raw if len(raw) in (6, 8) and all(c in "0123456789abcdefABCDEF" for c in raw) else "ff6b00"


def escape_text(value: str) -> str:
    return (
        str(value or "")
        .replace("\\", "\\\\")
        .replace(":", "\\:")
        .replace("'", "\\'")
        .replace("%", "\\%")
        .replace(",", "\\,")
    )


def wrapped(value: str, width: int, lines: int) -> str:
    return "\n".join(textwrap.wrap(str(value or ""), width=width)[:lines])


@app.function(
    image=image,
    cpu=2,
    memory=4096,
    timeout=900,
    volumes={"/outputs": volume},
    secrets=[modal.Secret.from_name("nitro-reel-secrets")],
)
def render_prompt_video(payload: dict):
    import httpx

    job_id = payload["jobId"]
    callback = payload["callbackUrl"]
    secret = os.environ["MODAL_SHARED_SECRET"]
    output_path = Path("/outputs") / f"{job_id}.mp4"
    temp_dir = Path(tempfile.mkdtemp(prefix="nitro-prompt-"))
    try:
        plan = json.loads(payload.get("plan") or "{}")
        scenes = list(plan.get("scenes") or [])[:10]
        if len(scenes) < 3:
            raise ValueError("The ad plan did not contain enough scenes")
        duration = max(15, min(45, int(payload.get("duration") or 15)))
        accent = safe_color(payload.get("accent"))
        tone = str(payload.get("tone") or "bold")
        font_bold = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
        font_regular = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
        scene_time = duration / len(scenes)

        # A native vertical motion-ad template: animated brand ambience, fast
        # scene changes, oversized hooks, benefit cards, progress, and CTA.
        filters = [
            f"[0:v]format=yuv420p,"
            f"drawbox=x='-240+mod(t*95\\,1500)':y=1180:w=760:h=760:color=0x{accent}@0.10:t=fill,"
            f"drawbox=x='900-mod(t*70\\,1450)':y=80:w=540:h=540:color=0x{accent}@0.13:t=fill,"
            "drawgrid=w=120:h=120:t=1:c=white@0.025,"
            "drawbox=x=70:y=72:w=12:h=44:color=white@0.92:t=fill,"
            f"drawtext=fontfile={font_bold}:text='NITRO  /  AI REEL':fontcolor=white@0.92:fontsize=25:x=104:y=80,"
            f"drawtext=fontfile={font_regular}:text='MADE TO STOP THE SCROLL':fontcolor=white@0.38:fontsize=16:x=104:y=116,"
            f"drawbox=x=70:y=1818:w=940:h=5:color=white@0.12:t=fill,"
            f"drawbox=x=70:y=1818:w='940*t/{duration}':h=5:color=0x{accent}:t=fill"
        ]
        for index, scene in enumerate(scenes):
            start = index * scene_time
            end = duration if index == len(scenes) - 1 else (index + 1) * scene_time
            fade = (
                f"if(lt(t\\,{start + 0.35})\\,(t-{start})/0.35\\,"
                f"if(gt(t\\,{end - 0.3})\\,({end}-t)/0.3\\,1))"
            )
            eyebrow = escape_text(str(scene.get("eyebrow") or "NITRO").upper())
            headline = escape_text(wrapped(scene.get("headline"), 21, 3))
            body = escape_text(wrapped(scene.get("body"), 37, 3))
            count = f"{index + 1:02d}"
            filters.extend([
                f"drawtext=fontfile={font_bold}:text='{count}':fontcolor=0x{accent}@0.22:"
                f"fontsize=280:x=750:y=210:alpha='{fade}':enable='between(t,{start},{end})'",
                f"drawbox=x='70+28*(1-{fade})':y=455:w=205:h=52:color=0x{accent}@0.96:t=fill:"
                f"enable='between(t,{start},{end})'",
                f"drawtext=fontfile={font_bold}:text='{eyebrow}':fontcolor=white:fontsize=20:"
                f"x='91+28*(1-{fade})':y=470:alpha='{fade}':enable='between(t,{start},{end})'",
                f"drawtext=fontfile={font_bold}:text='{headline}':fontcolor=white:fontsize=72:"
                f"line_spacing=16:x='70+70*(1-{fade})':y=570:alpha='{fade}':"
                f"enable='between(t,{start},{end})'",
                f"drawtext=fontfile={font_regular}:text='{body}':fontcolor=white@0.70:fontsize=31:"
                f"line_spacing=11:x='74+42*(1-{fade})':y=900:alpha='{fade}':"
                f"enable='between(t,{start},{end})'",
            ])
            # Three animated proof/benefit cards make middle scenes visually active.
            if index not in (0, len(scenes) - 1):
                for card in range(3):
                    y = 1190 + card * 135
                    filters.extend([
                        f"drawbox=x='{90 + card * 18}+55*(1-{fade})':y={y}:w={900 - card * 36}:h=104:"
                        f"color=white@{0.075 + card * 0.015}:t=fill:enable='between(t,{start},{end})'",
                        f"drawbox=x='{112 + card * 18}+55*(1-{fade})':y={y + 28}:w=48:h=48:"
                        f"color=0x{accent}@{0.85 - card * 0.14}:t=fill:enable='between(t,{start},{end})'",
                    ])
        # Final CTA gains a dedicated animated button.
        final_start = (len(scenes) - 1) * scene_time
        filters.extend([
            f"drawbox=x='110+12*sin(t*3)':y=1280:w=860:h=118:color=0x{accent}@0.98:t=fill:"
            f"enable='gte(t,{final_start})'",
            f"drawtext=fontfile={font_bold}:text='TAKE THE NEXT STEP  →':fontcolor=white:fontsize=34:"
            f"x=(w-text_w)/2:y=1320:enable='gte(t,{final_start})'",
            "vignette=PI/5[outv]"
        ])
        filter_graph = ",".join(filters)
        music = (
            f"aevalsrc=0.025*sin(2*PI*110*t)*(0.35+0.65*gt(mod(t\\,0.5)\\,0.40))"
            f"+0.016*sin(2*PI*220*t)+0.010*sin(2*PI*330*t):s=44100:d={duration}"
        )
        cmd = [
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", f"color=c=0x070708:s=1080x1920:r=30:d={duration}",
            "-f", "lavfi", "-i", music,
            "-filter_complex", filter_graph,
            "-map", "[outv]", "-map", "1:a",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "19",
            "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
            "-t", str(duration), str(output_path),
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode:
            raise RuntimeError(result.stderr[-1200:])
        volume.commit()
        base_url = str(payload.get("downloadBase") or "").rstrip("/")
        output_url = f"{base_url}/download/{job_id}"
        body = {
            "jobId": job_id,
            "status": "completed",
            "outputUrl": output_url,
            "signature": signature(secret, f"{job_id}:completed:{output_url}"),
        }
        httpx.post(callback, json=body, timeout=30).raise_for_status()
    except Exception as exc:
        body = {
            "jobId": job_id,
            "status": "failed",
            "outputUrl": "",
            "error": str(exc)[-500:],
            "signature": signature(secret, f"{job_id}:failed:"),
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
    from fastapi import FastAPI, Form, HTTPException
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import FileResponse

    api = FastAPI()
    api.add_middleware(
        CORSMiddleware,
        allow_origins=["https://nitrooutreach.com", "http://localhost:3000"],
        allow_methods=["POST", "GET"],
        allow_headers=["*"],
    )

    @api.post("/render-prompt", status_code=202)
    async def render_prompt(
        jobId: str = Form(...),
        customerId: str = Form(...),
        token: str = Form(...),
        callbackUrl: str = Form(...),
        plan: str = Form(...),
        duration: int = Form(15),
        tone: str = Form("bold"),
        accent: str = Form("#ff6b00"),
        downloadBase: str = Form(...),
    ):
        secret = os.environ["MODAL_SHARED_SECRET"]
        expected = signature(secret, f"{jobId}:{customerId}")
        if not hmac.compare_digest(token, expected):
            raise HTTPException(403, "Invalid render token")
        if len(plan) > 24000 or duration not in (15, 30, 45):
            raise HTTPException(400, "Invalid Reel plan")
        await render_prompt_video.spawn.aio({
            "jobId": jobId,
            "customerId": customerId,
            "callbackUrl": callbackUrl,
            "plan": plan,
            "duration": duration,
            "tone": tone,
            "accent": accent,
            "downloadBase": downloadBase,
        })
        return {"ok": True, "jobId": jobId}

    @api.get("/download/{job_id}")
    async def download(job_id: str):
        volume.reload()
        path = Path("/outputs") / f"{job_id}.mp4"
        if not path.exists():
            raise HTTPException(404, "Video expired or was not found")
        return FileResponse(path, media_type="video/mp4", filename="nitro-ai-reel.mp4")

    return api
