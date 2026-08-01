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
import math
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


def media_duration(path: Path) -> float:
    result = subprocess.run(
        [
            "ffprobe", "-v", "error", "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1", str(path),
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode:
        raise RuntimeError(f"Could not measure narration duration: {result.stderr[-400:]}")
    duration = float(result.stdout.strip())
    if not math.isfinite(duration) or duration <= 0:
        raise RuntimeError("Narration duration was invalid")
    return duration


def inspect_output(path: Path, minimum_duration: float, require_voice: bool) -> dict:
    result = subprocess.run(
        [
            "ffprobe", "-v", "error", "-show_streams", "-show_format",
            "-of", "json", str(path),
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode:
        raise RuntimeError(f"Could not inspect finished Reel: {result.stderr[-400:]}")
    probe = json.loads(result.stdout or "{}")
    streams = list(probe.get("streams") or [])
    video = next((stream for stream in streams if stream.get("codec_type") == "video"), {})
    audio = next((stream for stream in streams if stream.get("codec_type") == "audio"), {})
    actual_duration = float((probe.get("format") or {}).get("duration") or 0)
    size_bytes = int((probe.get("format") or {}).get("size") or path.stat().st_size)
    checks = {
        "portrait1080x1920": int(video.get("width") or 0) == 1080 and int(video.get("height") or 0) == 1920,
        "durationComplete": actual_duration >= minimum_duration - 0.35,
        "videoPresent": bool(video),
        "audioPresent": bool(audio),
        "fileHealthy": size_bytes >= 250_000,
        "voiceAllowedToFinish": (not require_voice) or actual_duration >= minimum_duration - 0.35,
    }
    return {
        "passed": all(checks.values()),
        "checks": checks,
        "duration": round(actual_duration, 2),
        "sizeBytes": size_bytes,
    }


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
        requested_duration = max(15, min(45, int(payload.get("duration") or 15)))
        duration = float(requested_duration)
        voice_path = temp_dir / "voice.mp3"
        voice_data = str(payload.get("voiceover") or "")
        has_voice = bool(voice_data)
        voice_duration = 0.0
        if has_voice:
            voice_path.write_bytes(base64.b64decode(voice_data))
            voice_duration = media_duration(voice_path)
            # The narration starts after a short visual lead-in and always gets a clean
            # breath plus music tail after its final word. Most scripts fit the selected
            # length; this only extends the timeline when speech would otherwise be cut.
            minimum_timeline = voice_duration + 1.35
            duration = max(duration, math.ceil(minimum_timeline * 10) / 10)
        creative = json.loads(payload.get("creative") or "{}")
        palette = [safe_color(value) for value in list(creative.get("palette") or [])[:3]]
        if len(palette) < 3:
            palette = ["F4EDE1", "17233B", "E95D45"]
        scene_art = json.loads(payload.get("sceneArt") or "[]")
        art_paths = []
        for art_index, art_data in enumerate(list(scene_art)[:len(scenes)]):
            if not art_data:
                continue
            art_path = temp_dir / f"scene-{art_index}.jpg"
            art_path.write_bytes(base64.b64decode(str(art_data)))
            art_paths.append((art_index, art_path))
        font_bold = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
        scene_time = duration / len(scenes)

        seed = int(hashlib.sha256(job_id.encode()).hexdigest()[:8], 16)
        rng = random.Random(seed)
        base, ink, accent = palette
        art_filters = []
        if art_paths:
            # Every visual overlaps the next one with a long dissolve. This produces one
            # moving timeline instead of a stack of independent scene cards.
            art_filters.append("[0:v]format=rgba[flow0]")
            overlap = min(1.45, max(0.9, scene_time * 0.32))
            for chain_index, (scene_index, art_path) in enumerate(art_paths):
                input_index = 1 + chain_index
                anchor_start = scene_index * scene_time
                anchor_end = duration if scene_index == len(scenes) - 1 else (scene_index + 1) * scene_time
                start = 0 if scene_index == 0 else max(0, anchor_start - overlap)
                end = duration if scene_index == len(scenes) - 1 else min(duration, anchor_end + overlap)
                camera = str(scenes[scene_index].get("camera") or "").lower()
                motion_span = max(scene_time + overlap * 2, 1)
                motion = scene_index % 5
                if any(word in camera for word in ("left", "pan", "whip")) or motion == 1:
                    crop_x = f"(iw-ow)*(1-min(t/{motion_span:.3f},1))"
                    crop_y = f"(ih-oh)/2+22*sin(t*.72)"
                elif any(word in camera for word in ("crane", "up", "dive")) or motion == 2:
                    crop_x = f"(iw-ow)/2+20*sin(t*.58)"
                    crop_y = f"(ih-oh)*min(t/{motion_span:.3f},1)"
                elif any(word in camera for word in ("backward", "pull")) or motion == 3:
                    crop_x = f"(iw-ow)*min(t/{motion_span:.3f},1)"
                    crop_y = f"(ih-oh)*(1-min(t/{motion_span:.3f},1))"
                elif any(word in camera for word in ("orbit", "float")) or motion == 4:
                    crop_x = f"(iw-ow)/2+(iw-ow)*.36*sin(t*.72)"
                    crop_y = f"(ih-oh)/2+(ih-oh)*.34*cos(t*.61)"
                else:
                    crop_x = f"(iw-ow)/2+30*sin(t*.48)"
                    crop_y = f"(ih-oh)/2+26*cos(t*.41)"
                fade_in = 0.01 if scene_index == 0 else overlap * 1.55
                fade_out_start = duration if scene_index == len(scenes) - 1 else max(start, end - overlap * 1.55)
                fade_out = 0.01 if scene_index == len(scenes) - 1 else overlap * 1.55
                art_filters.extend([
                    f"[{input_index}:v]scale=1450:2200,crop=1080:1920:"
                    f"x='{crop_x}':y='{crop_y}',eq=saturation=1.06:contrast=1.035,"
                    f"fade=t=in:st={start}:d={fade_in:.3f}:alpha=1,"
                    f"fade=t=out:st={fade_out_start:.3f}:d={fade_out:.3f}:alpha=1,"
                    f"format=rgba[art{chain_index}]",
                    f"[flow{chain_index}][art{chain_index}]overlay=0:0:"
                    f"enable='between(t,{start:.3f},{end:.3f})'[flow{chain_index + 1}]",
                ])
            video_source = f"[flow{len(art_paths)}]"
        else:
            video_source = "[0:v]"

        # Text is intentionally sparse: one opening hook and one closing CTA over the
        # moving footage. There are no per-beat labels, bodies, panels, or progress bars.
        hook = escape_text(wrapped(scenes[0].get("headline"), 24, 2))
        cta = escape_text(wrapped(scenes[-1].get("headline"), 24, 2))
        hook_end = min(3.25, duration * 0.24)
        cta_start = max(hook_end + 1, duration - 3.0)
        hook_alpha = (
            f"if(lt(t\\,0.7)\\,(t-0.3)/0.4\\,"
            f"if(gt(t\\,{hook_end - .45:.3f})\\,({hook_end:.3f}-t)/0.45\\,1))"
        )
        cta_alpha = (
            f"if(lt(t\\,{cta_start + .45:.3f})\\,(t-{cta_start:.3f})/0.45\\,"
            f"if(gt(t\\,{duration - .25:.3f})\\,({duration:.3f}-t)/0.25\\,1))"
        )
        filters = [
            f"{video_source}format=yuv420p",
            "drawbox=x=0:y=0:w=1080:h=1920:color=black@0.10:t=fill",
        ]
        if not art_paths:
            filters.extend([
                f"drawbox=x='-280+mod(t*95\\,1500)':y='180+90*sin(t*.55)':w=720:h=720:color=0x{accent}@.16:t=fill",
                f"drawbox=x='760-mod(t*72\\,1500)':y='980+120*cos(t*.42)':w=640:h=640:color=0x{ink}@.24:t=fill",
            ])
        filters.extend([
            f"drawtext=fontfile={font_bold}:text='{hook}':fontcolor=white:fontsize=72:"
            f"line_spacing=15:x=76:y=270:shadowcolor=black@0.58:shadowx=4:shadowy=5:"
            f"alpha='{hook_alpha}':enable='between(t,0.3,{hook_end:.3f})'",
            f"drawtext=fontfile={font_bold}:text='{cta}':fontcolor=white:fontsize=66:"
            f"line_spacing=14:x=(w-text_w)/2:y=1480:shadowcolor=black@0.62:shadowx=4:shadowy=5:"
            f"alpha='{cta_alpha}':enable='between(t,{cta_start:.3f},{duration})'",
            "vignette=PI/6[outv]",
        ])
        root_note = rng.choice([55.0, 61.7, 65.4, 73.4, 82.4, 98.0, 110.0])
        beat = rng.choice([0.36, 0.42, 0.48, 0.58, 0.68, 0.75])
        music = (
            f"aevalsrc=0.020*sin(2*PI*{root_note}*t)+0.012*sin(2*PI*{root_note * 2}*t)"
            f"+0.020*sin(2*PI*{root_note / 2}*t)*gt(mod(t\\,{beat})\\,{beat * .78}):s=44100:d={duration}"
        )
        filter_graph = ";".join(art_filters + [",".join(filters)])
        cmd = [
            "ffmpeg", "-y",
            "-f", "lavfi", "-i", f"color=c=0x{base}:s=1080x1920:r=30:d={duration}",
        ]
        for _, art_path in art_paths:
            cmd.extend(["-loop", "1", "-framerate", "30", "-i", str(art_path)])
        music_input = 1 + len(art_paths)
        cmd.extend(["-f", "lavfi", "-i", music])
        ambient_input = music_input + 1
        ambient = f"anoisesrc=color=pink:amplitude=0.025:r=44100:d={duration}"
        cmd.extend(["-f", "lavfi", "-i", ambient])
        fade_start = max(0.0, duration - 0.75)
        if has_voice:
            cmd.extend(["-i", str(voice_path)])
            voice_input = ambient_input + 1
            filter_graph += (
                f";[{music_input}:a]volume=0.15[bgm];"
                f"[{ambient_input}:a]highpass=f=110,lowpass=f=5200,volume=0.045[amb];"
                f"[{voice_input}:a]volume=1.0,adelay=450|450[voice];"
                f"[bgm][amb][voice]amix=inputs=3:duration=longest:dropout_transition=1.5:"
                f"normalize=0,atrim=0:{duration},afade=t=out:st={fade_start}:d=0.75[outa]"
            )
        else:
            filter_graph += (
                f";[{music_input}:a]volume=0.18[bgm];"
                f"[{ambient_input}:a]highpass=f=110,lowpass=f=5200,volume=0.05[amb];"
                f"[bgm][amb]amix=inputs=2:duration=longest:normalize=0,"
                f"atrim=0:{duration},afade=t=out:st={fade_start}:d=0.75[outa]"
            )
        cmd.extend([
            "-filter_complex", filter_graph,
            "-map", "[outv]", "-map", "[outa]",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "19",
            "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
            "-t", str(duration), str(output_path),
        ])
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode:
            raise RuntimeError(result.stderr[-1200:])
        quality = inspect_output(output_path, duration, has_voice)
        if not quality["passed"]:
            raise RuntimeError(f"Finished Reel failed quality checks: {json.dumps(quality['checks'])}")
        volume.commit()
        base_url = str(payload.get("downloadBase") or "").rstrip("/")
        output_url = f"{base_url}/download/{job_id}"
        body = {
            "jobId": job_id,
            "status": "completed",
            "outputUrl": output_url,
            "actualDuration": round(duration, 2),
            "qualityPassed": True,
            "quality": quality,
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
        sceneArt: str = Form("[]"),
        downloadBase: str = Form(...),
    ):
        secret = os.environ["MODAL_SHARED_SECRET"]
        expected = signature(secret, f"{jobId}:{customerId}")
        if not hmac.compare_digest(token, expected):
            raise HTTPException(403, "Invalid render token")
        if (
            len(plan) > 24000
            or len(voiceover) > 8_000_000
            or len(sceneArt) > 16_000_000
            or duration not in (15, 30, 45)
        ):
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
            "sceneArt": sceneArt,
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
