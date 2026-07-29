"""Nitro Outreach prompt-to-Reel worker."""
import hashlib
import hmac
import json
import os
import shutil
import subprocess
import tempfile
import textwrap
import random
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
        creative = json.loads(payload.get("creative") or "{}")
        palette = [safe_color(value) for value in list(creative.get("palette") or [])[:3]]
        if len(palette) < 3:
            palette = ["F4EDE1", "17233B", "E95D45"]
        style = str(creative.get("id") or "editorial")
        tone = str(payload.get("tone") or "bold")
        font_bold = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
        font_regular = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
        scene_time = duration / len(scenes)

        seed = int(hashlib.sha256(job_id.encode()).hexdigest()[:8], 16)
        rng = random.Random(seed)
        base, ink, accent = palette
        style_number = ["editorial", "kinetic", "future", "minimal", "sunset", "collage"].index(style) if style in ["editorial", "kinetic", "future", "minimal", "sunset", "collage"] else 0
        filters = [f"[0:v]format=yuv420p"]
        ambience = {
            "editorial": [
                f"drawbox=x=0:y=0:w=1080:h=1920:color=0x{base}:t=fill",
                f"drawbox=x=70:y=120:w=8:h=1680:color=0x{accent}:t=fill",
                f"drawbox=x='760+35*sin(t*.7)':y=70:w=250:h=250:color=0x{ink}@0.08:t=fill",
            ],
            "kinetic": [
                f"drawbox=x=0:y=0:w=1080:h=1920:color=0x{base}:t=fill",
                f"drawbox=x='-500+mod(t*420\\,1900)':y=0:w=420:h=1920:color=0x{accent}@0.16:t=fill",
                f"drawgrid=w=90:h=90:t=2:c=0x{accent}@0.08",
            ],
            "future": [
                f"drawbox=x=0:y=0:w=1080:h=1920:color=0x{base}:t=fill",
                f"drawbox=x='-180+80*sin(t*.8)':y='1250+90*cos(t*.6)':w=720:h=720:color=0x{accent}@0.16:t=fill",
                f"drawbox=x='720+60*cos(t*.5)':y='-160+80*sin(t*.7)':w=520:h=520:color=0x{ink}@0.18:t=fill",
            ],
            "minimal": [
                f"drawbox=x=0:y=0:w=1080:h=1920:color=0x{base}:t=fill",
                f"drawbox=x=0:y='1500+55*sin(t)':w=1080:h=420:color=0x{ink}:t=fill",
                f"drawbox=x=80:y=110:w=180:h=18:color=0x{accent}:t=fill",
            ],
            "sunset": [
                f"drawbox=x=0:y=0:w=1080:h=1920:color=0x{base}:t=fill",
                f"drawbox=x='-260+100*sin(t*.5)':y=1060:w=880:h=880:color=0x{accent}@0.30:t=fill",
                f"drawbox=x='650+80*cos(t*.6)':y=-130:w=600:h=600:color=0x{ink}@0.25:t=fill",
            ],
            "collage": [
                f"drawbox=x=0:y=0:w=1080:h=1920:color=0x{base}:t=fill",
                f"drawbox=x='-40+18*sin(t*2)':y=220:w=560:h=330:color=0x{ink}@0.20:t=fill",
                f"drawbox=x='610+22*cos(t*1.7)':y=1260:w=520:h=410:color=0x{accent}@0.24:t=fill",
            ],
        }
        filters.extend(ambience.get(style, ambience["editorial"]))
        filters.extend([
            f"drawbox=x=70:y=1818:w=940:h=5:color=0x{ink}@0.18:t=fill",
            f"drawbox=x=70:y=1818:w='940*t/{duration}':h=5:color=0x{accent}:t=fill",
        ])
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
            layout = (style_number + index + rng.randint(0, 2)) % 4
            positions = [
                (86, 430, 86, 560, 86, 900, 76, 31),
                (110, 270, 110, 390, 114, 800, 88, 32),
                (86, 960, 86, 1080, 90, 1400, 72, 30),
                (190, 520, 190, 650, 194, 1040, 68, 29),
            ]
            ex, ey, hx, hy, bx, by, headline_size, body_size = positions[layout]
            enter_x = 110 if layout in (0, 2) else -90
            text_color = ink if style in ("editorial", "minimal", "collage") else "F7F7F5"
            if style == "minimal" and layout == 2:
                text_color = base
            filters.extend([
                f"drawtext=fontfile={font_bold}:text='{count}':fontcolor=0x{accent}@0.34:"
                f"fontsize={170 + 22 * layout}:x={760 if layout != 1 else 80}:y={120 if layout != 2 else 720}:"
                f"alpha='{fade}':enable='between(t,{start},{end})'",
                f"drawbox=x='{ex}+{enter_x}*(1-{fade})':y={ey}:w={180 + layout * 24}:h=52:"
                f"color=0x{accent}@0.96:t=fill:enable='between(t,{start},{end})'",
                f"drawtext=fontfile={font_bold}:text='{eyebrow}':fontcolor=0x{base}:fontsize=20:"
                f"x='{ex + 18}+{enter_x}*(1-{fade})':y={ey + 15}:alpha='{fade}':enable='between(t,{start},{end})'",
                f"drawtext=fontfile={font_bold}:text='{headline}':fontcolor=0x{text_color}:fontsize={headline_size}:"
                f"line_spacing=16:x='{hx}+{enter_x}*(1-{fade})':y={hy}:alpha='{fade}':"
                f"enable='between(t,{start},{end})'",
                f"drawtext=fontfile={font_regular}:text='{body}':fontcolor=0x{text_color}@0.76:fontsize={body_size}:"
                f"line_spacing=11:x='{bx}+{enter_x * .55}*(1-{fade})':y={by}:alpha='{fade}':"
                f"enable='between(t,{start},{end})'",
            ])
            if style in ("kinetic", "collage") and index not in (0, len(scenes) - 1):
                filters.append(
                    f"drawbox=x='{100 + rng.randint(0, 180)}+35*sin(t*4)':y={1280 + rng.randint(-120, 170)}:"
                    f"w={650 + rng.randint(0, 180)}:h={90 + rng.randint(0, 55)}:color=0x{accent}@0.30:t=fill:"
                    f"enable='between(t,{start},{end})'"
                )
        # CTA treatment also follows the selected creative family.
        final_start = (len(scenes) - 1) * scene_time
        filters.extend([
            f"drawbox=x='{110 + style_number * 8}+{8 + style_number * 2}*sin(t*{2.2 + style_number * .3})':"
            f"y={1280 + (style_number % 3) * 70}:w={860 - style_number * 16}:h={112 + (style_number % 2) * 20}:color=0x{accent}@0.98:t=fill:"
            f"enable='gte(t,{final_start})'",
            f"drawtext=fontfile={font_bold}:text='LEARN MORE  →':fontcolor=0x{base}:fontsize=34:"
            f"x=(w-text_w)/2:y={1318 + (style_number % 3) * 70}:enable='gte(t,{final_start})'",
            f"{'vignette=PI/5' if style in ('future', 'sunset') else 'null'}[outv]"
        ])
        filter_graph = ",".join(filters)
        music_variants = {
            "editorial": f"aevalsrc=0.016*sin(2*PI*82.4*t)+0.012*sin(2*PI*164.8*t)*(0.5+0.5*cos(2*PI*.25*t)):s=44100:d={duration}",
            "kinetic": f"aevalsrc=0.032*sin(2*PI*55*t)*gt(mod(t\\,.42)\\,.32)+0.018*sin(2*PI*220*t)*gt(mod(t\\,.21)\\,.18):s=44100:d={duration}",
            "future": f"aevalsrc=0.014*sin(2*PI*110*t)+0.012*sin(2*PI*277.2*t)*(0.5+0.5*sin(2*PI*.4*t)):s=44100:d={duration}",
            "minimal": f"aevalsrc=0.022*sin(2*PI*73.4*t)*gt(mod(t\\,.75)\\,.66)+0.009*sin(2*PI*146.8*t):s=44100:d={duration}",
            "sunset": f"aevalsrc=0.018*sin(2*PI*98*t)+0.014*sin(2*PI*196*t)+0.010*sin(2*PI*293.7*t)*(0.6+0.4*sin(2*PI*.5*t)):s=44100:d={duration}",
            "collage": f"aevalsrc=0.026*sin(2*PI*65.4*t)*gt(mod(t\\,.58)\\,.46)+0.014*sin(2*PI*392*t)*gt(mod(t\\,.29)\\,.25):s=44100:d={duration}",
        }
        music = music_variants.get(style, music_variants["editorial"])
        cmd = [
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", f"color=c=0x{base}:s=1080x1920:r=30:d={duration}",
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
        print(f"Prompt Reel render failed for {job_id}: {exc}", flush=True)
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
        creative: str = Form("{}"),
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
            "creative": creative,
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
