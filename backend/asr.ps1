# Windows Speech Recognition - accepts WAV file, outputs text
param([string]$WavFile)

Add-Type -AssemblyName System.Speech
$recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine
$grammar = New-Object System.Speech.Recognition.DictationGrammar
$recognizer.LoadGrammar($grammar)
$recognizer.SetInputToWaveFile($WavFile)
try {
    $result = $recognizer.Recognize()
    if ($result) { Write-Output $result.Text }
    else { Write-Output "" }
} catch {
    Write-Output ""
} finally {
    $recognizer.Dispose()
}
