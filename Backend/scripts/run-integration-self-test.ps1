# Integration API self-test - live output + temp report
$ErrorActionPreference = "Continue"
$API_KEY = $env:JPS_INTEGRATION_API_KEY
if (-not $API_KEY) { Write-Error "Set JPS_INTEGRATION_API_KEY"; exit 1 }

$BASE = "http://localhost:3000/api/v1/integrations"
$TS = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
$REF = "SI-SELFTEST-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
$TMP = Join-Path $env:TEMP "jps-integration-selftest"
New-Item -ItemType Directory -Force -Path $TMP | Out-Null

$reportPath = Join-Path $PSScriptRoot "..\tmp-integration-self-test-report.md"
$results = @()

function Test-Step {
    param([string]$Id, [string]$Name, [scriptblock]$Action)
    Write-Host ""
    Write-Host "[$Id] $Name" -ForegroundColor Cyan
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $out = & $Action
        $sw.Stop()
        $pass = $true
        $detail = $out
        Write-Host $out
        Write-Host "  -> PASS ($([math]::Round($sw.Elapsed.TotalSeconds,2))s)" -ForegroundColor Green
    } catch {
        $sw.Stop()
        $pass = $false
        $detail = $_.Exception.Message
        Write-Host "  -> FAIL: $detail" -ForegroundColor Red
    }
    $script:results += [PSCustomObject]@{ Id=$Id; Name=$Name; Pass=$pass; Detail=$detail; Ms=$sw.ElapsedMilliseconds }
    return $pass
}

Write-Host "=== JPS Integration API Self-Test ===" -ForegroundColor Yellow
Write-Host "Time: $TS"
Write-Host "Base: $BASE"
Write-Host "Partner ref: $REF"

# Resolve a master vessel with hub_code + complete dimensions for submit tests
$masterJson = docker exec jps-api node -e "import('pg').then(async ({default:pg})=>{const p=new pg.Pool({connectionString:process.env.DATABASE_URL});const r=await p.query('SELECT hub_code,vessel_name FROM master_vessels WHERE deleted_at IS NULL AND hub_code IS NOT NULL AND vessel_length_overall IS NOT NULL AND vessel_gross_tonnage IS NOT NULL AND vessel_draft IS NOT NULL ORDER BY id LIMIT 1');console.log(JSON.stringify(r.rows[0]||null));await p.end();})"
if (-not $masterJson -or $masterJson -eq "null") {
    Write-Error "No master vessel with hub_code found in DB - sync Master Vessel data first"
    exit 1
}
$masterVessel = $masterJson | ConvertFrom-Json
$TEST_HUB_CODE = $masterVessel.hub_code
$TEST_VESSEL_NAME = $masterVessel.vessel_name
Write-Host "Master vessel: hub_code=$TEST_HUB_CODE name=$TEST_VESSEL_NAME"

# Payload files
@'
{"name":"PT Self Test Shipper","long_name":"PT Self Test Shipper Long Name"}
'@ | Set-Content (Join-Path $TMP "shipper.json") -Encoding UTF8

@'
{"name":"PT Self Test Agent","long_name":"PT Self Test Agent Long"}
'@ | Set-Content (Join-Path $TMP "agent.json") -Encoding UTF8

$siJson = @"
{
  "external_reference": "$REF",
  "port_id": 1,
  "vessel_hub_code": "$TEST_HUB_CODE",
  "voyage_no": "VY-SELF-001",
  "purpose": "Loading",
  "eta": "2026-08-01T08:00:00Z",
  "etd": "2026-08-03T18:00:00Z",
  "agent_name": "PT Self Test Agent",
  "agent_contact": "selftest@example.com",
  "trade_term": "FOB",
  "cargo": [{
    "cargo_type": "CPO",
    "description": "Self-test lot",
    "tonnage": 25000,
    "unit": "MT",
    "contract_no": "CTR-SELF-001",
    "po_no": "PO-SELF-001",
    "so_no": "SO-SELF-001",
    "shipper_name": "PT Self Test Shipper"
  }]
}
"@
$siJson | Set-Content (Join-Path $TMP "si-submit.json") -Encoding UTF8

@'
{"cargo":[{"line_order":0,"po_no":"PO-SELF-UPDATED","so_no":"SO-SELF-UPDATED"}]}
'@ | Set-Content (Join-Path $TMP "si-patch.json") -Encoding UTF8

function Invoke-Curl {
    param([string]$Method = "GET", [string]$Url, [string]$BodyFile = $null)
    $args = @("-s", "-w", "`n__HTTP__:%{http_code}", "-X", $Method, $Url, "-H", "x-api-key: $API_KEY")
    if ($BodyFile) {
        $bodyPath = (Resolve-Path $BodyFile).Path
        $args += @("-H", "Content-Type: application/json", "-d", "@$bodyPath")
    }
    $raw = & curl.exe @args 2>&1
    $text = ($raw -join "`n")
    if ($text -match "__HTTP__:(\d+)") {
        $code = [int]$Matches[1]
        $body = ($text -replace "`n__HTTP__:\d+", "").Trim()
    } else {
        $code = 0
        $body = $text
    }
    return @{ Code = $code; Body = $body }
}

$siId = $null

Test-Step "T00" "Health check" {
    $r = Invoke-Curl -Url "http://localhost:3000/api/v1/health"
    if ($r.Code -ne 200) { throw "HTTP $($r.Code)" }
    return "HTTP $($r.Code) - $($r.Body)"
} | Out-Null

Test-Step "T01" "GET /terms" {
    $r = Invoke-Curl -Url "$BASE/terms"
    if ($r.Code -ne 200) { throw "HTTP $($r.Code): $($r.Body)" }
    $j = $r.Body | ConvertFrom-Json
    if (-not $j.success) { throw $r.Body }
    return "HTTP $($r.Code) - $($j.data.Count) terms (e.g. $($j.data[0].code))"
} | Out-Null

Test-Step "T02" "GET /agents" {
    $r = Invoke-Curl -Url "$BASE/agents"
    if ($r.Code -ne 200) { throw "HTTP $($r.Code)" }
    $j = $r.Body | ConvertFrom-Json
    return "HTTP $($r.Code) - $($j.data.Count) agents"
} | Out-Null

Test-Step "T03" "GET /surveyors" {
    $r = Invoke-Curl -Url "$BASE/surveyors"
    if ($r.Code -ne 200) { throw "HTTP $($r.Code)" }
    $j = $r.Body | ConvertFrom-Json
    return "HTTP $($r.Code) - $($j.data.Count) surveyors"
} | Out-Null

Test-Step "T04" "GET /shippers" {
    $r = Invoke-Curl -Url "$BASE/shippers"
    if ($r.Code -ne 200) { throw "HTTP $($r.Code)" }
    $j = $r.Body | ConvertFrom-Json
    return "HTTP $($r.Code) - $($j.data.Count) shippers"
} | Out-Null

Test-Step "T05" "POST /shippers (create)" {
    $r = Invoke-Curl -Method POST -Url "$BASE/shippers" -BodyFile (Join-Path $TMP "shipper.json")
    if ($r.Code -notin 200,201) { throw "HTTP $($r.Code): $($r.Body)" }
    $j = $r.Body | ConvertFrom-Json
    return "HTTP $($r.Code) - shipper id=$($j.data.id) name=$($j.data.name)"
} | Out-Null

Test-Step "T06" "POST /shippers (duplicate upsert -> 200)" {
    $r = Invoke-Curl -Method POST -Url "$BASE/shippers" -BodyFile (Join-Path $TMP "shipper.json")
    if ($r.Code -ne 200) { throw "Expected 200, got $($r.Code): $($r.Body)" }
    return "HTTP $($r.Code) - matched existing shipper"
} | Out-Null

Test-Step "T07" "POST /agents (create)" {
    $r = Invoke-Curl -Method POST -Url "$BASE/agents" -BodyFile (Join-Path $TMP "agent.json")
    if ($r.Code -notin 200,201) { throw "HTTP $($r.Code): $($r.Body)" }
    $j = $r.Body | ConvertFrom-Json
    return "HTTP $($r.Code) - agent id=$($j.data.id)"
} | Out-Null

Test-Step "T08" "POST /shipping-instructions (vessel_hub_code only + PO/SO)" {
    $r = Invoke-Curl -Method POST -Url "$BASE/shipping-instructions" -BodyFile (Join-Path $TMP "si-submit.json")
    if ($r.Code -ne 201) { throw "HTTP $($r.Code): $($r.Body)" }
    $j = $r.Body | ConvertFrom-Json
    $script:siId = $j.data.id
    if ($j.data.vessel_hub_code -ne $TEST_HUB_CODE) { throw "Expected vessel_hub_code $TEST_HUB_CODE, got $($j.data.vessel_hub_code)" }
    if ($j.data.vessel_name -ne $TEST_VESSEL_NAME) { throw "Expected vessel_name $TEST_VESSEL_NAME, got $($j.data.vessel_name)" }
    return "HTTP $($r.Code) - SI id=$($j.data.id) hub=$($j.data.vessel_hub_code) vessel=$($j.data.vessel_name)"
} | Out-Null

Test-Step "T09" "GET /shipping-instructions/:id" {
    if (-not $siId) { throw "No SI id from T08" }
    $r = Invoke-Curl -Url "$BASE/shipping-instructions/$siId"
    if ($r.Code -ne 200) { throw "HTTP $($r.Code)" }
    $j = $r.Body | ConvertFrom-Json
    if ($j.data.status -ne "Pending") { throw "Expected Pending, got $($j.data.status)" }
    return "HTTP $($r.Code) - status=$($j.data.status) vessel=$($j.data.vessel_name)"
} | Out-Null

Test-Step "T10" "GET /shipping-instructions?external_reference=" {
    $r = Invoke-Curl -Url "$BASE/shipping-instructions?external_reference=$REF"
    if ($r.Code -ne 200) { throw "HTTP $($r.Code)" }
    $j = $r.Body | ConvertFrom-Json
    return "HTTP $($r.Code) - id=$($j.data.id) ref=$($j.data.external_reference)"
} | Out-Null

Test-Step "T11" "PATCH /shipping-instructions/:id (Pending)" {
    if (-not $siId) { throw "No SI id" }
    $r = Invoke-Curl -Method PATCH -Url "$BASE/shipping-instructions/$siId" -BodyFile (Join-Path $TMP "si-patch.json")
    if ($r.Code -ne 200) { throw "HTTP $($r.Code): $($r.Body)" }
    $j = $r.Body | ConvertFrom-Json
    return "HTTP $($r.Code) - status=$($j.data.status) after PATCH"
} | Out-Null

Test-Step "T12" "DB verify PO/SO on breakdown" {
    $nodeCmd = "import('pg').then(async ({default:pg})=>{const p=new pg.Pool({connectionString:process.env.DATABASE_URL});const r=await p.query('SELECT b.po_no,b.so_no,b.shipper_id,s.trade_term_id FROM shipping_instruction_breakdown b JOIN shipping_instructions s ON s.id=b.shipping_instruction_id WHERE s.id=$siId');console.log(JSON.stringify(r.rows[0]));await p.end();})"
    $dbOut = docker exec jps-api node -e $nodeCmd 2>&1
    $row = $dbOut | ConvertFrom-Json
    if ($row.po_no -ne "PO-SELF-UPDATED" -or $row.so_no -ne "SO-SELF-UPDATED") {
        throw "Expected PO-SELF-UPDATED/SO-SELF-UPDATED, got $($row.po_no)/$($row.so_no)"
    }
    return "po_no=$($row.po_no) so_no=$($row.so_no) shipper_id=$($row.shipper_id) trade_term_id=$($row.trade_term_id)"
} | Out-Null

Test-Step "T13" "Negative: invalid vessel_hub_code on POST (expect 400)" {
    $badHub = Join-Path $TMP "bad-hub.json"
    "{`"external_reference`":`"SI-BAD-HUB-$REF`",`"port_id`":1,`"vessel_hub_code`":`"INVALID-HUB-NOT-EXISTS`",`"purpose`":`"Loading`",`"eta`":`"2026-08-01T08:00:00Z`",`"agent_name`":`"PT Self Test Agent`",`"cargo`":[{`"cargo_type`":`"CPO`",`"tonnage`":25000,`"unit`":`"MT`"}]}" | Set-Content $badHub -Encoding UTF8
    $r = Invoke-Curl -Method POST -Url "$BASE/shipping-instructions" -BodyFile $badHub
    if ($r.Code -ne 400) { throw "Expected 400, got $($r.Code): $($r.Body)" }
    return "HTTP $($r.Code) - invalid vessel_hub_code rejected"
} | Out-Null

Test-Step "T14" "Negative: invalid trade_term on PATCH (expect 400)" {
    $bad = Join-Path $TMP "bad-term.json"
    '{"trade_term":"INVALID_TERM_XYZ"}' | Set-Content $bad -Encoding UTF8
    $r = Invoke-Curl -Method PATCH -Url "$BASE/shipping-instructions/$siId" -BodyFile $bad
    if ($r.Code -ne 400) { throw "Expected 400, got $($r.Code): $($r.Body)" }
    return "HTTP $($r.Code) - VALIDATION_ERROR as expected"
} | Out-Null

Test-Step "T15" "Negative: missing API key (expect 401)" {
    $raw = curl.exe -s -w "`n__HTTP__:%{http_code}" "$BASE/terms" 2>&1
    $text = ($raw -join "`n")
    if ($text -notmatch "__HTTP__:(\d+)") { throw $text }
    $code = [int]$Matches[1]
    if ($code -ne 401) { throw "Expected 401, got $code" }
    return "HTTP $code - INVALID_API_KEY as expected"
} | Out-Null

# Report
$passed = ($results | Where-Object { $_.Pass }).Count
$failed = ($results | Where-Object { -not $_.Pass }).Count
$overall = if ($failed -eq 0) { "PASS" } else { "FAIL" }

$md = @"
# Integration API Self-Test Report

| Field | Value |
|-------|-------|
| **Run at** | $TS |
| **Environment** | Local Docker (`http://localhost:3000`) |
| **Partner** | SELF_TEST_20260921 |
| **External reference** | $REF |
| **Shipping instruction id** | $siId |
| **Overall** | **$overall** ($passed passed, $failed failed) |

## Results

| # | Test | Result | Detail |
|---|------|--------|--------|

"@

foreach ($r in $results) {
    $status = if ($r.Pass) { "PASS" } else { "FAIL" }
    $detail = ($r.Detail -replace '\|','/' -replace "`n",' ')
    if ($detail.Length -gt 120) { $detail = $detail.Substring(0,117) + "..." }
    $md += "| $($r.Id) | $($r.Name) | $status | $detail |`n"
}

$md += @"

## Notes

- Master data: GET terms/agents/surveyors/shippers; POST upsert agents/shippers
- SI submit uses **vessel_hub_code** (primary vessel identifier) resolved to master snapshot
- SI submit includes trade_term, po_no, so_no, shipper_name on cargo line
- PATCH allowed only while status is **Pending**
- Full partner contract: [INBOUND-SHIPPING-INSTRUCTION-PARTNER-API.md](../Docs/Guide/INBOUND-SHIPPING-INSTRUCTION-PARTNER-API.md) v4.2

---
*Generated by `scripts/run-integration-self-test.ps1`*
"@

$md | Set-Content $reportPath -Encoding UTF8
Write-Host ""
Write-Host "=== SUMMARY: $overall - $passed passed, $failed failed ===" -ForegroundColor $(if ($failed -eq 0) { "Green" } else { "Red" })
Write-Host "Report: $reportPath" -ForegroundColor Yellow

if ($failed -gt 0) { exit 1 }
