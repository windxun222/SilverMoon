# Windows Speech Recognition - outputs UTF-8 text
param([string]$WavFile)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Speech
$recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine
$grammar = New-Object System.Speech.Recognition.DictationGrammar
$recognizer.LoadGrammar($grammar)
$recognizer.SetInputToWaveFile($WavFile)
try {
    $result = $recognizer.Recognize()
    if ($result) { [Console]::Write($result.Text) }
} catch { } finally { $recognizer.Dispose() }
