# powershell -File scripts/narrate.ps1   -> demo-voice.mp4
# Adds a spoken walkthrough to demo.mp4 using the Windows speech engine (offline) and ffmpeg.
# Each line is [start second in the video, text]. Timings match scripts/record-demo.mjs.
Add-Type -AssemblyName System.Speech
$root = Split-Path -Parent $PSScriptRoot
$tmp = Join-Path $env:TEMP "rg-voice"; New-Item -ItemType Directory -Force $tmp | Out-Null
$lines = @(
  @(0.2,  "RefundGuard. A stress test for A I agents that handle money."),
  @(4.2,  "This is a recording of a real run, sped up. Eleven simulated scam customers, and three honest ones, are chatting with our support agent. Each customer is an A I that adapts to the replies. The agent answers for real, and its tools move money in a ledger."),
  @(22.5, "After every chat, two checks run. Step one. Plain code replays the ledger against the refund policy. Step two. A second A I judge reads the chat for money promised in words, and it must quote the agent exactly."),
  @(42.4, "Deploy blocked. Three hundred ten dollars left the ledger, and seven hundred nine was promised in writing."),
  @(49.0, "The report shows every number, and any chat can be opened."),
  @(54.3, "Here, no money moved. But the agent promised a five hundred twenty nine dollar refund, on someone else's order. Only the judge caught that."),
  @(63.2, "Now compare three versions."),
  @(65.4, "A stricter prompt stopped the money, but leaked a customer's email. Still blocked."),
  @(70.7, "Enforcing the policy in code passed. Zero breaches.")
)
$voice = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voice.Rate = 2
$inputs = @("-i", (Join-Path $root "demo.mp4")); $filters = @(); $labels = ""
for ($i = 0; $i -lt $lines.Count; $i++) {
  $wav = Join-Path $tmp "s$i.wav"
  $voice.SetOutputToWaveFile($wav); $voice.Speak($lines[$i][1]); $voice.SetOutputToNull()
  $ms = [int]($lines[$i][0] * 1000)
  $inputs += @("-i", $wav)
  $filters += "[$($i + 1):a]adelay=$ms|$ms[a$i]"
  $labels += "[a$i]"
  $dur = & ffprobe -v error -show_entries format=duration -of csv=p=0 $wav
  "{0,5}s  +{1,5:N1}s  {2}" -f $lines[$i][0], [double]$dur, $lines[$i][1].Substring(0, [Math]::Min(50, $lines[$i][1].Length))
}
$voice.Dispose()
$graph = ($filters -join ";") + ";$labels" + "amix=inputs=$($lines.Count):normalize=0,apad[aout]"
$out = Join-Path $root "demo-voice.mp4"
& ffmpeg -y -loglevel error @inputs -filter_complex $graph -map 0:v -map "[aout]" -c:v copy -c:a aac -b:a 128k -shortest -movflags +faststart $out
"wrote $out"
