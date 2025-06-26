# SWCP Tracker - Android Setup Script
# This script automates the setup process for converting to Android app

Write-Host "🏃 SWCP Tracker - Android App Setup" -ForegroundColor Green
Write-Host "=================================" -ForegroundColor Green

# Check if Node.js is installed
Write-Host "`n1. Checking Node.js installation..." -ForegroundColor Yellow
try {
    $nodeVersion = node --version
    Write-Host "✅ Node.js found: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Node.js not found. Please install Node.js from https://nodejs.org/" -ForegroundColor Red
    exit 1
}

# Install dependencies
Write-Host "`n2. Installing dependencies..." -ForegroundColor Yellow
npm install

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Dependencies installed successfully" -ForegroundColor Green
} else {
    Write-Host "❌ Failed to install dependencies" -ForegroundColor Red
    exit 1
}

# Initialize Capacitor
Write-Host "`n3. Initializing Capacitor..." -ForegroundColor Yellow
npx cap init

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Capacitor initialized" -ForegroundColor Green
} else {
    Write-Host "❌ Failed to initialize Capacitor" -ForegroundColor Red
    exit 1
}

# Add Android platform
Write-Host "`n4. Adding Android platform..." -ForegroundColor Yellow
npx cap add android

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Android platform added" -ForegroundColor Green
} else {
    Write-Host "❌ Failed to add Android platform" -ForegroundColor Red
    exit 1
}

# Sync files
Write-Host "`n5. Syncing web files to Android..." -ForegroundColor Yellow
npx cap sync android

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Files synced successfully" -ForegroundColor Green
} else {
    Write-Host "❌ Failed to sync files" -ForegroundColor Red
    exit 1
}

Write-Host "`n🎉 Setup Complete!" -ForegroundColor Green
Write-Host "==================" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Install Android Studio if you haven't already" -ForegroundColor White
Write-Host "2. Run: npx cap open android" -ForegroundColor White
Write-Host "3. In Android Studio, click the green 'Run' button" -ForegroundColor White
Write-Host ""
Write-Host "For detailed instructions, see setup-android.md" -ForegroundColor Yellow

# Ask if user wants to open Android Studio
$openStudio = Read-Host "`nWould you like to open Android Studio now? (y/n)"
if ($openStudio -eq 'y' -or $openStudio -eq 'Y') {
    Write-Host "Opening Android Studio..." -ForegroundColor Yellow
    npx cap open android
} 