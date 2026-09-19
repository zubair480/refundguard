# python scripts/narrate_neural.py   -> demo.mp4 gets a natural-sounding voice-over
# Uses Microsoft Edge's free neural voices (pip install edge-tts) and ffmpeg. Needs internet.
# demo-silent.mp4 is the picture; each line is (start second, text). Timings match scripts/record-demo.mjs.
import asyncio, subprocess, sys, tempfile
from pathlib import Path
import edge_tts

ROOT = Path(__file__).resolve().parent.parent
VOICE, RATE = "en-US-AndrewNeural", "+8%"
LINES = [
    (0.2, "RefundGuard. A stress test for AI agents that handle money."),
    (4.2, "This is a recording of a real run, sped up. Eleven simulated scam customers, and three honest ones, are chatting with our support agent. Each customer is an AI that adapts to the replies. The agent answers for real, and its tools move money in a ledger."),
    (22.5, "After every chat, two checks run. Step one: plain code replays the ledger against the refund policy. Step two: a second AI judge reads the chat for money promised in words, and it must quote the agent exactly."),
    (42.4, "Deploy blocked. Three hundred ten dollars left the ledger, and seven hundred nine was promised in writing."),
    (49.0, "The report shows every number, and any chat can be opened."),
    (54.3, "Here, no money moved. But the agent promised a five hundred twenty nine dollar refund, on someone else's order. Only the judge caught that."),
    (63.2, "Now compare three versions."),
    (65.4, "A stricter prompt stopped the money, but leaked a customer's email. Still blocked."),
    (70.7, "Enforcing the policy in code passed. Zero breaches."),
]

def duration(p):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(p)]).decode().strip())

async def main():
    video = ROOT / "demo-silent.mp4"
    if not video.exists():
        sys.exit("demo-silent.mp4 not found")
    tmp = Path(tempfile.mkdtemp(prefix="rg-voice-"))
    files = [tmp / f"s{i}.mp3" for i in range(len(LINES))]
    await asyncio.gather(*[edge_tts.Communicate(text, VOICE, rate=RATE).save(str(f)) for (_, text), f in zip(LINES, files)])
    total = duration(video)
    for i, ((start, text), f) in enumerate(zip(LINES, files)):
        end = start + duration(f)
        limit = LINES[i + 1][0] if i + 1 < len(LINES) else total
        print(f"{start:5.1f}s -> {end:5.1f}s {'OVERLAP' if end > limit else 'ok':8} {text[:48]}")
    inputs, filters, labels = ["-i", str(video)], [], ""
    for i, ((start, _), f) in enumerate(zip(LINES, files)):
        ms = int(start * 1000)
        inputs += ["-i", str(f)]
        filters.append(f"[{i + 1}:a]adelay={ms}|{ms}[a{i}]")
        labels += f"[a{i}]"
    graph = ";".join(filters) + f";{labels}amix=inputs={len(LINES)}:normalize=0,apad[aout]"
    out = ROOT / "demo.mp4"
    subprocess.check_call(["ffmpeg", "-y", "-loglevel", "error", *inputs, "-filter_complex", graph, "-map", "0:v", "-map", "[aout]",
                           "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart", str(out)])
    print("wrote", out)

asyncio.run(main())
