param(
  [string]$InDir = ".tmp\demo-mails",
  [string]$OutDir = "client\public\demo-mails"
)
$ErrorActionPreference = "Stop"
$inputPath = (Resolve-Path -LiteralPath $InDir).Path
$null = New-Item -ItemType Directory -Path $OutDir -Force
$outputPath = (Resolve-Path -LiteralPath $OutDir).Path
$manifest = [IO.File]::ReadAllText((Join-Path $inputPath "manifest.json"), [Text.Encoding]::UTF8) | ConvertFrom-Json
$ol = New-Object -ComObject Outlook.Application
try {
  foreach ($entry in $manifest) {
    $id = $entry.id
    $m = $ol.CreateItem(0)
    try {
      $m.Subject = [IO.File]::ReadAllText((Join-Path $inputPath "$id.subject.txt"), [Text.Encoding]::UTF8)
      $m.BodyFormat = 1
      $m.Body = [IO.File]::ReadAllText((Join-Path $inputPath "$id.body.txt"), [Text.Encoding]::UTF8)
      $m.To = $entry.to
      $pa = $m.PropertyAccessor
      $tag = "http://schemas.microsoft.com/mapi/proptag/"
      $pa.SetProperty($tag + "0x0C1A001F", $entry.from)        # PR_SENDER_NAME
      $pa.SetProperty($tag + "0x0C1F001F", $entry.fromEmail)   # PR_SENDER_EMAIL_ADDRESS
      $pa.SetProperty($tag + "0x5D01001F", $entry.fromEmail)   # PidTagSenderSmtpAddress
      $pa.SetProperty($tag + "0x0042001F", $entry.from)        # PR_SENT_REPRESENTING_NAME
      $pa.SetProperty($tag + "0x0065001F", $entry.fromEmail)   # PR_SENT_REPRESENTING_EMAIL_ADDRESS
      $pa.SetProperty($tag + "0x0E070003", 1)                  # PR_MESSAGE_FLAGS = MSGFLAG_READ(去掉 UNSENT,Outlook 不再显示为草稿)
      $pa.SetProperty($tag + "0x00390040", [DateTime]::UtcNow) # PR_CLIENT_SUBMIT_TIME
      $m.SaveAs((Join-Path $outputPath "$id.msg"), 9) # olMSGUnicode
    } finally {
      [void][Runtime.InteropServices.Marshal]::ReleaseComObject($m)
    }
  }
} finally {
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($ol)
}
