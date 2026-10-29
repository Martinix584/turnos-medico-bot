# Arranca el bot de turnos y lo vuelve a levantar si se cae (lo lanza el acceso directo de Inicio).
Set-Location C:\turnos
$Host.UI.RawUI.WindowTitle = "Bot turnos"
while ($true) {
  npm start 2>&1 | Tee-Object -FilePath C:\turnos\bot.log -Append
  Write-Host "El bot se detuvo, reinicia en 10 s..."
  Start-Sleep 10
}
