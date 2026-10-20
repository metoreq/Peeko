; Remove the "Start with system" scheduled task when Peeko is uninstalled.
!macro customUnInstall
  nsExec::Exec 'schtasks /delete /tn "Peeko" /f'
  Pop $0
!macroend
