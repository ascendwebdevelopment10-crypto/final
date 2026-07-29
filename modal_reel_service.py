"""Nitro Outreach prompt-to-Reel worker."""
import hashlib
import hmac
import json
import os
import base64
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
        .replace("'", "’")
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
        tone = str(payload.get("tone") or "bold")
        font_bold = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
        font_regular = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
        scene_time = duration / len(scenes)

        seed = int(hashlib.sha256(job_id.encode()).hexdigest()[:8], 16)
        rng = random.Random(seed)
        base, ink, accent = palette
        filters = [f"[0:v]format=yuv420p", f"drawbox=x=0:y=0:w=1080:h=1920:color=0x{base}:t=fill"]
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
            visual = str(scene.get("visual") or creative.get("world") or "data_stream")
            layout = (index + rng.randint(0, 5)) % 4
            positions = [
                (76, 1260, 76, 1360, 80, 1640, 68, 28),
                (110, 150, 110, 255, 114, 535, 74, 29),
                (80, 1080, 80, 1185, 84, 1510, 70, 28),
                (170, 190, 170, 305, 174, 620, 66, 28),
            ]
            ex, ey, hx, hy, bx, by, headline_size, body_size = positions[layout]
            enter_x = 110 if layout in (0, 2) else -90
            scene_bg = [base, ink, accent][index % 3]
            text_color = "F7F7F5"
            filters.append(
                f"drawbox=x=0:y=0:w=1080:h=1920:color=0x{scene_bg}:t=fill:enable='between(t,{start},{end})'"
            )
            # AI-directed visual worlds. Each uses procedural geometry and camera-like motion,
            # so the composition is unique even when a world is requested again.
            if visual == "sky_flight":
                for cloud in range(7):
                    cy = 190 + cloud * 190 + rng.randint(-70, 70)
                    filters.append(
                        f"drawbox=x='{-420 + rng.randint(-200, 180)}+mod(t*{150 + rng.randint(0, 170)}\\,1700)':"
                        f"y='{cy}+{25 + rng.randint(0, 55)}*sin(t*{.5 + cloud * .09})':w={240 + rng.randint(0, 260)}:"
                        f"h={55 + rng.randint(0, 80)}:color=white@{.08 + cloud * .018}:t=fill:enable='between(t,{start},{end})'"
                    )
            elif visual == "computer_tunnel":
                for depth in range(7):
                    inset = 70 + depth * 62
                    filters.extend([
                        f"drawbox=x='{inset}-mod(t*{25 + depth * 7}\\,70)':y='{150 + inset}-mod(t*{18 + depth * 5}\\,60)':"
                        f"w={940 - depth * 115}:h={1500 - depth * 165}:color=0x{accent}@{.05 + depth * .025}:t=12:"
                        f"enable='between(t,{start},{end})'",
                        f"drawbox=x={90 + depth * 110}:y='mod(t*{180 + depth * 20}\\,1900)':w=8:h={100 + depth * 18}:"
                        f"color=0x{ink}@.45:t=fill:enable='between(t,{start},{end})'",
                    ])
            elif visual == "desk_person":
                filters.extend([
                    f"drawbox=x=95:y=1010:w=890:h=34:color=0x{accent}@.88:t=fill:enable='between(t,{start},{end})'",
                    f"drawbox=x='380+22*sin(t*1.2)':y=575:w=330:h=250:color=0x{ink}@.92:t=fill:enable='between(t,{start},{end})'",
                    f"drawbox=x='420+18*sin(t*1.2)':y=615:w=250:h=170:color=0x{base}@.82:t=fill:enable='between(t,{start},{end})'",
                    f"drawbox=x='190+10*sin(t*.8)':y=670:w=150:h=150:color=0x{accent}@.82:t=fill:enable='between(t,{start},{end})'",
                    f"drawbox=x='170+14*sin(t*.8)':y=810:w=210:h=270:color=0x{ink}@.72:t=fill:enable='between(t,{start},{end})'",
                    f"drawbox=x=530:y=825:w=38:h=190:color=0x{ink}@.9:t=fill:enable='between(t,{start},{end})'",
                ])
            elif visual in ("city_motion", "storefront"):
                for building in range(9):
                    bw = 90 + rng.randint(0, 110)
                    bh = 280 + rng.randint(0, 620)
                    filters.append(
                        f"drawbox=x='{-300 + building * 180}-mod(t*{45 + rng.randint(0, 80)}\\,260)':y={1050 - bh}:"
                        f"w={bw}:h={bh}:color=0x{[ink, accent, base][building % 3]}@{.35 + (building % 3) * .12}:t=fill:"
                        f"enable='between(t,{start},{end})'"
                    )
            elif visual in ("product_stage", "orbit"):
                for ring in range(6):
                    size = 170 + ring * 105
                    filters.append(
                        f"drawbox=x='{540 - size / 2}+{35 + ring * 5}*sin(t*{.7 + ring * .08})':"
                        f"y='{760 - size / 2}+{28 + ring * 4}*cos(t*{.6 + ring * .07})':w={size}:h={size}:"
                        f"color=0x{[accent, ink, base][ring % 3]}@{.08 + ring * .035}:t={8 + ring * 2}:"
                        f"enable='between(t,{start},{end})'"
                    )
                filters.append(
                    f"drawbox=x='390+18*sin(t*.9)':y='610+16*cos(t*.8)':w=300:h=300:color=0x{accent}@.82:t=fill:"
                    f"enable='between(t,{start},{end})'"
                )
            elif visual in ("interface_world", "data_stream"):
                for panel in range(8):
                    px = 70 + (panel % 2) * 500 + rng.randint(-30, 30)
                    py = 180 + (panel // 2) * 330 + rng.randint(-45, 45)
                    filters.extend([
                        f"drawbox=x='{px}+{30 + panel * 3}*sin(t*{.45 + panel * .05})':y={py}:w={380 + rng.randint(0, 80)}:"
                        f"h={210 + rng.randint(0, 80)}:color=0x{ink}@.30:t=fill:enable='between(t,{start},{end})'",
                        f"drawbox=x='{px + 28}+{30 + panel * 3}*sin(t*{.45 + panel * .05})':y={py + 38}:"
                        f"w={180 + rng.randint(0, 130)}:h=18:color=0x{accent}@.78:t=fill:enable='between(t,{start},{end})'",
                    ])
            else:
                for shape in range(10):
                    filters.append(
                        f"drawbox=x='{rng.randint(-200, 900)}+{rng.randint(20, 100)}*sin(t*{rng.uniform(.4, 2):.2f})':"
                        f"y='{rng.randint(-100, 1700)}+{rng.randint(20, 90)}*cos(t*{rng.uniform(.4, 2):.2f})':"
                        f"w={rng.randint(90, 420)}:h={rng.randint(60, 360)}:color=0x{[base, ink, accent][shape % 3]}@.18:t=fill:"
                        f"enable='between(t,{start},{end})'"
                    )
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
        final_start = (len(scenes) - 1) * scene_time
        filters.extend([
            f"drawbox=x='120+12*sin(t*{rng.uniform(2, 4):.2f})':y=1480:w=840:h=116:color=0x{accent}@0.98:t=fill:"
            f"enable='gte(t,{final_start})'",
            f"drawtext=fontfile={font_bold}:text='LEARN MORE  →':fontcolor=0x{base}:fontsize=34:"
            f"x=(w-text_w)/2:y=1518:enable='gte(t,{final_start})'",
            "vignette=PI/5[outv]"
        ])
        root_note = rng.choice([55.0, 61.7, 65.4, 73.4, 82.4, 98.0, 110.0])
        beat = rng.choice([0.36, 0.42, 0.48, 0.58, 0.68, 0.75])
        music = (
            f"aevalsrc=0.020*sin(2*PI*{root_note}*t)+0.012*sin(2*PI*{root_note * 2}*t)"
            f"+0.020*sin(2*PI*{root_note / 2}*t)*gt(mod(t\\,{beat})\\,{beat * .78}):s=44100:d={duration}"
        )
        voice_path = temp_dir / "voice.mp3"
        voice_data = str(payload.get("voiceover") or "")
        has_voice = bool(voice_data)
        if has_voice:
            voice_path.write_bytes(base64.b64decode(voice_data))
        filter_graph = ",".join(filters)
        cmd = [
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", f"color=c=0x{base}:s=1080x1920:r=30:d={duration}",
            "-f", "lavfi", "-i", music,
        ]
        if has_voice:
            cmd.extend(["-i", str(voice_path)])
            filter_graph += (
                f";[1:a]volume=0.20[bgm];[2:a]volume=1.0,apad,atrim=0:{duration}[voice];"
                "[bgm][voice]amix=inputs=2:duration=longest:dropout_transition=2[outa]"
            )
        cmd.extend([
            "-filter_complex", filter_graph,
            "-map", "[outv]", "-map", "[outa]" if has_voice else "1:a",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "19",
            "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
            "-t", str(duration), str(output_path),
        ])
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
        voiceover: str = Form(""),
        downloadBase: str = Form(...),
    ):
        secret = os.environ["MODAL_SHARED_SECRET"]
        expected = signature(secret, f"{jobId}:{customerId}")
        if not hmac.compare_digest(token, expected):
            raise HTTPException(403, "Invalid render token")
        if len(plan) > 24000 or len(voiceover) > 8_000_000 or duration not in (15, 30, 45):
            raise HTTPException(400, "Invalid Reel plan")
        await render_prompt_video.spawn.aio({
            "jobId": jobId,
            "customerId": customerId,
            "callbackUrl": callbackUrl,
            "plan": plan,
            "duration": duration,
            "tone": tone,
            "creative": creative,
            "voiceover": voiceover,
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
