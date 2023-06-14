# SonoClipShareUploader
The purpose of SonoClipShareUploader is to take a ultrasound media in a traditional format (mp4, mov, avi, jpg, bmp, png...), remove any Protected Health Information (PHI), and upload to an Archive on [SonoClipShare.com](https://www.SonoClipShare.com). The app allows the user to log in to their personal SonoClipShare account so any uploaded media shows up in their dashboard. SonoClipShareUploader is built as an [Electron app](https://electronjs.org/), and includes code from [ffmpeg](https://www.ffmpeg.org/).

## Install (v2.2.0)
Download and install for your OS:
- [Mac x64](https://d25ixnv6uinqzi.cloudfront.net/Anonymizer/SCS.installer.2.2.0.x64.dmg) (dmg, 141 MB)
- [Mac arm64](https://d25ixnv6uinqzi.cloudfront.net/Anonymizer/SCS.installer.2.2.0.arm64.dmg) (dmg, 114 MB)
- [Windows 64-bit](https://d25ixnv6uinqzi.cloudfront.net/Anonymizer/SCS_uploader.v2.2.0.x64.exe) (exe, 106MB)
- [Windows 32-bit](https://d25ixnv6uinqzi.cloudfront.net/Anonymizer/SCS_uploader.v2.2.0.ia32.exe) (exe, 103MB)

## Support Us
We provide this software free of charge for the ultrasound education community. Please consider supporting us by subscribing to one of [our courses](https://courses.coreultrasound.com/). We have group rates for institutions with more than 10 users.

## Disclaimer
This application provides no guarantee that all Protected Health Information (PHI) has been removed from its resultant images. It is the responsibility of the user to verify that all PHI has been removed from the ultrasound media, including but not limited to 1) hard coding of PHI into the images and 2) any PHI that has been placed in the images' metadata.

This software uses code of <a href=http://ffmpeg.org>FFmpeg</a> licensed under the <a href=http://www.gnu.org/licenses/old-licenses/lgpl-2.1.html>LGPLv2.1</a> and its source can be downloaded <a href=link_to_your_sources>here</a>.

## Development Environment
- you must first [install Node](https://nodejs.org/en/download/)
- `git clone https://github.com/uotw/SonoClipShareUploader.git`
- `cd ClipDeidentifier`
- `npm i --force`
- `npm start`

To build for Windows and MacOS:
- `npm run dist-win`
- `npm run dist-arm64`
- `npm run dist-mac`