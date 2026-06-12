# TTS helper using Windows built-in SpeechSynthesizer
param([string]$Text, [string]$OutFile)

Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SetOutputToWaveFile($OutFile)
$synth.Speak($Text)
$synth.Dispose()
