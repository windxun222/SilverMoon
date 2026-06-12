param([string]$Text, [string]$OutFile, [string]$Voice = "Microsoft Huihui Desktop", [double]$Rate = 1.0)

Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer

# Select voice
try {
    $synth.SelectVoice($Voice)
} catch {
    Write-Warning "Voice '$Voice' not found, using default"
}

# Configure
$synth.Rate = [int]($Rate * 10 - 10)  # -10 to 10 scale
$synth.Volume = 100

$synth.SetOutputToWaveFile($OutFile)
$synth.Speak($Text)
$synth.Dispose()
