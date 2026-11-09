
from pathlib import Path
from uuid import uuid4
import subprocess
import threading

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="AI Audio Studio Backend")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:1420",
        "tauri://localhost",
        "http://tauri.localhost",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = Path(__file__).parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

ALLOWED_EXTENSIONS = {".wav", ".mp3", ".flac", ".ogg", ".m4a"}
MAX_FILE_SIZE = 100 * 1024 * 1024  # 100 MB
SEPARATED_DIR = Path(__file__).parent / "separated"
SEPARATED_DIR.mkdir(exist_ok=True)

separation_lock = threading.Lock()
separation_jobs = {}


@app.get("/")
def home():
    return {
        "message": "AI Audio Studio backend is running!"
    }


@app.get("/health")
def health():
    return {
        "status": "healthy",
        "service": "AI Audio Studio"
    }


@app.post("/upload-audio")
async def upload_audio(file: UploadFile = File(...)):
    extension = Path(file.filename or "").suffix.lower()

    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail="Unsupported audio format."
        )

    stored_name = f"{uuid4().hex}{extension}"
    destination = UPLOAD_DIR / stored_name
    total_size = 0

    try:
        with destination.open("wb") as output:
            while True:
                chunk = await file.read(1024 * 1024)

                if not chunk:
                    break

                total_size += len(chunk)

                if total_size > MAX_FILE_SIZE:
                    raise HTTPException(
                        status_code=413,
                        detail="Audio file exceeds the 100 MB limit."
                    )

                output.write(chunk)

    except Exception:
        destination.unlink(missing_ok=True)
        raise

    finally:
        await file.close()

    return {
        "message": "Audio uploaded successfully!",
        "original_filename": file.filename,
        "stored_filename": stored_name,
        "size_bytes": total_size
    }

@app.post("/separate/{stored_filename}")
def separate_audio(stored_filename: str):
    # Only accept files previously uploaded to our uploads folder.
    input_path = UPLOAD_DIR / stored_filename

    if not input_path.is_file() or input_path.suffix.lower() not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=404,
            detail="Uploaded audio file not found."
        )

    # Do not allow two separation jobs at once.
    if not separation_lock.acquire(blocking=False):
        raise HTTPException(
            status_code=409,
            detail="Another separation job is already running."
        )

    job_id = uuid4().hex

    separation_jobs[job_id] = {
        "status": "processing",
        "filename": stored_filename,
    }

    try:
        output_path = SEPARATED_DIR / job_id

        result = subprocess.run(
            [
                "demucs",
                "-n", "htdemucs",
                "-d", "cpu",
                "--shifts", "1",
                "-j", "1",
                "-o", str(output_path),
                str(input_path),
            ],
            capture_output=True,
            text=True,
            timeout=1800,
        )

        if result.returncode != 0:
            raise RuntimeError(result.stderr[-3000:])

        stem_folder = output_path / "htdemucs" / input_path.stem

        stems = {
            name: f"/stems/{job_id}/{name}.wav"
            for name in ["vocals", "drums", "bass", "other"]
        }

        if not all((stem_folder / f"{name}.wav").is_file() for name in stems):
            raise RuntimeError("Demucs did not produce all four stems.")

        separation_jobs[job_id]["status"] = "completed"
        separation_jobs[job_id]["stems"] = stems

        return {
            "job_id": job_id,
            "status": "completed",
            "stems": stems,
        }

    except subprocess.TimeoutExpired:
        separation_jobs[job_id]["status"] = "failed"
        separation_jobs[job_id]["error"] = "Separation timed out."
        raise HTTPException(status_code=504, detail="Separation timed out.")

    except Exception as error:
        separation_jobs[job_id]["status"] = "failed"
        separation_jobs[job_id]["error"] = str(error)
        raise HTTPException(status_code=500, detail=str(error))

    finally:
        separation_lock.release()

@app.get("/stems/{job_id}/{stem_name}.wav")
def get_stem(job_id: str, stem_name: str):
    if stem_name not in {"vocals", "drums", "bass", "other"}:
        raise HTTPException(status_code=404, detail="Stem not found.")

    job = separation_jobs.get(job_id)

    if not job or job["status"] != "completed":
        raise HTTPException(status_code=404, detail="Separation job not found.")

    original_filename = Path(job["filename"]).stem

    stem_path = (
        SEPARATED_DIR
        / job_id
        / "htdemucs"
        / original_filename
        / f"{stem_name}.wav"
    )

    if not stem_path.is_file():
        raise HTTPException(status_code=404, detail="Stem file not found.")

    return FileResponse(
        stem_path,
        media_type="audio/wav",
        filename=f"{stem_name}.wav",
    )