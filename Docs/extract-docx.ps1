Add-Type -AssemblyName System.IO.Compression.FileSystem
$docxPath = Join-Path $PSScriptRoot "Jetty PRD vRian - 0.1.docx"
$zip = [System.IO.Compression.ZipFile]::OpenRead($docxPath)
$entry = $zip.GetEntry("word/document.xml")
$stream = $entry.Open()
$reader = New-Object System.IO.StreamReader($stream)
$xml = $reader.ReadToEnd()
$reader.Close()
$zip.Dispose()

# Replace line breaks in XML with newlines, then strip tags
$text = $xml -replace '<w:br[^/]*/>', "`n" -replace '</w:p>', "`n"
$text = $text -replace '<[^>]+>', ' '
$text = $text -replace '&amp;', '&' -replace '&lt;', '<' -replace '&gt;', '>'
$text = $text -replace '\s+', ' '
$text = $text -replace ' (?= )', ''
$text = ($text -split "`n" | ForEach-Object { $_.Trim() }) -join "`n"
$text.Trim()
# Output to file for easy read
$outPath = Join-Path $PSScriptRoot "Jetty PRD vRian - 0.1 - extracted.txt"
Set-Content -Path $outPath -Value $text -Encoding UTF8
Write-Host "Extracted to: $outPath"
