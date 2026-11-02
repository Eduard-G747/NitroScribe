# Generates two-voice TTS clips used by the transcription integration test.
param([string]$OutDir = (Join-Path $PSScriptRoot '..\test\fixtures'))
Add-Type -AssemblyName System.Speech
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$OutDir = (Resolve-Path $OutDir).Path
$lines = @(
  @{ name = 'me1';   voice = 'Microsoft David Desktop'; text = 'Hi Sarah, thanks for making time today. I wanted to go over the launch plan for the new pricing page.' },
  @{ name = 'them1'; voice = 'Microsoft Zira Desktop';  text = 'Of course. I reviewed the draft yesterday, and I think the enterprise tier needs clearer messaging.' },
  @{ name = 'me2';   voice = 'Microsoft David Desktop'; text = 'That makes sense. What do you think about moving the launch to the second week of November?' },
  @{ name = 'them2'; voice = 'Microsoft Zira Desktop';  text = 'I think that works, as long as legal signs off on the new terms of service before then.' },
  @{ name = 'me3';   voice = 'Microsoft David Desktop'; text = 'Perfect. I will send the updated timeline to the team by Thursday.' },
  @{ name = 'them3'; voice = 'Microsoft Zira Desktop';  text = 'Great, and I will follow up with legal tomorrow morning.' }
)
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
foreach ($l in $lines) {
  $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $s.SelectVoice($l.voice)
  $s.SetOutputToWaveFile((Join-Path $OutDir "$($l.name).wav"), $fmt)
  $s.Speak($l.text)
  $s.Dispose()
}
Get-ChildItem $OutDir | Select-Object Name, Length
