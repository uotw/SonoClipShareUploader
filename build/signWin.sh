# electron-builder -w
FILE=/Users/ben/Documents/98765432_Janus_20140127_124547/SCS_osx_2.2.0/dist/SonoClipShare\ Uploader\ Setup\ 2.2.0.exe
#osslsigncode sign -spc /Users/ben/Documents/CodeSigningCSRs/authenticode.spc -key /Users/ben/Documents/CodeSigningCSRs/authenticode.key -t http://timestamp.comodoca.com/authenticode -in "../dist/win-unpacked/SonoClipShare Uploader.exe" -out "../dist/win-unpacked/SonoClipShare Uploader.SIGNED.exe"
#mv "../dist/win-unpacked/SonoClipShare Uploader.SIGNED.exe" "../dist/win-unpacked/SonoClipShare Uploader.exe"
osslsigncode sign -spc /Users/ben/Documents/CodeSigningCSRs/authenticode.spc -key /Users/ben/Documents/CodeSigningCSRs/authenticode.key -t http://timestamp.comodoca.com/authenticode -in $FILE -out $FILE.temp
mv  $FILE.temp $FILE
