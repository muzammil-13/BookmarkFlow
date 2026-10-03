Add-Type -AssemblyName System.Drawing
$src = 'C:\Users\muzam\.gemini\antigravity-ide\brain\9f7e71af-3188-4873-81e3-3f9ac692d050\icon128_1791034333689.png'
$outDir = 'c:\Users\muzam\Documents\my_projects\BookmarkFlow\icons'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$sizes = @(128, 48, 32, 16)
$srcImg = [System.Drawing.Image]::FromFile($src)
foreach ($size in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.DrawImage($srcImg, 0, 0, $size, $size)
    $g.Dispose()
    $outPath = "$outDir\icon$size.png"
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "Created $outPath"
}
$srcImg.Dispose()
Write-Host "All icons created."
